import {
  $, $$, api, attachMenu, avatar, dueLabel, esc, formatBytes, fragment, hostOf, html, icon, initChrome,
  liveEvents, raw, timeAgo, toast, uploadFile,
} from "../ui.js";

initChrome();

const state = { me: null, cls: null, links: [], tasks: [], presence: { portal: 0, agent: 0 }, screen: false, openTask: null };
const pending = new Map();            // assignmentId -> File[]
let events;

// ===================================================================== chrome
function renderHeader() {
  document.title = `${state.cls.name} · ClassSync`;
  $("#className").textContent = state.cls.name;
  $("#teacherName").textContent = `with ${state.cls.teacher}`;
  $("#waitTitle").textContent = `Waiting for ${state.cls.teacher.split(" ")[0]}`;
  const me = $("#meMenu");
  me.innerHTML = `${avatar(state.me.name, "sm")}<span class="truncate hide-sm" style="max-width:150px">${esc(state.me.name)}</span>${icon("chevron-down", 16)}`;
}
attachMenu($("#meMenu"), () => [
  { header: html`<div style="font-weight:650">${state.me.name}</div><div class="muted small">${state.cls.name}</div>` },
  { label: "Leave class on this device", icon: "log-out", danger: true, onClick: leave },
]);
async function leave() {
  events?.close();
  await api("/api/s/leave", { method: "POST" }).catch(() => {});
  location.href = "/join";
}
function setConn(s) {
  const el = $("#conn");
  el.dataset.state = s;
  el.lastElementChild.textContent = s === "open" ? "Connected" : s === "connecting" ? "Connecting…" : "Reconnecting…";
}

