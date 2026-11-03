import { ScreenShare } from "../screenshare.js";
import { classFields, classFormValues, teacherShell } from "../shell.js";
import {
  $, $$, CLASS_COLORS, api, attachMenu, avatar, confirmDialog, copyText, debounce, dueLabel, esc, formatBytes,
  formatDate, fragment, hostOf, html, icon, initials, liveEvents, moveIndicator, openModal, raw, setLoading,
  showFieldErrors, timeAgo, toast, toastError,
} from "../ui.js";

const classId = Number(location.pathname.split("/").pop());
const state = {
  cls: null, urls: [], students: [], presence: {}, assignments: [], links: [], activity: [],
  activityMore: false, viewers: 0, focus: null, announcement: null,
};
let openDrawer = null;           // { assignmentId, refresh }

await teacherShell({ active: "classes" });

// ===================================================================== tabs
const tabs = $("#tabs");
function selectTab(name, push = true) {
  $$(".tab", tabs).forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  $$(".tab-panel").forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
  moveIndicator(tabs);
  if (push) history.replaceState(null, "", name === "live" ? location.pathname : `#${name}`);
  if (name === "activity" && !state.activity.length) loadActivity();
}
tabs.addEventListener("click", (e) => { const t = e.target.closest(".tab"); if (t) selectTab(t.dataset.tab); });
tabs.addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const all = $$(".tab", tabs), i = all.indexOf(document.activeElement);
  const next = all[(i + (e.key === "ArrowRight" ? 1 : -1) + all.length) % all.length];
  next.focus(); selectTab(next.dataset.tab);
});
window.addEventListener("resize", debounce(() => moveIndicator(tabs), 100));

// ===================================================================== header
function renderHeader() {
  const c = state.cls;
  document.title = `${c.name} · ClassSync`;
  $("#className").textContent = c.name;
  $("#classSubject").textContent = c.subject || "No subject";
  $("#classCode").textContent = c.code;
  $("#settingsCode").textContent = c.code;
  const sw = $("#classSwatch");
  sw.style.setProperty("--c", CLASS_COLORS[c.color] || CLASS_COLORS[0]);
  sw.textContent = initials(c.name);
}
$("#copyCode").onclick = () => copyText(state.cls.code, "Join code copied");

function setConn(s) {
  const el = $("#conn");
  el.dataset.state = s;
  el.lastElementChild.textContent = s === "open" ? "Live" : s === "connecting" ? "Connecting…" : "Reconnecting…";
}

// ===================================================================== present join code
function presentCode() {
  const url = (state.urls[0] || location.origin) + "/join";
  const body = fragment(html`<div class="present">
    <p class="step-line">Go to</p>
    <div class="url">${url}</div>
    <p class="step-line" style="margin-top:26px">and enter the class code</p>
    <div class="big-code" aria-label="Class code ${state.cls.code}">${state.cls.code.split("").map((ch, i) =>
      raw(`<span style="animation-delay:${i * 60}ms">${esc(ch)}</span>`))}</div>
    <div class="row" style="justify-content:center;flex-wrap:wrap">
      <button class="btn" data-copy-url><i data-icon="copy"></i>Copy link</button>
      <button class="btn" data-fs><i data-icon="maximize"></i>Full screen</button>
    </div>
    <div class="count"><span class="dot dot-on"></span><span data-online>${onlineCount()}</span> students connected</div>
    ${state.urls.length > 1 ? raw(html`<p class="muted small" style="margin-top:14px">Other addresses for this computer: ${state.urls.slice(1).map((u) => u + "/join").join(", ")}</p>`) : ""}
  </div>`);
  const m = openModal({ title: state.cls.name, body, size: "lg", footer: false });
  body.querySelector("[data-copy-url]").onclick = () => copyText(`${url}?code=${state.cls.code}`, "Join link copied");
  body.querySelector("[data-fs]").onclick = () => m.el.requestFullscreen?.().catch(() => {});
  presentCode.counter = body.querySelector("[data-online]");
}
$("#presentBtn").onclick = presentCode;
$("#presentBtn2").onclick = presentCode;

