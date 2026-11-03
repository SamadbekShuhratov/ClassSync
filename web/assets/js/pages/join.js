import { $, api, clearErrors, initChrome, setLoading, shake, showFieldErrors } from "../ui.js";

initChrome();
const form = $("#joinForm");
const code = $("#code");
const params = new URLSearchParams(location.search);

const tidy = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
code.value = tidy(params.get("code") || "");
if (code.value.length === 6) $("#name").focus();
code.addEventListener("input", () => {
  const pos = code.selectionStart;
  const before = code.value;
  code.value = tidy(code.value);
  if (before !== code.value) code.setSelectionRange(Math.min(pos, code.value.length), Math.min(pos, code.value.length));
  if (code.value.length === 6 && document.activeElement === code) $("#name").focus();
});
form.addEventListener("input", (e) => { e.target.closest(".field")?.classList.remove("has-error"); $("#formAlert").classList.remove("show"); });

if (params.get("expired")) $("#expired").hidden = false;
try {
  let saved = localStorage.getItem("cs-student-name");
  if (saved && !$("#name").value) $("#name").value = saved;
} catch {}
api("/api/session")
  .then(({ student }) => { if (student) { $("#resumeName").textContent = student.class; $("#resume").hidden = false; } })
  .catch(() => {});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearErrors(form);
  const body = { code: code.value, name: $("#name").value.trim() };
  const errors = {};
  if (body.code.length !== 6) errors.code = "The class code has 6 characters";
  if (body.name.length < 2) errors.name = "Enter your first and last name";
  if (Object.keys(errors).length) { showFieldErrors(form, errors); shake(form); return; }
  const btn = form.querySelector('[type="submit"]');
  setLoading(btn, true);
  try {
    await api("/api/join", { method: "POST", body });
    try { localStorage.setItem("cs-student-name", body.name); } catch {}
    location.replace("/portal");
  } catch (err) {
    setLoading(btn, false);
    if (!showFieldErrors(form, err.fields)) {
      $("#formAlert span").textContent = err.message;
      $("#formAlert").classList.add("show");
    }
    shake(form);
  }
});
