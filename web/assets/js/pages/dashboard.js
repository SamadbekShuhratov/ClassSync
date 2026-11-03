import { classFields, classFormValues, greeting, teacherShell } from "../shell.js";
import { $, CLASS_COLORS, api, fragment, html, icon, openModal, raw, setLoading, showFieldErrors,
         toastError } from "../ui.js";

const grid = $("#grid");
let classes = [];

const user = await teacherShell({ active: "classes" });
$("#greeting").innerHTML = greeting(user.name);
document.title = "Classes · ClassSync";

function tile(c) {
  const live = c.live.screen ? `<span class="badge badge-live live-flag"><span class="dot dot-live" style="background:#3b3000"></span>Sharing</span>`
    : c.live.focus ? `<span class="badge badge-live live-flag">Focus on</span>` : "";
  return html`<a class="class-tile" href="/classes/${c.id}" style="--c:${CLASS_COLORS[c.color] || CLASS_COLORS[0]}">
    <div class="class-cover">${raw(live)}
      <h3 class="truncate">${c.name}</h3>
      <div class="subject truncate">${c.subject || "No subject"}</div>
    </div>
    <div class="class-body">
      <span class="class-stat" title="Students">${raw(icon("users"))}${c.students}</span>
      <span class="class-stat" title="Online now">${raw(`<span class="dot ${c.online ? "dot-on" : ""}"></span>`)}${c.online} online</span>
      ${c.open_assignments ? raw(html`<span class="class-stat" title="Open assignments">${raw(icon("inbox"))}${c.open_assignments}</span>`) : ""}
      <span class="class-code" title="Join code">${c.code}</span>
    </div></a>`;
}

function render() {
  const total = classes.reduce((n, c) => n + c.students, 0);
  const online = classes.reduce((n, c) => n + c.online, 0);
  $("#summary").textContent = classes.length
    ? `${classes.length} ${classes.length === 1 ? "class" : "classes"} · ${total} students${online ? ` · ${online} online now` : ""}`
    : "Create your first class to get a join code for students.";
  if (!classes.length) {
    grid.innerHTML = "";
    grid.append(fragment(html`<div class="panel" style="grid-column:1/-1"><div class="empty">
      <div class="empty-art"><i data-icon="book"></i></div>
      <h3>No classes yet</h3>
      <p>A class gives you a six-letter join code and a live console for sharing links, your screen and assignments.</p>
      <button class="btn btn-primary" data-new><i data-icon="plus"></i>Create your first class</button>
    </div></div>`));
  } else {
    grid.innerHTML = classes.map(tile).join("") +
      `<button class="new-tile" data-new><span class="plus">${icon("plus", 22)}</span>New class</button>`;
  }
  grid.querySelectorAll("[data-new]").forEach((b) => b.addEventListener("click", createClass));
}

async function load() {
  try {
    ({ classes } = await api("/api/classes"));
    render();
  } catch (err) {
    grid.innerHTML = "";
    grid.append(fragment(html`<div class="panel" style="grid-column:1/-1"><div class="empty">
      <div class="empty-art"><i data-icon="wifi-off"></i></div><h3>Couldn't load classes</h3><p>${err.message}</p>
      <button class="btn" data-retry><i data-icon="refresh"></i>Try again</button></div></div>`));
    grid.querySelector("[data-retry]").onclick = load;
  }
}

function createClass() {
  const form = classFields({ color: classes.length % CLASS_COLORS.length });
  const foot = fragment(`<div class="row"><button class="btn btn-ghost" data-cancel>Cancel</button>
    <button class="btn btn-primary" data-save>Create class</button></div>`);
  const m = openModal({ title: "New class", description: "Students will join it with a code you can show on the projector.",
                        body: form, footer: foot });
  foot.querySelector("[data-cancel]").onclick = () => m.close();
  const save = async () => {
    const btn = foot.querySelector("[data-save]");
    const values = classFormValues(form);
    if (values.name.length < 2) return showFieldErrors(form, { name: "Give the class a name" });
    setLoading(btn, true);
    try {
      const { class: c } = await api("/api/classes", { method: "POST", body: values });
      m.close();
      location.href = `/classes/${c.id}?new=1`;
    } catch (err) {
      setLoading(btn, false);
      if (!showFieldErrors(form, err.fields)) toastError(err);
    }
  };
  foot.querySelector("[data-save]").onclick = save;
  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
  form.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); save(); } });
}

$("#newClass").addEventListener("click", createClass);
await load();
setInterval(() => document.visibilityState === "visible" && api("/api/classes").then((r) => { classes = r.classes; render(); }).catch(() => {}), 15000);