// ===================================================================== screen sharing
const share = new ScreenShare(classId, {
  onState: (on) => renderShare(on),
  onStats: (s) => {
    $("#stageStats").textContent = `${s.width}×${s.height} · ${s.fps.toFixed(1)} fps · ${Math.round(s.kbps)} kbps`;
  },
  onError: (() => { let last = 0; return (err) => { if (Date.now() - last > 8000) { last = Date.now(); toast(err.message, { type: "warning", title: "Frame not sent" }); } }; })(),
});
let qualityPref = "balanced";
try { qualityPref = localStorage.getItem("cs-quality") || "balanced"; } catch {}
share.setQuality(qualityPref);
$$("#quality button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.q === share.quality)));

function renderShare(on) {
  $("#stageIdle").hidden = on;
  $("#preview").hidden = !on;
  $("#stageLive").hidden = !on;
  $("#stageStats").hidden = !on;
  $("#shareStop").hidden = !on;
  $("#liveBar").hidden = !on;
  const badge = $("#screenBadge");
  badge.className = on ? "badge badge-live" : "badge";
  badge.textContent = on ? "Live" : "Off";
  if (on) $("#stageStats").textContent = "Starting…";
  updateLiveBar();
}
function updateLiveBar() {
  const n = state.viewers;
  $("#liveBarText").textContent = `You're sharing your screen · ${n} ${n === 1 ? "student is" : "students are"} watching`;
  $("#viewerCount").textContent = n;
}
$("#shareStart").onclick = async (e) => {
  setLoading(e.currentTarget, true);
  try { await share.start($("#preview")); toast("Students can see your screen now", { type: "success" }); }
  catch (err) {
    if (err.name !== "NotAllowedError" && err.name !== "AbortError") toastError(err, "Couldn't start sharing");
  } finally { setLoading(e.currentTarget, false); }
};
const stopShare = () => share.stop().then(() => toast("Screen sharing stopped"));
$("#shareStop").onclick = stopShare;
$("#liveBarStop").onclick = stopShare;
$("#quality").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  share.setQuality(b.dataset.q);
  try { localStorage.setItem("cs-quality", b.dataset.q); } catch {}
  $$("#quality button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
});
window.addEventListener("beforeunload", (e) => { if (share.active) { e.preventDefault(); e.returnValue = ""; } });

// ===================================================================== links
function renderLinks(highlightId) {
  const ul = $("#recentLinks");
  if (!state.links.length) {
    ul.innerHTML = `<li class="muted small" style="padding-left:8px">Links you send appear here so you can resend them.</li>`;
    return;
  }
  ul.innerHTML = state.links.slice(0, 6).map((l) => html`<li class="${l.id === highlightId ? "just-sent" : ""}">
    <span class="fav">${raw(icon("globe"))}</span>
    <div class="truncate"><div class="u truncate" title="${l.url}">${hostOf(l.url)}${new URL(l.url).pathname.replace(/\/$/, "")}</div>
      <div class="when">Sent ${timeAgo(l.at)}</div></div>
    <span class="acts">
      <button class="btn btn-ghost btn-icon btn-sm" data-resend="${l.url}" aria-label="Send again" title="Send again">${raw(icon("refresh", 16))}</button>
      <a class="btn btn-ghost btn-icon btn-sm" href="${l.url}" target="_blank" rel="noopener" aria-label="Open" title="Open in a new tab">${raw(icon("external", 16))}</a>
    </span></li>`).join("");
}
async function sendLink(url, btn) {
  setLoading(btn, true);
  try {
    const r = await api(`/api/classes/${classId}/links`, { method: "POST", body: { url } });
    state.links = [r.link, ...state.links.filter((l) => l.url !== r.link.url)];
    renderLinks(r.link.id);
    toast(r.delivered ? `Opened on ${r.delivered} ${r.delivered === 1 ? "computer" : "computers"}` : "Sent — nobody is connected yet",
          { type: r.delivered ? "success" : "info", title: hostOf(r.link.url) });
    return true;
  } catch (err) {
    if (!showFieldErrors($("#linkForm"), err.fields)) toastError(err);
    return false;
  } finally { setLoading(btn, false); }
}
$("#linkForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#linkUrl");
  if (!input.value.trim()) return input.focus();
  if (await sendLink(input.value, e.submitter || e.target.querySelector("button"))) input.value = "";
});
$("#linkUrl").addEventListener("input", (e) => e.target.closest(".field").classList.remove("has-error"));
$("#recentLinks").addEventListener("click", (e) => {
  const b = e.target.closest("[data-resend]"); if (b) sendLink(b.dataset.resend, b);
});