// ===================================================================== screen
const img = $("#screen");
let retry;
function setScreen(active) {
  state.screen = active;
  $("#waiting").hidden = active;
  img.hidden = !active;
  $("#liveTag").hidden = !active;
  $("#vtools").hidden = !active;
  $("#viewerCaption").hidden = !active;
  clearTimeout(retry);
  if (active) {
    img.src = `/api/s/screen?t=${Date.now()}`;
    $("#viewer").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else {
    img.removeAttribute("src");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
}
img.addEventListener("error", () => {
  if (!state.screen) return;
  clearTimeout(retry);
  retry = setTimeout(() => state.screen && (img.src = `/api/s/screen?t=${Date.now()}`), 1500);
});
const toggleFs = () => document.fullscreenElement ? document.exitFullscreen() : $("#viewer").requestFullscreen?.().catch(() => {});
$("#fsBtn").onclick = toggleFs;
$("#viewer").addEventListener("dblclick", () => state.screen && toggleFs());

// ===================================================================== focus & announcement
function setFocus(f) {
  const el = $("#focus");
  el.hidden = !f.active;
  if (f.active) $("#focusMsg").textContent = f.message || "Eyes on the teacher, please";
  document.body.style.overflow = f.active ? "hidden" : "";
  document.body.classList.toggle("focus-active", !!f.active);
  if (f.active && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function setAnnouncement(a) {
  const bar = $("#announce");
  if (!a || !a.text) { bar.hidden = true; return; }
  bar.querySelector("p").textContent = a.text;
  bar.querySelector("small").textContent = a.at ? timeAgo(a.at) : "";
  bar.hidden = false;
  bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = "";
}

// ===================================================================== links
function renderLinks(freshId) {
  const ul = $("#feed");
  $("#helperTip").hidden = !!state.presence.agent;
  if (!state.links.length) {
    ul.innerHTML = `<li class="muted small" style="padding:18px 20px">Nothing yet. When your teacher sends a link it lands here${state.presence.agent ? " and opens by itself" : ""}.</li>`;
    return;
  }
  ul.innerHTML = state.links.map((l) => {
    let path = "";
    try { const u = new URL(l.url); path = (u.pathname + u.search).replace(/^\/$/, ""); } catch {}
    return html`<li class="${l.id === freshId ? "fresh" : ""}">
      <span class="fav">${raw(icon("globe"))}</span>
      <div class="truncate" style="flex:1"><div class="host truncate">${l.title || hostOf(l.url)}</div>
        <div class="path truncate">${path || hostOf(l.url)} · ${timeAgo(l.at)}</div></div>
      <a class="btn btn-sm ${l.id === freshId ? "btn-primary" : ""}" href="${l.url}" target="_blank" rel="noopener noreferrer">Open${raw(icon("external", 15))}</a></li>`;
  }).join("");
}
function onLink(l) {
  state.links = [l, ...state.links.filter((x) => x.id !== l.id)].slice(0, 15);
  renderLinks(l.id);
  if (state.presence.agent) {
    toast(`Opened ${hostOf(l.url)} in your browser`, { type: "success", title: "Your teacher shared a link" });
  } else {
    toast(hostOf(l.url), { type: "info", title: "Your teacher shared a link", duration: 12000,
                           action: { label: "Open link", onClick: () => window.open(l.url, "_blank", "noopener") } });
  }
}

// ===================================================================== assignments
function taskStatus(t) {
  if (t.version) return t.late ? `<span class="badge badge-amber">Handed in late</span>` : `<span class="badge badge-green">Handed in</span>`;
  if (!t.is_open) return `<span class="badge">Closed</span>`;
  return `<span class="badge badge-pen">To do</span>`;
}
function renderTasks(flashId) {
  const box = $("#tasks");
  const todo = state.tasks.filter((t) => t.is_open && !t.version).length;
  const count = $("#taskCount");
  count.hidden = !todo; count.textContent = `${todo} to do`;
  if (!state.tasks.length) {
    box.innerHTML = `<div class="muted small" style="padding:18px 20px">No assignments right now. When your teacher opens one, an upload box appears here.</div>`;
    return;
  }
  box.innerHTML = state.tasks.map((t) => html`<div class="task ${state.openTask === t.id ? "open" : ""} ${flashId === t.id ? "flash" : ""}" data-id="${t.id}">
    <button class="task-head" aria-expanded="${String(state.openTask === t.id)}">
      <div style="min-width:0;flex:1">
        <div class="row" style="--gap:8px;flex-wrap:wrap"><h3>${t.title}</h3>${raw(taskStatus(t))}</div>
        <div class="meta">${dueLabel(t.due_at)}</div>
      </div>
      <span class="chev">${raw(icon("chevron-down"))}</span>
    </button>
    <div class="task-body"><div><div class="task-inner">
      ${t.description ? raw(html`<div class="task-desc">${t.description}</div>`) : ""}
      ${t.version ? raw(html`<div class="handed ${t.late ? "late" : ""}">${raw(icon("check-circle"))}<div>
          <b>${t.late ? "Handed in late" : "Handed in"} ${timeAgo(t.submitted_at)}</b>${t.version > 1 ? ` · version ${t.version}` : ""}
          <div>${t.files.map((f) => raw(html`<a class="file-chip" href="/api/s/files/${f.id}">${raw(icon("file"))}<span class="truncate">${f.name}</span></a>`))}</div>
        </div></div>`) : ""}
      ${t.is_open ? raw(html`
        <label class="dropzone" data-drop>
          ${raw(icon("upload"))}
          <span><b>Choose files</b> or drag them here</span>
          <span class="small">${t.allowed_ext.length ? t.allowed_ext.map((e) => "." + e).join(", ") : "Any file type"} · up to ${t.max_mb} MB each</span>
          <input type="file" multiple hidden data-input ${raw(t.allowed_ext.length ? `accept="${t.allowed_ext.map((e) => "." + e).join(",")}"` : "")}>
        </label>
        <div class="pending" data-pending></div>
        <input class="input" data-note maxlength="500" placeholder="Add a note for your teacher (optional)">
        <button class="btn btn-primary btn-block" data-submit disabled>${t.version ? "Hand in a new version" : "Hand in"}</button>
        ${t.version ? raw(`<p class="muted small" style="text-align:center">Handing in again replaces the files your teacher sees.</p>`) : ""}`)
      : raw(`<p class="muted small">This assignment is closed.</p>`)}
    </div></div></div></div>`).join("");

  $$(".task", box).forEach((el) => wireTask(el, state.tasks.find((t) => t.id === Number(el.dataset.id))));
}

function wireTask(el, t) {
  el.querySelector(".task-head").onclick = () => {
    const open = !el.classList.contains("open");
    $$(".task.open").forEach((x) => { x.classList.remove("open"); x.querySelector(".task-head").setAttribute("aria-expanded", "false"); });
    el.classList.toggle("open", open);
    el.querySelector(".task-head").setAttribute("aria-expanded", String(open));
    state.openTask = open ? t.id : null;
  };
  if (!t.is_open) return;
  const drop = el.querySelector("[data-drop]"), input = el.querySelector("[data-input]");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(el, t, e.dataTransfer.files); });
  input.addEventListener("change", () => { addFiles(el, t, input.files); input.value = ""; });
  el.querySelector("[data-submit]").onclick = () => submit(el, t);
  drawPending(el, t);
}

function problemFor(t, f) {
  const ext = f.name.includes(".") ? f.name.split(".").pop().toLowerCase() : "";
  if (t.allowed_ext.length && !t.allowed_ext.includes(ext)) return `Only ${t.allowed_ext.map((e) => "." + e).join(", ")} files`;
  if (f.size > t.max_mb * 1024 * 1024) return `Larger than ${t.max_mb} MB`;
  if (!f.size) return "File is empty";
  return null;
}
function addFiles(el, t, list) {
  const files = pending.get(t.id) || [];
  for (const f of list) if (!files.some((x) => x.name === f.name && x.size === f.size)) files.push(f);
  pending.set(t.id, files.slice(0, 20));
  drawPending(el, t);
}
function drawPending(el, t) {
  const files = pending.get(t.id) || [];
  const box = el.querySelector("[data-pending]");
  box.innerHTML = files.map((f, i) => {
    const bad = problemFor(t, f);
    return html`<div class="pending-item ${bad ? "bad" : ""}" data-i="${i}">${raw(icon(bad ? "alert" : "file"))}
      <div class="truncate" style="flex:1"><div class="truncate">${f.name}</div>${bad ? raw(html`<div class="small">${bad}</div>`) : raw('<div class="bar"><i></i></div>')}</div>
      <span class="size">${formatBytes(f.size)}</span>
      <button class="btn btn-ghost btn-icon btn-sm" data-rm="${i}" aria-label="Remove ${f.name}">${raw(icon("x", 15))}</button></div>`;
  }).join("");
  box.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => {
    files.splice(Number(b.dataset.rm), 1); drawPending(el, t);
  });
  const ok = files.length && files.every((f) => !problemFor(t, f));
  el.querySelector("[data-submit]").disabled = !ok;
}

async function submit(el, t) {
  const files = pending.get(t.id) || [];
  const btn = el.querySelector("[data-submit]");
  const note = el.querySelector("[data-note]").value.trim();
  btn.disabled = true;
  btn.textContent = "Uploading…";
  el.querySelectorAll("[data-rm]").forEach((b) => (b.disabled = true));
  try {
    for (const [i, f] of files.entries()) {
      const row = el.querySelector(`[data-i="${i}"]`);
      const bar = row.querySelector(".bar i");
      await uploadFile(`/api/s/assignments/${t.id}/files`, f, {
        headers: { "X-Filename": encodeURIComponent(f.name), "X-Batch": i === 0 ? "new" : "same",
                   ...(note && i === 0 ? { "X-Note": encodeURIComponent(note) } : {}) },
        onProgress: (p) => { bar.style.width = `${Math.round(p * 100)}%`; },
      });
      row.classList.add("done");
      row.querySelector(".i").outerHTML = icon("check-circle");
    }
    pending.delete(t.id);
    toast(`${files.length} ${files.length === 1 ? "file" : "files"} handed in for “${t.title}”`, { type: "success", title: "Handed in" });
    await loadTasks(t.id);
  } catch (err) {
    toast(err.message, { type: "error", title: "Upload failed" });
    btn.disabled = false;
    btn.textContent = t.version ? "Hand in a new version" : "Hand in";
    el.querySelectorAll("[data-rm]").forEach((b) => (b.disabled = false));
  }
}

async function loadTasks(flashId) {
  const { assignments } = await api("/api/s/assignments");
  state.tasks = assignments;
  if (state.openTask == null) state.openTask = assignments.find((t) => t.is_open && !t.version)?.id ?? null;
  renderTasks(flashId);
}

// ===================================================================== removed
function showRemoved(reason) {
  events?.close();
  document.body.innerHTML = "";
  document.body.append(fragment(html`<div class="join-shell" style="min-height:100vh;display:grid;place-items:center;padding:24px">
    <div class="panel panel-pad" style="max-width:420px;text-align:center"><div class="empty" style="padding:20px 0 6px">
      <div class="empty-art"><i data-icon="door"></i></div>
      <h3>${reason === "class_deleted" ? "This class was closed" : "You were removed from this class"}</h3>
      <p>${reason === "class_deleted" ? "Your teacher deleted the class." : "Ask your teacher if this was a mistake — you can join again with the class code."}</p>
      <a class="btn btn-primary" href="/join">Join a class</a></div></div></div>`));
}

// ===================================================================== boot
function applyState(s) {
  state.me = s.student; state.cls = s.class; state.links = s.links; state.presence = s.presence;
  renderHeader(); renderLinks(); setScreen(s.screen.active); setFocus(s.focus); setAnnouncement(s.announcement);
}

try {
  applyState(await api("/api/s/me", { redirectOn401: false }));
  await loadTasks();
} catch (err) {
  if (err.status === 401) location.replace("/join");
  else toast(err.message, { type: "error" });
}

events = liveEvents("/api/s/events?role=portal", {
  state: (s) => { applyState(s); loadTasks().catch(() => {}); },
  link: onLink,
  screen: (d) => {
    if (d.active && !state.screen) toast("Your teacher is sharing their screen", { type: "info", duration: 3000 });
    setScreen(d.active);
  },
  focus: setFocus,
  announcement: (a) => {
    setAnnouncement(a);
    if (a?.text) toast(a.text, { type: "warning", title: "Announcement", duration: 6000 });
  },
  assignment_opened: (d) => {
    state.openTask = d.id;
    toast(`“${d.title}” — hand it in from the Assignments panel`, { type: "info", title: "New assignment" });
    $("#tasksPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  },
  assignments: () => loadTasks().catch(() => {}),
  class: (c) => { Object.assign(state.cls, c); renderHeader(); },
  self_presence: (p) => { state.presence = p; renderLinks(); },
  removed: (d) => showRemoved(d.reason),
}, setConn);

setInterval(() => renderLinks(), 30000);
