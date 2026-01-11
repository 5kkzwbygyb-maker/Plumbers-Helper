/* Plumbing Job Helper — Calendar-first (Month + Week)
   Local-first storage.

   UX:
   - Tap day => view jobs
   - Tap job => open job detail
   - Long-press a job card => “Move mode” (tap a day to place)
   - Move mode supports MOVE or COPY (carryover without retyping)

   Matches the IDs from the index.html I gave you earlier:
   prevBtn, nextBtn, todayBtn, toggleViewBtn, periodTitle, monthGrid, weekBar,
   dayTitle, dayFilter, daySearch, dayJobs, jobDetail, etc.
*/

const $ = (id) => document.getElementById(id);

/* -------------------- Storage -------------------- */
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

const KEYS = {
  jobs: "pjh_jobs_v2",
  qr: "pjh_qr_v2",
  selectedJob: "pjh_selected_job_v2",
  selectedDay: "pjh_selected_day_v2",
  viewMode: "pjh_view_mode_v2",     // "month" | "week"
  weekAnchor: "pjh_week_anchor_v2", // ISO Sunday start
  gear: "pjh_gear_v2",
  shop: "pjh_shop_v2",
  cons: "pjh_cons_v2"
};

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function toISODate(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const da = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
function fromISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmtLong(iso) {
  const d = fromISODate(iso);
  return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
function startOfWeek(iso) {
  const d = fromISODate(iso);
  const day = d.getDay(); // 0 Sun
  d.setDate(d.getDate() - day);
  return toISODate(d);
}
function addDays(iso, n) {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
function monthTitle(d) {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
function num(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
}
function structuredCloneSafe(obj) {
  try { return structuredClone(obj); }
  catch { return JSON.parse(JSON.stringify(obj)); }
}

/* -------------------- Seed Data -------------------- */
function seedQuickRefs() {
  return [
    { id: uid(), title: "Drain slope reminder", tag: "drainage", body: "Minimum slope varies by pipe size & local requirements. Verify IPC + local amendments.", createdAt: new Date().toLocaleString() },
    { id: uid(), title: "Gas test reminder", tag: "gas", body: "Record test pressure, duration, and gauge reading before/after. Verify AHJ requirements.", createdAt: new Date().toLocaleString() }
  ];
}
function seedGear() {
  return [
    { id: uid(), name: "6ft ladder", type: "Tool", qty: 1, tag: "ladders" },
    { id: uid(), name: "Water hose 50ft", type: "Tool", qty: 1, tag: "hoses" },
    { id: uid(), name: '2" test plug', type: "Reusable Material", qty: 2, tag: "test" }
  ];
}

/* -------------------- State -------------------- */
let jobs = store.get(KEYS.jobs, []);
let quickRefs = store.get(KEYS.qr, seedQuickRefs());
let gear = store.get(KEYS.gear, seedGear());
let shopping = store.get(KEYS.shop, []);
let consumables = store.get(KEYS.cons, []);

let selectedJobId = store.get(KEYS.selectedJob, null);
const todayISO = toISODate(new Date());
let selectedDay = store.get(KEYS.selectedDay, todayISO);

let viewMode = store.get(KEYS.viewMode, "month"); // month | week
let periodCursor = fromISODate(selectedDay);
let weekAnchor = store.get(KEYS.weekAnchor, startOfWeek(selectedDay));

/* Move mode state */
let moveState = {
  active: false,
  jobId: null,
  mode: "move" // move | copy
};

function saveAll() {
  store.set(KEYS.jobs, jobs);
  store.set(KEYS.qr, quickRefs);
  store.set(KEYS.selectedJob, selectedJobId);
  store.set(KEYS.selectedDay, selectedDay);
  store.set(KEYS.viewMode, viewMode);
  store.set(KEYS.weekAnchor, weekAnchor);
  store.set(KEYS.gear, gear);
  store.set(KEYS.shop, shopping);
  store.set(KEYS.cons, consumables);
}

/* Migration / normalize job objects */
function ensureJobShape(j) {
  if (!j.date) j.date = j.createdAt ? toISODate(new Date(j.createdAt)) : todayISO;
  if (!j.status) j.status = "open";
  if (!j.materials) j.materials = [];
  if (!j.estimate) j.estimate = { laborHours:"", laborRate:"", materialsSubtotal:"", markupPct:"", tripFee:"" };
  if (!j.jobGear) j.jobGear = [];
  if (!j.type) j.type = "Service Call";
  if (!j.name) j.name = "(No name)";
  if (!j.address) j.address = "";
  if (typeof j.notes !== "string") j.notes = "";
  return j;
}
jobs = jobs.map(ensureJobShape);

/* -------------------- Tabs -------------------- */
function setView(viewName) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelector(`.tab[data-view="${viewName}"]`)?.classList.add("active");

  const views = ["calendar","materials","quickrefs","templates","about"];
  views.forEach(v => {
    const el = $(`view-${v}`);
    if (el) el.style.display = (v === viewName) ? "" : "none";
  });

  if (viewName === "calendar") renderCalendar();
  if (viewName === "materials") renderMaterialsInventory();
  if (viewName === "quickrefs") renderQuickRefs();
  if (viewName === "templates") updateTemplateHint();
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});

/* -------------------- Calendar Rendering -------------------- */
$("toggleViewBtn").addEventListener("click", () => {
  viewMode = (viewMode === "month") ? "week" : "month";
  saveAll();
  renderCalendar();
});

$("prevBtn").addEventListener("click", () => {
  if (viewMode === "month") {
    periodCursor = new Date(periodCursor.getFullYear(), periodCursor.getMonth() - 1, 1);
    renderCalendar();
  } else {
    weekAnchor = addDays(weekAnchor, -7);
    periodCursor = fromISODate(weekAnchor);
    saveAll();
    renderCalendar();
  }
});

$("nextBtn").addEventListener("click", () => {
  if (viewMode === "month") {
    periodCursor = new Date(periodCursor.getFullYear(), periodCursor.getMonth() + 1, 1);
    renderCalendar();
  } else {
    weekAnchor = addDays(weekAnchor, 7);
    periodCursor = fromISODate(weekAnchor);
    saveAll();
    renderCalendar();
  }
});

$("todayBtn").addEventListener("click", () => {
  selectedDay = todayISO;
  periodCursor = fromISODate(todayISO);
  weekAnchor = startOfWeek(todayISO);
  saveAll();
  renderCalendar();
  renderDayJobs();
});

$("dayFilter").addEventListener("change", renderDayJobs);
$("daySearch").addEventListener("input", renderDayJobs);

function jobsForDay(iso) {
  return jobs.filter(j => j.date === iso);
}
function countsForDay(iso) {
  const list = jobsForDay(iso);
  const c = { open:0, done:0, paid:0, total:list.length };
  list.forEach(j => c[j.status] = (c[j.status]||0)+1);
  return c;
}

function renderCalendar() {
  $("toggleViewBtn").textContent = `View: ${viewMode.toUpperCase()}`;

  if (viewMode === "month") {
    $("periodTitle").textContent = monthTitle(periodCursor);
    $("monthWrap").style.display = "";
    $("weekWrap").style.display = "none";
    renderMonthGrid();
  } else {
    const a = fromISODate(weekAnchor);
    const b = fromISODate(addDays(weekAnchor, 6));
    $("periodTitle").textContent =
      `${a.toLocaleDateString(undefined,{month:"short",day:"numeric"})} – ${b.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}`;
    $("monthWrap").style.display = "none";
    $("weekWrap").style.display = "";
    renderWeekBar();
  }

  $("dayTitle").value = fmtLong(selectedDay);
  renderDayJobs();
  renderMoveBanner();
}

function renderMonthGrid() {
  const grid = $("monthGrid");
  grid.innerHTML = "";

  const y = periodCursor.getFullYear();
  const m = periodCursor.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay()); // Sunday before or same day

  for (let i=0; i<42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = toISODate(d);
    const isCurrentMonth = d.getMonth() === m;

    const c = countsForDay(iso);

    const cell = document.createElement("div");
    cell.className = `dayCell ${isCurrentMonth ? "" : "inactive"}`;
    cell.innerHTML = `
      <div class="dayTop">
        <div class="dayNum">${d.getDate()}</div>
        <div class="dayBadges">
          ${c.open ? `<span class="badge open">${c.open} O</span>` : ""}
          ${c.done ? `<span class="badge done">${c.done} D</span>` : ""}
          ${c.paid ? `<span class="badge paid">${c.paid} P</span>` : ""}
        </div>
      </div>
      <div class="muted">${c.total ? `${c.total} job${c.total===1?"":"s"}` : ""}</div>
    `;

    cell.addEventListener("click", () => onPickDay(iso));
    cell.addEventListener("click", () => { if (moveState.active) placeJobOnDay(iso); });

    grid.appendChild(cell);
  }
}

function renderWeekBar() {
  const bar = $("weekBar");
  bar.innerHTML = "";

  const names = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  for (let i=0; i<7; i++) {
    const iso = addDays(weekAnchor, i);
    const d = fromISODate(iso);
    const c = countsForDay(iso);

    const btn = document.createElement("div");
    btn.className = `weekDayBtn ${iso===selectedDay ? "active" : ""}`;
    btn.innerHTML = `
      <div class="wTop">
        <div class="wName">${names[i]}</div>
        <div class="dayBadges">
          ${c.open ? `<span class="badge open">${c.open}</span>` : ""}
          ${c.done ? `<span class="badge done">${c.done}</span>` : ""}
          ${c.paid ? `<span class="badge paid">${c.paid}</span>` : ""}
        </div>
      </div>
      <div class="wDate">${d.toLocaleDateString(undefined,{month:"short",day:"numeric"})}</div>
      <div class="muted">${c.total ? `${c.total} job${c.total===1?"":"s"}` : ""}</div>
    `;
    btn.addEventListener("click", () => onPickDay(iso));
    btn.addEventListener("click", () => { if (moveState.active) placeJobOnDay(iso); });
    bar.appendChild(btn);
  }
}

function onPickDay(iso) {
  selectedDay = iso;
  store.set(KEYS.selectedDay, selectedDay);
  $("dayTitle").value = fmtLong(selectedDay);

  if (viewMode === "week") {
    weekAnchor = startOfWeek(selectedDay);
    store.set(KEYS.weekAnchor, weekAnchor);
    renderWeekBar();
  }
  renderDayJobs();
}

/* -------------------- Day Jobs List -------------------- */
function renderDayJobs() {
  const list = $("dayJobs");
  list.innerHTML = "";

  const q = $("daySearch").value.trim().toLowerCase();
  const f = $("dayFilter").value;

  const dayJobs = jobs
    .filter(j => j.date === selectedDay)
    .filter(j => (f === "all") || (j.status === f))
    .filter(j => !q || (`${j.name} ${j.address} ${j.type} ${j.notes}`).toLowerCase().includes(q))
    .sort((a,b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  if (!dayJobs.length) {
    list.innerHTML = `<div class="card muted">No jobs for this day.</div>`;
    return;
  }

  dayJobs.forEach(j => {
    const card = document.createElement("div");
    card.className = "jobCard";

    const pillClass = `pill ${j.status}`;
    card.innerHTML = `
      <div class="jobLine">
        <div>
          <div class="jobTitle">${escapeHtml(j.name)} <span class="${pillClass}">${j.status.toUpperCase()}</span></div>
          <div class="jobMeta">${escapeHtml(j.type)} • ${escapeHtml(j.address || "No address")}</div>
        </div>
      </div>
      <div class="jobBtns">
        <button class="secondary" data-open="${j.id}">Open</button>
        <button class="secondary" data-move="${j.id}">Reschedule</button>
      </div>
      <div class="muted" style="margin-top:8px;">Tip: long-press this card to pick it up and place it on another day.</div>
    `;

    card.querySelector(`[data-open="${j.id}"]`).addEventListener("click", () => openJob(j.id));
    card.querySelector(`[data-move="${j.id}"]`).addEventListener("click", () => enterMoveMode(j.id));
    attachLongPress(card, () => enterMoveMode(j.id));

    list.appendChild(card);
  });
}

/* -------------------- New Job -------------------- */
$("newJobBtn").addEventListener("click", () => {
  const name = prompt("Customer / Job name?");
  if (name === null) return;
  const jobType = prompt("Job type? (Service Call, Water Heater, Rough-In, Sewer/Drain, Gas, Other)", "Service Call");
  const address = prompt("Address / location? (optional)", "");

  const job = ensureJobShape({
    id: uid(),
    name: (name || "(No name)").trim(),
    address: (address || "").trim(),
    type: (jobType || "Service Call").trim(),
    status: "open",
    date: selectedDay,
    notes: "",
    materials: [],
    jobGear: [],
    estimate: { laborHours:"", laborRate:"", materialsSubtotal:"", markupPct:"", tripFee:"" },
    createdAt: new Date().toISOString()
  });

  jobs.unshift(job);
  selectedJobId = job.id;
  saveAll();

  renderCalendar();
  renderDayJobs();
  openJob(job.id);
});

/* -------------------- Job Detail -------------------- */
function openJob(id) {
  const job = jobs.find(j => j.id === id);
  if (!job) return;

  selectedJobId = id;
  saveAll();

  $("jobDetail").style.display = "";
  $("jdTitle").textContent = `${job.name} — ${job.type}`;
  $("jdMeta").textContent = `${job.address || "No address"} • Day: ${job.date}`;

  $("jdStatus").value = job.status;
  $("jdDate").value = job.date;
  $("jdNotes").value = job.notes || "";

  renderMaterials(job);
  refreshGearPicker();
  renderJobGear(job);
  loadEstimate(job);
  wireIpcButtons();

  window.scrollTo({ top: document.body.scrollHeight, behavior:"smooth" });
}

$("saveJobBtn").addEventListener("click", () => {
  const job = jobs.find(j => j.id === selectedJobId);
  if (!job) return;

  job.status = $("jdStatus").value;
  job.date = $("jdDate").value || job.date;
  job.notes = $("jdNotes").value;

  saveAll();

  selectedDay = job.date;
  store.set(KEYS.selectedDay, selectedDay);

  if (viewMode === "week") {
    weekAnchor = startOfWeek(selectedDay);
    store.set(KEYS.weekAnchor, weekAnchor);
  }
  $("dayTitle").value = fmtLong(selectedDay);

  renderCalendar();
  renderDayJobs();
  alert("Saved.");
});

$("deleteJobBtn").addEventListener("click", () => {
  const job = jobs.find(j => j.id === selectedJobId);
  if (!job) return;
  if (!confirm("Delete this job? This cannot be undone.")) return;

  jobs = jobs.filter(j => j.id !== selectedJobId);
  selectedJobId = null;
  saveAll();

  $("jobDetail").style.display = "none";
  renderCalendar();
  renderDayJobs();
});

$("enterMoveBtn").addEventListener("click", () => {
  if (!selectedJobId) return;
  enterMoveMode(selectedJobId);
});

/* -------------------- Move / Copy (Reschedule / Carryover) -------------------- */
function renderMoveBanner() {
  const banner = $("moveBanner");
  if (!banner) return;

  if (!moveState.active) {
    banner.style.display = "none";
    return;
  }

  const job = jobs.find(j => j.id === moveState.jobId);
  banner.style.display = "";
  $("moveTitle").textContent = `Placing: ${job ? job.name : "Job"}`;
  $("moveHint").textContent = "Tap any day on the calendar/week bar to place. Use COPY for carryover jobs.";

  $("moveModeMoveBtn").style.background = (moveState.mode==="move") ? "#0b5fff" : "#24314f";
  $("moveModeCopyBtn").style.background = (moveState.mode==="copy") ? "#0b5fff" : "#24314f";
}

function enterMoveMode(jobId) {
  moveState.active = true;
  moveState.jobId = jobId;
  moveState.mode = "move";
  renderMoveBanner();
  alert("Move mode: tap the day you want. Use COPY for carryover jobs.");
}

$("moveModeMoveBtn").addEventListener("click", () => {
  moveState.mode = "move";
  renderMoveBanner();
});
$("moveModeCopyBtn").addEventListener("click", () => {
  moveState.mode = "copy";
  renderMoveBanner();
});
$("cancelMoveBtn").addEventListener("click", () => {
  moveState.active = false;
  moveState.jobId = null;
  renderMoveBanner();
});

function placeJobOnDay(targetDayISO) {
  const job = jobs.find(j => j.id === moveState.jobId);
  if (!job) return;

  if (moveState.mode === "move") {
    job.date = targetDayISO;
    selectedJobId = job.id;
  } else {
    const copy = structuredCloneSafe(job);
    copy.id = uid();
    copy.date = targetDayISO;
    copy.status = "open";
    copy.createdAt = new Date().toISOString();
    jobs.unshift(copy);
    selectedJobId = copy.id;
  }

  selectedDay = targetDayISO;
  store.set(KEYS.selectedDay, selectedDay);

  if (viewMode === "week") {
    weekAnchor = startOfWeek(selectedDay);
    store.set(KEYS.weekAnchor, weekAnchor);
  }

  saveAll();

  moveState.active = false;
  moveState.jobId = null;
  renderMoveBanner();

  $("dayTitle").value = fmtLong(selectedDay);
  renderCalendar();
  renderDayJobs();
  openJob(selectedJobId);
}

/* Long-press helper */
function attachLongPress(el, onLongPress) {
  let timer = null;
  let moved = false;

  const start = () => {
    moved = false;
    timer = setTimeout(() => {
      timer = null;
      if (!moved) onLongPress();
    }, 450);
  };
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const move = () => { moved = true; cancel(); };

  el.addEventListener("touchstart", start, { passive:true });
  el.addEventListener("touchend", cancel);
  el.addEventListener("touchcancel", cancel);
  el.addEventListener("touchmove", move, { passive:true });

  el.addEventListener("mousedown", start);
  el.addEventListener("mouseup", cancel);
  el.addEventListener("mouseleave", cancel);
  el.addEventListener("mousemove", move);
}

/* -------------------- Job Materials -------------------- */
$("addMatBtn").addEventListener("click", () => {
  const job = jobs.find(j => j.id === selectedJobId);
  if (!job) return;

  const item = $("matItem").value.trim();
  const qty = Math.max(1, parseInt($("matQty").value || "1", 10));
  if (!item) return;

  job.materials.unshift({ id: uid(), item, qty });
  $("matItem").value = "";
  $("matQty").value = "1";
  saveAll();
  renderMaterials(job);
});

function renderMaterials(job) {
  const list = $("matList");
  list.innerHTML = "";

  if (!job.materials.length) {
    list.innerHTML = `<div class="muted">No materials yet.</div>`;
    return;
  }

  job.materials.forEach(m => {
    const row = document.createElement("div");
    row.className = "jobCard";
    row.style.padding = "10px";
    row.innerHTML = `
      <div class="row" style="align-items:center;">
        <div class="col"><div style="font-weight:700;">${escapeHtml(m.item)}</div></div>
        <div style="width:110px;"><input type="number" min="1" value="${m.qty}" data-qty="${m.id}" /></div>
        <div style="width:110px;"><button class="danger" data-del="${m.id}">Remove</button></div>
      </div>
    `;

    row.querySelector(`[data-del="${m.id}"]`).addEventListener("click", () => {
      job.materials = job.materials.filter(x => x.id !== m.id);
      saveAll();
      renderMaterials(job);
    });

    row.querySelector(`[data-qty="${m.id}"]`).addEventListener("change", (e) => {
      const v = Math.max(1, parseInt(e.target.value || "1", 10));
      const t = job.materials.find(x => x.id === m.id);
      if (t) t.qty = v;
      saveAll();
    });

    list.appendChild(row);
  });
}

$("copyMatsBtn").addEventListener("click", async () => {
  const job = jobs.find(j => j.id === selectedJobId);
  if (!job) return;

  const lines = job.materials.map(m => `${m.qty} × ${m.item}`);
  const text = `Materials — ${job.name} (${job.type})\nDate: ${job.date}\n${job.address || ""}\n\n${lines.join("\n") || "(none)"}`;
  await navigator.clipboard.writeText(text);
  alert("Copied.");
});

/* -------------------- Gear (Reusable) -------------------- */
function refreshGearPicker() {
  const sel = $("gearPick");
  sel.innerHTML = "";
  if (!gear.length) {
    sel.innerHTML = `<option value="">(Add reusable gear in Materials & Inventory tab)</option>`;
    return;
  }
  gear.forEach(g => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = `${g.name} (${g.type})`;
    sel.appendChild(opt);
  });
}

$("checkoutGearBtn").addEventListener("click", () => {
  const job = jobs.find(j => j.id === selectedJobId);
  if (!job) return;

  const gearId = $("gearPick").value;
  if (!gearId) return alert("Pick a gear item first.");

  const g = gear.find(x => x.id === gearId);
  if (!g) return;

  const qty = Math.max(1, parseInt($("gearPickQty").value || "1", 10));

  job.jobGear.unshift({
    id: uid(),
    gearId: g.id,
    name: g.name,
    type: g.type,
    qty,
    returned: false,
    checkedOutAt: new Date().toLocaleString()
  });

  saveAll();
  renderJobGear(job);
});

$("markAllReturnedBtn").addEventListener("click", () => {
  const job = jobs.find(j => j.id === selectedJobId);
  if (!job) return;
  job.jobGear.forEach(x => x.returned = true);
  saveAll();
  renderJobGear(job);
});

function renderJobGear(job) {
  const list = $("jobGearList");
  list.innerHTML = "";

  if (!job.jobGear.length) {
    list.innerHTML = `<div class="muted">No checked-out gear for this job.</div>`;
    return;
  }

  job.jobGear.forEach(item => {
    const row = document.createElement("div");
    row.className = "jobCard";
    row.style.padding = "10px";
    row.innerHTML = `
      <div class="row" style="align-items:center;">
        <div class="col">
          <div style="font-weight:700;">${escapeHtml(item.name)}</div>
          <div class="muted">Qty: ${item.qty} • ${item.type}</div>
        </div>
        <div style="width:150px;">
          <button class="secondary" data-toggle="${item.id}">
            ${item.returned ? "Returned ✅" : "Not Returned ❗"}
          </button>
        </div>
        <div style="width:110px;">
          <button class="danger" data-remove="${item.id}">Remove</button>
        </div>
      </div>
    `;

    row.querySelector(`[data-toggle="${item.id}"]`).addEventListener("click", () => {
      const t = job.jobGear.find(x => x.id === item.id);
      if (!t) return;
      t.returned = !t.returned;
      saveAll();
      renderJobGear(job);
    });

    row.querySelector(`[data-remove="${item.id}"]`).addEventListener("click", () => {
      job.jobGear = job.jobGear.filter(x => x.id !== item.id);
      saveAll();
      renderJobGear(job);
    });

    list.appendChild(row);
  });
}

/* -------------------- Estimate -------------------- */
function loadEstimate(job) {
  const e = job.estimate || {};
  $("laborHours").value = e.laborHours ?? "";
  $("laborRate").value = e.laborRate ?? "";
  $("materialsSubtotal").value = e.materialsSubtotal ?? "";
  $("markupPct").value = e.markupPct ?? "";
  $("tripFee").value = e.tripFee ?? "";
  $("estimateTotal").value = "";
}

$("calcBtn").addEventListener("click", () => {
  const job = jobs.find(j => j.id === selectedJobId);
  if (!job) return;

  const laborHours = num($("laborHours").value);
  const laborRate = num($("laborRate").value);
  const materialsSubtotal = num($("materialsSubtotal").value);
  const markupPct = num($("markupPct").value);
  const tripFee = num($("tripFee").value);

  const total = (laborHours * laborRate) + (materialsSubtotal * (1 + markupPct/100)) + tripFee;
  $("estimateTotal").value = isFinite(total) ? `$${total.toFixed(2)}` : "";

  job.estimate = { laborHours, laborRate, materialsSubtotal, markupPct, tripFee };
  saveAll();
});

$("copyEstimateBtn").addEventListener("click", async () => {
  const job = jobs.find(j => j.id === selectedJobId);
  if (!job) return;
  const e = job.estimate || {};
  const labor = num(e.laborHours) * num(e.laborRate);
  const mats = num(e.materialsSubtotal) * (1 + num(e.markupPct)/100);
  const total = labor + mats + num(e.tripFee);

  const text =
`Estimate — ${job.name} (${job.type})
Date: ${job.date}
${job.address || ""}

Labor: ${num(e.laborHours)} hrs × $${num(e.laborRate)}/hr = $${labor.toFixed(2)}
Materials: $${num(e.materialsSubtotal).toFixed(2)} + ${num(e.markupPct)}% = $${mats.toFixed(2)}
Trip/Diagnostic: $${num(e.tripFee).toFixed(2)}

TOTAL: $${total.toFixed(2)}`;

  await navigator.clipboard.writeText(text);
  alert("Copied.");
});

/* -------------------- IPC (Official) -------------------- */
function wireIpcButtons() {
  $("openIpcBtn").onclick = () => {
    const q = ($("ipcQuery").value || "").trim();
    const query = encodeURIComponent((q ? `International Plumbing Code ${q}` : "2024 International Plumbing Code"));
    window.open(`https://codes.iccsafe.org/codes?s=${query}`, "_blank");
  };
  $("openIpc2024Btn").onclick = () => {
    window.open("https://codes.iccsafe.org/content/IPC2024P1", "_blank");
  };
}

/* -------------------- Materials & Inventory -------------------- */
function renderMaterialsInventory() {
  renderShopping();
  renderConsumables();
  renderGear();
}

$("addShopBtn").addEventListener("click", () => {
  const item = $("shopItem").value.trim();
  const qty = Math.max(1, parseInt($("shopQty").value || "1", 10));
  const note = $("shopNote").value.trim();
  if (!item) return;

  shopping.unshift({ id: uid(), item, qty, note, createdAt: new Date().toISOString() });
  $("shopItem").value = "";
  $("shopQty").value = "1";
  $("shopNote").value = "";
  saveAll();
  renderShopping();
});

$("copyShopBtn").addEventListener("click", async () => {
  const lines = shopping.map(s => `${s.qty} × ${s.item}${s.note ? ` — ${s.note}` : ""}`);
  const text = `Shopping List\n\n${lines.join("\n") || "(empty)"}`;
  await navigator.clipboard.writeText(text);
  alert("Copied.");
});

function renderShopping() {
  const list = $("shopList");
  list.innerHTML = "";
  if (!shopping.length) {
    list.innerHTML = `<div class="muted">No shopping items yet.</div>`;
    return;
  }
  shopping.forEach(s => {
    const row = document.createElement("div");
    row.className = "jobCard";
    row.style.padding = "10px";
    row.innerHTML = `
      <div class="row" style="align-items:center;">
        <div class="col">
          <div style="font-weight:800;">${escapeHtml(s.item)}</div>
          <div class="muted">${escapeHtml(s.note || "")}</div>
        </div>
        <div style="width:110px;"><input type="number" min="1" value="${s.qty}" data-sqty="${s.id}" /></div>
        <div style="width:110px;"><button class="danger" data-sdel="${s.id}">Remove</button></div>
      </div>
    `;
    row.querySelector(`[data-sqty="${s.id}"]`).addEventListener("change", (e) => {
      const v = Math.max(1, parseInt(e.target.value || "1", 10));
      const t = shopping.find(x => x.id === s.id);
      if (t) t.qty = v;
      saveAll();
    });
    row.querySelector(`[data-sdel="${s.id}"]`).addEventListener("click", () => {
      shopping = shopping.filter(x => x.id !== s.id);
      saveAll();
      renderShopping();
    });
    list.appendChild(row);
  });
}

$("addConsBtn").addEventListener("click", () => {
  const item = $("consItem").value.trim();
  const onHand = Math.max(0, parseInt($("consOnHand").value || "0", 10));
  const unit = $("consUnit").value.trim();
  const min = Math.max(0, parseInt($("consMin").value || "0", 10));
  if (!item) return;

  consumables.unshift({ id: uid(), item, onHand, unit, min });
  $("consItem").value = "";
  $("consOnHand").value = "0";
  $("consUnit").value = "";
  $("consMin").value = "0";
  saveAll();
  renderConsumables();
});

function renderConsumables() {
  const list = $("consList");
  list.innerHTML = "";
  if (!consumables.length) {
    list.innerHTML = `<div class="muted">No consumables yet.</div>`;
    return;
  }
  consumables.forEach(c => {
    const low = c.onHand <= c.min && c.min > 0;
    const row = document.createElement("div");
    row.className = "jobCard";
    row.style.padding = "10px";
    row.innerHTML = `
      <div class="row" style="align-items:center;">
        <div class="col">
          <div style="font-weight:800;">${escapeHtml(c.item)} ${low ? `<span class="pill open">LOW</span>` : ""}</div>
          <div class="muted">Min: ${c.min} • Unit: ${escapeHtml(c.unit || "-")}</div>
        </div>
        <div style="width:110px;"><input type="number" min="0" value="${c.onHand}" data-con="${c.id}" /></div>
        <div style="width:110px;"><button class="danger" data-cdel="${c.id}">Remove</button></div>
      </div>
    `;
    row.querySelector(`[data-con="${c.id}"]`).addEventListener("change", (e) => {
      const v = Math.max(0, parseInt(e.target.value || "0", 10));
      const t = consumables.find(x => x.id === c.id);
      if (t) t.onHand = v;
      saveAll();
      renderConsumables();
    });
    row.querySelector(`[data-cdel="${c.id}"]`).addEventListener("click", () => {
      consumables = consumables.filter(x => x.id !== c.id);
      saveAll();
      renderConsumables();
    });
    list.appendChild(row);
  });
}

$("addGearBtn").addEventListener("click", () => {
  const name = $("gearName").value.trim();
  const type = $("gearType").value;
  const qty = Math.max(1, parseInt($("gearQty").value || "1", 10));
  const tag = $("gearTag").value.trim();
  if (!name) return;

  gear.unshift({ id: uid(), name, type, qty, tag });
  $("gearName").value = "";
  $("gearQty").value = "1";
  $("gearTag").value = "";
  saveAll();
  renderGear();
  refreshGearPicker();
});

function renderGear() {
  const list = $("gearList");
  list.innerHTML = "";
  if (!gear.length) {
    list.innerHTML = `<div class="muted">No reusable gear yet.</div>`;
    return;
  }
  gear.forEach(g => {
    const row = document.createElement("div");
    row.className = "jobCard";
    row.style.padding = "10px";
    row.innerHTML = `
      <div class="row" style="align-items:center;">
        <div class="col">
          <div style="font-weight:800;">${escapeHtml(g.name)}</div>
          <div class="muted">${escapeHtml(g.type)} • Qty: ${g.qty} • ${escapeHtml(g.tag || "")}</div>
        </div>
        <div style="width:110px;"><button class="danger" data-gdel="${g.id}">Delete</button></div>
      </div>
    `;
    row.querySelector(`[data-gdel="${g.id}"]`).addEventListener("click", () => {
      if (!confirm("Delete this gear item?")) return;
      gear = gear.filter(x => x.id !== g.id);
      saveAll();
      renderGear();
      refreshGearPicker();
    });
    list.appendChild(row);
  });
}

/* -------------------- Quick Refs -------------------- */
$("addQrBtn").addEventListener("click", () => {
  const title = $("qrTitle").value.trim();
  const tag = $("qrTag").value.trim();
  const body = $("qrBody").value.trim();
  if (!title || !body) return alert("Add at least a title and content.");

  quickRefs.unshift({ id: uid(), title, tag, body, createdAt: new Date().toLocaleString() });
  $("qrTitle").value = "";
  $("qrTag").value = "";
  $("qrBody").value = "";
  saveAll();
  renderQuickRefs();
});
$("searchQr").addEventListener("input", renderQuickRefs);

function renderQuickRefs() {
  const q = $("searchQr").value.trim().toLowerCase();
  const list = $("qrList");
  list.innerHTML = "";

  const filtered = quickRefs.filter(r => {
    const hay = `${r.title} ${r.tag} ${r.body}`.toLowerCase();
    return !q || hay.includes(q);
  });

  if (!filtered.length) {
    list.innerHTML = `<div class="card muted">No quick-refs found.</div>`;
    return;
  }

  filtered.forEach(r => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div>
          <div style="font-weight:900;">${escapeHtml(r.title)}</div>
          <div class="muted">${escapeHtml(r.tag || "untagged")} • ${escapeHtml(r.createdAt)}</div>
        </div>
        <button class="danger" data-delqr="${r.id}">Delete</button>
      </div>
      <div class="hr"></div>
      <textarea data-body="${r.id}">${escapeHtml(r.body)}</textarea>
      <div class="actions" style="margin-top:8px;">
        <button class="secondary" data-saveqr="${r.id}">Save</button>
        <button class="secondary" data-copyqr="${r.id}">Copy</button>
      </div>
    `;

    card.querySelector(`[data-delqr="${r.id}"]`).addEventListener("click", () => {
      if (!confirm("Delete this quick-ref?")) return;
      quickRefs = quickRefs.filter(x => x.id !== r.id);
      saveAll();
      renderQuickRefs();
    });

    card.querySelector(`[data-saveqr="${r.id}"]`).addEventListener("click", () => {
      const ta = card.querySelector(`[data-body="${r.id}"]`);
      const target = quickRefs.find(x => x.id === r.id);
      if (target) target.body = ta.value;
      saveAll();
      alert("Saved.");
    });

    card.querySelector(`[data-copyqr="${r.id}"]`).addEventListener("click", async () => {
      const text = `${r.title} (${r.tag || "untagged"})\n\n${r.body}`;
      await navigator.clipboard.writeText(text);
      alert("Copied.");
    });

    list.appendChild(card);
  });
}

/* -------------------- Templates -------------------- */
const templates = {
  wh40: [
    ["Dielectric nipples / unions", 1],
    ["T&P discharge fittings", 1],
    ["Water flex / supply lines", 2],
    ["Ball valve (cold)", 1],
    ["Pan + drain adapter (if needed)", 1]
  ],
  toiletreset: [
    ["Wax ring / seal", 1],
    ["Closet bolts", 1],
    ["Supply line", 1],
    ["Shims", 1],
    ["Caulk", 1]
  ],
  lavrough: [
    ['1-1/2" trap adapter', 1],
    ['P-trap kit 1-1/4" or 1-1/2"', 1],
    ["Angle stop(s)", 2],
    ["Supply line(s)", 2]
  ]
};

document.querySelectorAll("[data-template]").forEach(btn => {
  btn.addEventListener("click", () => {
    const job = jobs.find(j => j.id === selectedJobId);
    if (!job) return alert("Open a job first.");
    const key = btn.dataset.template;
    const items = templates[key] || [];
    items.forEach(([item, qty]) => job.materials.unshift({ id: uid(), item, qty }));
    saveAll();
    renderMaterials(job);
    alert("Template added to job materials.");
  });
});

function updateTemplateHint() {
  const job = jobs.find(j => j.id === selectedJobId);
  const el = $("templateHint");
  if (!el) return;
  el.textContent = job ? `Selected job: ${job.name} — ${job.type}` : "No job selected. Open a job first.";
}

/* -------------------- Service Worker -------------------- */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

/* -------------------- Init -------------------- */
function init() {
  if (!selectedDay) selectedDay = todayISO;
  if (!weekAnchor) weekAnchor = startOfWeek(selectedDay);

  periodCursor = (viewMode === "month")
    ? new Date(fromISODate(selectedDay).getFullYear(), fromISODate(selectedDay).getMonth(), 1)
    : fromISODate(weekAnchor);

  setView("calendar");
  renderCalendar();
  renderMaterialsInventory();
  renderQuickRefs();
  updateTemplateHint();
}
init();