// ===================================================================== focus & announcement
function renderFocus() {
  $("#focusToggle").checked = !!state.focus;
  $("#focusPanel").classList.toggle("focus-on", !!state.focus);
  if (state.focus && document.activeElement !== $("#focusMsg")) $("#focusMsg").value = state.focus.message || "";
}
async function setFocus(active) {
  try {
    const r = await api(`/api/classes/${classId}/focus`, { method: "POST", body: { active, message: $("#focusMsg").value } });
    state.focus = r.focus;
    renderFocus();
    toast(active ? "Focus mode is on — student screens are covered" : "Focus mode is off", { type: active ? "success" : "info" });
  } catch (err) { toastError(err); renderFocus(); }
}
$("#focusToggle").addEventListener("change", (e) => setFocus(e.target.checked));
$("#focusMsg").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); setFocus(true); } });
$("#focusMsg").addEventListener("change", () => state.focus && setFocus(true));

function renderAnnouncement() {
  const p = $("#pinned");
  p.hidden = !state.announcement;
  if (state.announcement) p.querySelector("p").textContent = state.announcement.text;
}
$("#announceText").addEventListener("input", (e) => { $("#announceCount").textContent = `${e.target.value.length} / 500`; });
$("#announceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#announceText").value.trim();
  if (!text) return $("#announceText").focus();
  const btn = e.submitter || e.target.querySelector("button");
  setLoading(btn, true);
  try {
    const r = await api(`/api/classes/${classId}/announce`, { method: "POST", body: { text } });
    state.announcement = r.announcement;
    renderAnnouncement();
    $("#announceText").value = ""; $("#announceCount").textContent = "0 / 500";
    toast("Announcement pinned for everyone", { type: "success" });
  } catch (err) { toastError(err); } finally { setLoading(btn, false); }
});
$("#unpin").onclick = async () => {
  try {
    await api(`/api/classes/${classId}/announce`, { method: "POST", body: { text: "" } });
    state.announcement = null; renderAnnouncement();
    toast("Announcement removed");
  } catch (err) { toastError(err); }
};

// ===================================================================== students
const onlineCount = () => Object.values(state.presence).filter((p) => p.portal || p.agent).length;

function renderStudents() {
  const q = $("#studentSearch").value.trim().toLowerCase();
  const list = state.students.filter((s) => !q || s.name.toLowerCase().includes(q));
  $("#countStudents").textContent = state.students.length;
  const on = onlineCount();
  $("#onlineSummary").textContent = state.students.length ? `${on} of ${state.students.length} online` : "";
  if (presentCode.counter?.isConnected) presentCode.counter.textContent = on;
  const box = $("#studentTable");
  if (!state.students.length) {
    box.innerHTML = "";
    box.append(fragment(html`<div class="empty"><div class="empty-art"><i data-icon="user-plus"></i></div>
      <h3>No students yet</h3>
      <p>Show the join code on the projector. Students open the join page, type the code and their name.</p>
      <button class="btn btn-primary" data-present><i data-icon="present"></i>Show join code</button></div>`));
    box.querySelector("[data-present]").onclick = presentCode;
    return;
  }
  if (!list.length) { box.innerHTML = `<div class="empty"><h3>No matches</h3><p>No student name contains “${esc(q)}”.</p></div>`; return; }
  box.innerHTML = html`<table class="table"><thead><tr><th>Student</th><th>Status</th><th>Joined</th><th>Handed in</th><th></th></tr></thead><tbody>
    ${list.map((s) => {
      const p = state.presence[s.id] || {};
      const online = p.portal || p.agent;
      return raw(html`<tr data-id="${s.id}">
        <td><div class="who">${raw(avatar(s.name))}<b>${s.name}</b></div></td>
        <td><span class="status"><span class="dot ${online ? "dot-on" : ""}"></span>${online ? "Online" : `Last seen ${timeAgo(s.last_seen)}`}
          ${online ? raw(`<span class="via">${p.agent ? '<span class="badge badge-pen" title="Desktop helper — links open automatically">Helper</span>' : ""}${p.portal ? '<span class="badge" title="Student portal open in a browser">Browser</span>' : ""}</span>`) : ""}</span></td>
        <td class="muted">${formatDate(s.joined_at)}</td>
        <td>${s.submitted}</td>
        <td style="text-align:right"><button class="btn btn-ghost btn-icon btn-sm" data-menu="${s.id}" aria-label="Actions for ${s.name}">${raw(icon("more"))}</button></td>
      </tr>`);
    })}</tbody></table>`;
  $$("[data-menu]", box).forEach((b) => {
    const s = state.students.find((x) => x.id === Number(b.dataset.menu));
    attachMenu(b, () => [{ label: "Remove from class", icon: "trash", danger: true, onClick: () => removeStudent(s) }]);
  });
}
$("#studentSearch").addEventListener("input", debounce(renderStudents, 120));

