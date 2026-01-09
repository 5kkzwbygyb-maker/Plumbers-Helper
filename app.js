/* Plumbing Job Helper (local-first PWA)
   Storage keys: pjh_jobs, pjh_qr, pjh_selected_job
*/

const $ = (id) => document.getElementById(id);

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

const KEYS = {
  jobs: "pjh_jobs",
  qr: "pjh_qr",
  selected: "pjh_selected_job"
};

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function nowStr() {
  const d = new Date();
  return d.toLocaleString();
}

let jobs = store.get(KEYS.jobs, []);
let quickRefs = store.get(KEYS.qr, seedQuickRefs());
let selectedJobId = store.get(KEYS.selected, null);

function seedQuickRefs() {
  // You can replace these with your own defaults.
  return [
    { id: uid(), title: "Drain slope rule of thumb", tag: "drainage", body: "Minimum slope often 1/4\" per foot for smaller pipe. Verify local code & sizing.", createdAt: nowStr() },
    { id: uid(), title: "Gas test reminder", tag: "gas", body: "Record test pressure & duration + gauge reading before/after. Verify local requirements.", createdAt: nowStr() }
  ];
}

function saveAll() {
  store.set(KEYS.jobs, jobs);
  store.set(KEYS.qr, quickRefs);
  store.set(KEYS.selected, selectedJobId);
}

function setView(viewName) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelector(`.tab[data-view="${viewName}"]`)?.classList.add("active");

  const views = ["jobs","quickrefs","templates","about"];
  views.forEach(v => {
    const el = $(`view-${v}`);
    if (el) el.style.display = (v === viewName) ? "" : "none";
  });

  if (viewName === "jobs") renderJobs();
  if (viewName === "quickrefs") renderQuickRefs();
  if (viewName === "templates") updateTemplateHint();
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});

// ----- JOBS -----
$("addJobBtn").addEventListener("click", () => {
  const name = $("custName").value.trim();
  const address = $("address").value.trim();
  const type = $("jobType").value;
  const status = $("status").value;
  const notes = $("jobNotes").value.trim();

  if (!name && !address) {
    alert("Add at least a customer name or an address.");
    return;
  }

  const job = {
    id: uid(),
    name: name || "(No name)",
    address,
    type,
    status,
    notes,
    materials: [],
    estimate: { laborHours:"", laborRate:"", materialsSubtotal:"", markupPct:"", tripFee:"" },
    createdAt: nowStr()
  };

  jobs.unshift(job);
  selectedJobId = job.id;
  saveAll();

  $("custName").value = "";
  $("address").value = "";
  $("jobNotes").value = "";
  $("status").value = "open";
  renderJobs();
  openJob(job.id);
});

$("searchJobs").addEventListener("input", renderJobs);
$("filterStatus").addEventListener("change", renderJobs);

function renderJobs() {
  const q = $("searchJobs").value.trim().toLowerCase();
  const f = $("filterStatus").value;

  const list = $("jobList");
  list.innerHTML = "";

  const filtered = jobs.filter(j => {
    const matchesQ = !q || (j.name + " " + j.address + " " + j.type).toLowerCase().includes(q);
    const matchesF = (f === "all") || (j.status === f);
    return matchesQ && matchesF;
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="card muted">No jobs found.</div>`;
    return;
  }

  filtered.forEach(job => {
    const pillClass = job.status === "done" ? "pill done" : "pill open";
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="jobline">
        <div class="left">
          <div style="font-weight:700;">${escapeHtml(job.name)}</div>
          <div class="muted">${escapeHtml(job.type)} • ${escapeHtml(job.address || "No address")} • ${escapeHtml(job.createdAt)}</div>
        </div>
        <div class="${pillClass}">${job.status.toUpperCase()}</div>
      </div>
      <div class="actions" style="margin-top:10px;">
        <button class="secondary" data-open="${job.id}">Open</button>
      </div>
    `;
    card.querySelector(`[data-open="${job.id}"]`).addEventListener("click", () => openJob(job.id));
    list.appendChild(card);
  });

  if (selectedJobId) openJob(selectedJobId, { quiet: true });
}