async function loadStudents() {
  const { students } = await api(`/api/classes/${classId}/students`);
  state.students = students;
  for (const s of students) state.presence[s.id] = { portal: s.portal, agent: s.agent };
  renderStudents();
}
async function removeStudent(s) {
  const ok = await confirmDialog({ title: `Remove ${s.name}?`, danger: true, confirmLabel: "Remove student",
    message: "They'll be disconnected and their submitted files will be deleted. They can join again with the class code." });
  if (!ok) return;
  try {
    await api(`/api/classes/${classId}/students/${s.id}`, { method: "DELETE" });
    state.students = state.students.filter((x) => x.id !== s.id);
    delete state.presence[s.id];
    renderStudents();
    toast(`${s.name} was removed`);
  } catch (err) { toastError(err); }
}

// ===================================================================== assignments
function renderAssignments() {
  const ul = $("#assignmentList");
  $("#countAssignments").textContent = state.assignments.filter((a) => a.is_open).length;
  if (!state.assignments.length) {
    ul.innerHTML = "";
    ul.append(fragment(html`<li class="empty"><div class="empty-art"><i data-icon="inbox"></i></div>
      <h3>No assignments yet</h3>
      <p>Create one and an upload page opens on every student's screen. You'll see who has handed in as it happens.</p>
      <button class="btn btn-primary" data-new><i data-icon="plus"></i>New assignment</button></li>`));
    ul.querySelector("[data-new]").onclick = () => assignmentModal();
    return;
  }
  ul.innerHTML = state.assignments.map((a) => {
    const pct = a.total ? Math.round((a.submitted / a.total) * 100) : 0;
    const overdue = a.is_open && a.due_at && a.due_at < Date.now() / 1000;
    return html`<li class="a-row ${a.is_open ? "" : "closed"}" data-id="${a.id}">
      <div style="min-width:0">
        <div class="a-title"><h3 class="truncate">${a.title}</h3>
          ${raw(a.is_open ? (overdue ? '<span class="badge badge-amber">Past due</span>' : '<span class="badge badge-green">Accepting</span>') : '<span class="badge">Closed</span>')}</div>
        <div class="a-meta">
          <span>${raw(icon("calendar"))}${dueLabel(a.due_at)}</span>
          <span>${raw(icon("file"))}${a.allowed_ext.length ? a.allowed_ext.map((e) => "." + e).join(" ") : "Any file type"} · up to ${a.max_mb} MB</span>
        </div>
      </div>
      <div class="a-progress"><div class="num"><span>${a.submitted} of ${a.total} handed in</span><span>${pct}%</span></div>
        <div class="progress"><i style="width:${pct}%"></i></div></div>
      <div class="a-actions">
        <button class="btn btn-sm" data-subs="${a.id}">${raw(icon("users", 16))}Submissions</button>
        <button class="btn btn-ghost btn-icon btn-sm" data-amenu="${a.id}" aria-label="More actions">${raw(icon("more"))}</button>
      </div></li>`;
  }).join("");
  $$("[data-subs]", ul).forEach((b) => (b.onclick = () => submissionsDrawer(Number(b.dataset.subs))));
  $$("[data-amenu]", ul).forEach((b) => {
    const a = state.assignments.find((x) => x.id === Number(b.dataset.amenu));
    attachMenu(b, () => [
      { label: "Edit", icon: "edit", onClick: () => assignmentModal(a) },
      a.is_open ? { label: "Stop accepting", icon: "lock", onClick: () => toggleAssignment(a, false) }
                : { label: "Reopen", icon: "refresh", onClick: () => toggleAssignment(a, true) },
      { label: "Download all (.zip)", icon: "download", onClick: () => downloadZip(a) },
      "-",
      { label: "Delete", icon: "trash", danger: true, onClick: () => deleteAssignment(a) },
    ]);
  });
}
async function loadAssignments() {
  const { assignments } = await api(`/api/classes/${classId}/assignments`);
  state.assignments = assignments;
  renderAssignments();
}
const refreshAssignments = debounce(() => loadAssignments().catch(() => {}), 300);

function toLocalInput(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function assignmentModal(a = null) {
  const form = fragment(html`<form class="stack" style="--gap:18px" novalidate>
    <div class="field"><label for="a-title">Title</label>
      <input class="input" id="a-title" name="title" value="${a?.title || ""}" placeholder="e.g. Lab 3 — Loops" maxlength="120" autofocus></div>
    <div class="field"><label for="a-desc">Instructions <span class="muted" style="font-weight:400">(optional)</span></label>
      <textarea class="input" id="a-desc" name="description" maxlength="4000" placeholder="What should students hand in?">${a?.description || ""}</textarea></div>
    <div class="row" style="--gap:14px;align-items:flex-start;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:200px"><label for="a-due">Due <span class="muted" style="font-weight:400">(optional)</span></label>
        <input class="input" id="a-due" name="due" type="datetime-local" value="${toLocalInput(a?.due_at)}">
        <span class="hint">Late work is still accepted and marked late.</span></div>
      <div class="field" style="width:150px"><label for="a-max">Max file size</label>
        <select class="input" id="a-max" name="max_mb">${[5, 10, 25, 50, 100, 250].map((n) =>
          raw(`<option value="${n}" ${n === (a?.max_mb || 25) ? "selected" : ""}>${n} MB</option>`))}</select></div>
    </div>
    <div class="field"><label for="a-ext">Accepted file types <span class="muted" style="font-weight:400">(optional)</span></label>
      <input class="input" id="a-ext" name="allowed_ext" value="${(a?.allowed_ext || []).join(", ")}" placeholder="pdf, docx, py — leave empty to accept anything"></div>
  </form>`);
  const foot = fragment(`<div class="row"><button class="btn btn-ghost" data-cancel>Cancel</button>
    <button class="btn btn-primary" data-save>${a ? "Save changes" : "Create and open"}</button></div>`);
  const m = openModal({ title: a ? "Edit assignment" : "New assignment",
    description: a ? "" : "An upload page opens on every connected student's screen.", body: form, footer: foot });
  foot.querySelector("[data-cancel]").onclick = () => m.close();
  const save = async () => {
    const btn = foot.querySelector("[data-save]");
    const due = form.due.value ? Math.floor(new Date(form.due.value).getTime() / 1000) : null;
    const body = { title: form.title.value.trim(), description: form.description.value.trim(), due_at: due,
                   max_mb: Number(form.max_mb.value), allowed_ext: form.allowed_ext.value };
    if (body.title.length < 2) return showFieldErrors(form, { title: "Give the assignment a title" });
    setLoading(btn, true);
    try {
      await api(a ? `/api/assignments/${a.id}` : `/api/classes/${classId}/assignments`, { method: a ? "PATCH" : "POST", body });
      m.close();
      await loadAssignments();
      toast(a ? "Assignment updated" : "Assignment opened — students can upload now", { type: "success" });
    } catch (err) {
      setLoading(btn, false);
      if (!showFieldErrors(form, { ...err.fields, ...(err.fields?.due_at ? { due: err.fields.due_at } : {}) })) toastError(err);
    }
  };
  foot.querySelector("[data-save]").onclick = save;
  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
}
$("#newAssignment").onclick = () => assignmentModal();

async function toggleAssignment(a, open) {
  try {
    await api(`/api/assignments/${a.id}`, { method: "PATCH", body: { is_open: open } });
    await loadAssignments();
    toast(open ? `“${a.title}” is accepting submissions again` : `“${a.title}” no longer accepts submissions`);
  } catch (err) { toastError(err); }
}
async function deleteAssignment(a) {
  const ok = await confirmDialog({ title: `Delete “${a.title}”?`, danger: true, confirmLabel: "Delete assignment",
    message: `This deletes the assignment and all ${a.submitted} students' uploaded files. This can't be undone.` });
  if (!ok) return;
  try { await api(`/api/assignments/${a.id}`, { method: "DELETE" }); await loadAssignments(); toast("Assignment deleted"); }
  catch (err) { toastError(err); }
}
function downloadZip(a) {
  if (!a.submitted) return toast("Nothing to download yet — no one has handed in.", { type: "info" });
  location.href = `/api/assignments/${a.id}/zip`;
}

function submissionsDrawer(assignmentId) {
  let filter = "all", rows = [], assignment = null, flashId = null;
  const body = fragment(`<div>
    <div class="sub-summary" data-summary></div>
    <div class="sub-toolbar">
      <div class="segmented" data-filter>
        <button data-f="all" aria-pressed="true">Everyone</button>
        <button data-f="in" aria-pressed="false">Handed in</button>
        <button data-f="missing" aria-pressed="false">Missing</button>
      </div>
      <span class="spacer"></span>
      <button class="btn btn-sm" data-zip>${icon("download", 16)}Download all (.zip)</button>
    </div>
    <div class="table-scroll" data-table><div style="padding:24px"><div class="skeleton" style="height:180px"></div></div></div>
  </div>`);
  const m = openModal({ title: "Submissions", body, drawer: true, footer: false, onClose: () => { openDrawer = null; } });

  const draw = () => {
    const a = assignment;
    m.el.querySelector("#dlg-title").textContent = a.title;
    const handed = rows.filter((r) => r.status !== "missing").length;
    const late = rows.filter((r) => r.status === "late").length;
    body.querySelector("[data-summary]").innerHTML = html`
      <div><b>${handed}<span class="muted" style="font-size:15px;font-weight:500"> / ${rows.length}</span></b><span>Handed in</span></div>
      <div><b>${rows.length - handed}</b><span>Missing</span></div>
      <div><b>${late}</b><span>Late</span></div>
      <div><b style="font-size:15px;padding-top:6px">${dueLabel(a.due_at)}</b><span>${a.is_open ? "Accepting submissions" : "Closed"}</span></div>`;
    const shown = rows.filter((r) => filter === "all" || (filter === "in" ? r.status !== "missing" : r.status === "missing"));
    const table = body.querySelector("[data-table]");
    if (!rows.length) { table.innerHTML = `<div class="empty"><h3>No students in this class yet</h3></div>`; return; }
    if (!shown.length) { table.innerHTML = `<div class="empty"><h3>${filter === "missing" ? "Everyone has handed in" : "Nobody has handed in yet"}</h3></div>`; return; }
    table.innerHTML = html`<table class="table"><thead><tr><th>Student</th><th>Status</th><th>Files</th><th>Handed in</th></tr></thead><tbody>
      ${shown.map((r) => raw(html`<tr class="${r.student_id === flashId ? "row-new" : ""}">
        <td><div class="who">${raw(avatar(r.name, "sm"))}<b>${r.name}</b></div></td>
        <td>${raw(r.status === "missing" ? '<span class="badge">Missing</span>' : r.status === "late" ? '<span class="badge badge-amber">Late</span>' : '<span class="badge badge-green">Handed in</span>')}
          ${r.versions > 1 ? raw(html`<div class="muted small" style="margin-top:4px">Version ${r.versions}</div>`) : ""}</td>
        <td>${r.files.map((f) => raw(html`<a class="file-chip" href="/api/submissions/${f.id}/file" title="${f.name} · ${formatBytes(f.size)}">${raw(icon("file"))}<span class="truncate">${f.name}</span></a>`))}
          ${r.note ? raw(html`<div class="note-line">“${r.note}”</div>`) : ""}</td>
        <td class="muted">${r.submitted_at ? timeAgo(r.submitted_at) : "—"}</td></tr>`))}
    </tbody></table>`;
    flashId = null;
  };
  const refresh = async (sid) => {
    try {
      const r = await api(`/api/assignments/${assignmentId}/submissions`);
      assignment = r.assignment; rows = r.rows; flashId = sid ?? null;
      draw();
    } catch (err) { toastError(err); }
  };
  body.querySelector("[data-filter]").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    filter = b.dataset.f;
    $$("button", e.currentTarget).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    draw();
  });
  body.querySelector("[data-zip]").onclick = () => downloadZip({ id: assignmentId, submitted: rows.filter((r) => r.status !== "missing").length });
  openDrawer = { assignmentId, refresh };
  refresh();
}