function openJob(id, opts={}) {
  const job = jobs.find(j => j.id === id);
  if (!job) return;
  selectedJobId = id;
  saveAll();

  $("jobDetail").style.display = "";
  $("jdTitle").textContent = `${job.name} — ${job.type}`;
  $("jdMeta").textContent = `${job.address || "No address"} • Created: ${job.createdAt}`;
  $("jdNotes").value = job.notes || "";

  $("toggleStatusBtn").textContent = job.status === "done" ? "Mark Open" : "Mark Done";

  renderMaterials(job);
  loadEstimate(job);

  if (!opts.quiet) window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

$("saveNotesBtn").addEventListener("click", () => {
  const job = jobs.find(j => j.id === selectedJobId);
  if (!job) return;
  job.notes = $("jdNotes").value;
  saveAll();
  renderJobs();
  alert("Saved.");
});

$("toggleStatusBtn").addEventListener("click", () => {
  const job = jobs.find(j => j.id === selectedJobId);
  if (!job) return;
  job.status = (job.status === "done") ? "open" : "done";
  saveAll();
  renderJobs();
  openJob(job.id, { quiet: true });
});

$("deleteJobBtn").addEventListener("click", () => {
  const job = jobs.find(j => j.id === selectedJobId);
  if (!job) return;
  if (!confirm("Delete this job? This cannot be undone.")) return;
  jobs = jobs.filter(j => j.id !== selectedJobId);
  selectedJobId = jobs[0]?.id ?? null;
  saveAll();
  $("jobDetail").style.display = selectedJobId ? "" : "none";
  renderJobs();
});

// ----- MATERIALS -----
$("addMatBtn").addEventListener("click", () => {
  const job = jobs.find(j => j.id === selectedJobId);
  if (!job) return;

  const item = $("matItem").value.trim();
  const qty = parseInt($("matQty").value || "1", 10);

  if (!item) return;

  job.materials.unshift({ id: uid(), item, qty: Math.max(1, qty) });
  $("matItem").value = "";
  $("matQty").value = "1";

  saveAll();
  renderMaterials(job);
});

function renderMaterials(job) {
  const list = $("matList");
  list.innerHTML = "";

  if (!job.materials || job.materials.length === 0) {
    list.innerHTML = `<div class="muted">No materials yet.</div>`;
    return;
  }

  job.materials.forEach(m => {
    const row = document.createElement("div");
    row.className = "card";
    row.style.padding = "10px";
    row.innerHTML = `
      <div class="row" style="align-items:center;">
        <div class="col"><div style="font-weight:600;">${escapeHtml(m.item)}</div></div>
        <div style="width:90px;"><input type="number" min="1" value="${m.qty}" data-qty="${m.id}" /></div>
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
      const target = job.materials.find(x => x.id === m.id);
      if (target) target.qty = v;
      saveAll();
    });

    list.appendChild(row);
  });
}

$("copyMatsBtn").addEventListener("click", async () => {
  const job = jobs.find(j => j.id === selectedJobId);
  if (!job) return;

  const lines = job.materials.map(m => `${m.qty} × ${m.item}`);
  const text = `Materials List — ${job.name} (${job.type})\n${job.address || ""}\n\n` + (lines.join("\n") || "(none)");

  await navigator.clipboard.writeText(text);
  alert("Materials list copied.");
});

// ----- ESTIMATE -----
$("calcBtn").addEventListener("click", () => {
  const job = jobs.find(j => j.id === selectedJobId);
  if (!job) return;

  const laborHours = num($("laborHours").value);
  const laborRate = num($("laborRate").value);
  const materialsSubtotal = num($("materialsSubtotal").value);
  const markupPct = num($("markupPct").value);
  const tripFee = num($("tripFee").value);

  const labor = laborHours * laborRate;
  const markedMaterials = materialsSubtotal * (1 + markupPct / 100);
  const total = labor + markedMaterials + tripFee;

  $("estimateTotal").value = isFinite(total) ? `$${total.toFixed(2)}` : "";

  job.estimate = { laborHours, laborRate, materialsSubtotal, markupPct, tripFee };
  saveAll();
});

$("copyEstimateBtn").addEventListener("click", async () => {
  const job = jobs.find(j => j.id === selectedJobId);
  if (!job) return;
  const e = job.estimate || {};
  const labor = (num(e.laborHours) * num(e.laborRate));
  const mats = (num(e.materialsSubtotal) * (1 + num(e.markupPct)/100));
  const total = labor + mats + num(e.tripFee);

  const text =
`Estimate — ${job.name} (${job.type})
${job.address || ""}

Labor: ${e.laborHours || 0} hrs × $${e.laborRate || 0}/hr = $${labor.toFixed(2)}
Materials: $${num(e.materialsSubtotal).toFixed(2)} + ${e.markupPct || 0}% = $${mats.toFixed(2)}
Trip/Diagnostic: $${num(e.tripFee).toFixed(2)}

TOTAL: $${total.toFixed(2)}`;

  await navigator.clipboard.writeText(text);
  alert("Estimate copied.");
});

function loadEstimate(job) {
  const e = job.estimate || {};
  $("laborHours").value = e.laborHours ?? "";
  $("laborRate").value = e.laborRate ?? "";
  $("materialsSubtotal").value = e.materialsSubtotal ?? "";
  $("markupPct").value = e.markupPct ?? "";
  $("tripFee").value = e.tripFee ?? "";
  $("estimateTotal").value = "";
}

function num(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

// ----- QUICK REFS -----
$("addQrBtn").addEventListener("click", () => {
  const title = $("qrTitle").value.trim();
  const tag = $("qrTag").value.trim();
  const body = $("qrBody").value.trim();
  if (!title || !body) {
    alert("Add at least a title and some content.");
    return;
  }
  quickRefs.unshift({ id: uid(), title, tag, body, createdAt: nowStr() });
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

  if (filtered.length === 0) {
    list.innerHTML = `<div class="card muted">No quick-refs found.</div>`;
    return;
  }

  filtered.forEach(r => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div>
          <div style="font-weight:700;">${escapeHtml(r.title)}</div>
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

// ----- TEMPLATES -----
const templates = {
  wh40: [
    ["Dielectric nipples / unions", 1],
    ["T&P discharge pipe fittings", 1],
    ["Gas flex or connectors (if applicable)", 1],
    ["Water flex / supply lines", 2],
    ["Ball valve (cold)", 1],
    ["Pan + drain adapter (if needed)", 1],
    ["Venting parts (if needed)", 1]
  ],
  toiletreset: [
    ["Wax ring / seal", 1],
    ["Closet bolts", 1],
    ["Supply line", 1],
    ["Shims", 1],
    ["Caulk", 1]
  ],
  lavrough: [
    ["1-1/2\" trap adapter", 1],
    ["P-trap kit 1-1/4\" or 1-1/2\"", 1],
    ["Angle stop(s)", 2],
    ["Supply line(s)", 2],
    ["San tee / vent fittings (as needed)", 1]
  ]
};

document.querySelectorAll("[data-template]").forEach(btn => {
  btn.addEventListener("click", () => {
    const job = jobs.find(j => j.id === selectedJobId);
    if (!job) {
      alert("Open a job first (Jobs tab), then load a template.");
      return;
    }
    const key = btn.dataset.template;
    const items = templates[key] || [];
    items.forEach(([item, qty]) => job.materials.unshift({ id: uid(), item, qty }));
    saveAll();
    alert("Template added to materials.");
  });
});

function updateTemplateHint() {
  const job = jobs.find(j => j.id === selectedJobId);
  $("templateHint").textContent = job
    ? `Selected job: ${job.name} — ${job.type}`
    : "No job selected. Open a job in the Jobs tab first.";
}

// ----- SERVICE WORKER -----
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

// initial render
setView("jobs");
renderJobs();
renderQuickRefs();
updateTemplateHint();