// ===================================================================== activity
const ACT = {
  link: ["link", (d) => html`Opened <b>${hostOf(d.url)}</b> for everyone`],
  screen_on: ["cast", () => "Started sharing the screen"],
  screen_off: ["stop", (d) => d.reason === "timeout" ? "Screen sharing ended (connection lost)" : "Stopped sharing the screen"],
  focus_on: ["target", (d) => html`Turned on focus mode — “${d.message}”`],
  focus_off: ["target", () => "Turned off focus mode"],
  announcement: ["megaphone", (d) => html`Pinned: “${d.text}”`],
  student_joined: ["user-plus", (d) => html`<b>${d.name}</b> joined the class`],
  student_removed: ["trash", (d) => html`Removed <b>${d.name}</b>`],
  assignment_created: ["inbox", (d) => html`Opened assignment <b>${d.title}</b>`],
  assignment_opened: ["refresh", (d) => html`Reopened <b>${d.title}</b>`],
  assignment_closed: ["lock", (d) => html`Stopped accepting <b>${d.title}</b>`],
  assignment_deleted: ["trash", (d) => html`Deleted assignment <b>${d.title}</b>`],
  submission: ["file-check", (d) => html`<b>${d.name}</b> handed in <b>${d.assignment}</b>${d.version > 1 ? ` (version ${d.version})` : ""}${d.late ? " — late" : ""}`],
  class_created: ["book", (d) => html`Created the class`],
  code_changed: ["refresh", () => "Generated a new join code"],
};
function activityItem(it, isNew = false) {
  const [ic, text] = ACT[it.kind] || ["info", () => esc(it.kind)];
  return `<li class="${isNew ? "new" : ""}"><span class="ti k-${esc(it.kind)}">${icon(ic)}</span>
    <div class="tx">${text(it.data || {})}<small>${esc(formatDate(it.created_at, true))} · ${esc(timeAgo(it.created_at))}</small></div></li>`;
}
function renderActivity() {
  const ul = $("#timeline");
  ul.innerHTML = state.activity.length ? state.activity.map((i) => activityItem(i)).join("")
    : `<li class="empty" style="border:0"><div class="empty-art">${icon("activity")}</div><h3>Nothing yet</h3><p>Links, joins and submissions will appear here.</p></li>`;
  $("#moreWrap").hidden = !state.activityMore;
}
async function loadActivity(more = false) {
  const before = more && state.activity.length ? state.activity.at(-1).id : 0;
  const r = await api(`/api/classes/${classId}/activity${before ? `?before=${before}` : ""}`);
  state.activity = more ? [...state.activity, ...r.items] : r.items;
  state.activityMore = r.has_more;
  renderActivity();
}
$("#moreActivity").onclick = (e) => { setLoading(e.target, true); loadActivity(true).finally(() => setLoading(e.target, false)); };

// ===================================================================== settings
function renderSettings() {
  const slot = $("#detailsSlot");
  slot.innerHTML = "";
  const form = classFields(state.cls);
  form.querySelector("#cls-name").removeAttribute("autofocus");
  form.append(fragment(`<div class="row"><span class="spacer"></span><button class="btn btn-primary" type="submit">Save changes</button></div>`));
  slot.append(form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    setLoading(btn, true);
    try {
      const { class: c } = await api(`/api/classes/${classId}`, { method: "PATCH", body: classFormValues(form) });
      Object.assign(state.cls, c);
      renderHeader();
      toast("Class details saved", { type: "success" });
    } catch (err) { if (!showFieldErrors(form, err.fields)) toastError(err); }
    finally { setLoading(btn, false); }
  });
}
$("#regenCode").onclick = async (e) => {
  const ok = await confirmDialog({ title: "Generate a new join code?", confirmLabel: "Generate new code",
    message: "The current code stops working right away. Students who already joined stay in the class." });
  if (!ok) return;
  setLoading(e.target.closest("button"), true);
  try {
    const { code } = await api(`/api/classes/${classId}/code`, { method: "POST" });
    state.cls.code = code; renderHeader();
    toast(`New join code: ${code}`, { type: "success" });
  } catch (err) { toastError(err); } finally { setLoading(e.target.closest("button"), false); }
};
$("#deleteClass").onclick = async () => {
  const ok = await confirmDialog({ title: `Delete “${state.cls.name}”?`, danger: true, confirmLabel: "Delete class forever",
    message: `${state.students.length} students, ${state.assignments.length} assignments and every uploaded file will be permanently deleted.` });
  if (!ok) return;
  try { await share.stop(); await api(`/api/classes/${classId}`, { method: "DELETE" }); location.href = "/dashboard"; }
  catch (err) { toastError(err); }
};

// ===================================================================== live events
function connectEvents() {
  liveEvents(`/api/classes/${classId}/events`, {
    hello: (d) => {
      state.presence = {};
      for (const [sid, p] of Object.entries(d.presence)) state.presence[sid] = p;
      state.viewers = d.viewers; updateLiveBar(); renderStudents();
    },
    presence: (d) => {
      const before = state.presence[d.student_id];
      state.presence[d.student_id] = { portal: d.portal, agent: d.agent };
      if (!state.students.some((s) => s.id === d.student_id)) return loadStudents();
      const s = state.students.find((x) => x.id === d.student_id);
      if (!d.online && (before?.portal || before?.agent)) s.last_seen = Date.now() / 1000;
      renderStudents();
    },
    roster: () => loadStudents().then(refreshAssignments),
    viewers: (d) => { state.viewers = d.count; updateLiveBar(); },
    screen: (d) => {
      if (!d.active && share.active && d.reason === "timeout") toast("Sharing paused — reconnecting your stream…", { type: "warning" });
    },
    focus: (d) => { state.focus = d.active ? d : null; renderFocus(); },
    assignments: () => refreshAssignments(),
    submission: (d) => {
      toast(`${d.name} handed in ${d.file}`, { type: "success", title: "New submission", duration: 3500 });
      refreshAssignments();
      const s = state.students.find((x) => x.id === d.student_id);
      if (openDrawer && openDrawer.assignmentId === d.assignment_id) openDrawer.refresh(d.student_id);
      if (s) loadStudents().catch(() => {});
    },
    activity: (item) => {
      if (!state.activity.length && $("#tab-activity").hidden) return;
      state.activity.unshift(item);
      const ul = $("#timeline");
      if (ul.querySelector(".empty")) renderActivity();
      else ul.insertAdjacentHTML("afterbegin", activityItem(item, true));
    },
  }, setConn);
}

// ===================================================================== boot
try {
  const [{ class: cls, urls }, links] = await Promise.all([
    api(`/api/classes/${classId}`), api(`/api/classes/${classId}/links`),
  ]);
  state.cls = cls; state.urls = urls; state.links = links.links;
  state.focus = cls.live.focus; state.announcement = cls.live.announcement; state.viewers = cls.live.viewers;
  renderHeader(); renderLinks(); renderFocus(); renderAnnouncement(); renderSettings();
  await Promise.all([loadStudents(), loadAssignments()]);
  if (cls.live.screen) {   // a previous tab was sharing; that stream is gone with it
    api(`/api/classes/${classId}/screen`, { method: "POST", body: { active: false } }).catch(() => {});
  }
  connectEvents();
  const initial = location.hash.slice(1);
  selectTab(["assignments", "students", "activity", "settings"].includes(initial) ? initial : "live", false);
  requestAnimationFrame(() => moveIndicator(tabs));
  if (new URLSearchParams(location.search).get("new")) {
    history.replaceState(null, "", location.pathname);
    presentCode();
  }
  setInterval(() => { if (!$("#tab-students").hidden) renderStudents(); renderLinks(); }, 30000);
} catch (err) {
  document.querySelector("main").innerHTML = "";
  document.querySelector("main").append(fragment(html`<div class="empty" style="padding-top:90px">
    <div class="empty-art"><i data-icon="alert"></i></div><h3>This class couldn't be loaded</h3><p>${err.message}</p>
    <a class="btn" href="/dashboard">Back to classes</a></div>`));
}
