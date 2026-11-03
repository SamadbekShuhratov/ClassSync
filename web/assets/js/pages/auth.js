import { $, api, clearErrors, formData, icon, initChrome, setLoading, shake, showFieldErrors } from "../ui.js";

initChrome();

const form = $("#authForm");
const mode = form.dataset.mode;
const alertBox = $("#formAlert");
const submit = form.querySelector('[type="submit"]');

function showAlert(message) {
  alertBox.querySelector("span").textContent = message;
  alertBox.classList.add("show");
}
function hideAlert() { alertBox.classList.remove("show"); }

// Password reveal
form.querySelectorAll("[data-reveal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.reveal);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.innerHTML = icon(show ? "eye-off" : "eye");
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    input.focus();
  });
});

// Strength meter (register)
const meter = $("#strength");
if (meter) {
  const hint = $("#strengthHint");
  const labels = ["Use 8+ characters with a letter and a number.", "Too weak", "Okay — add a number or symbol",
                  "Good password", "Strong password"];
  $("#password").addEventListener("input", (e) => {
    const v = e.target.value;
    let score = 0;
    if (v.length >= 8) score++;
    if (/[A-Za-z]/.test(v) && /\d/.test(v)) score++;
    if (v.length >= 12) score++;
    if (/[^A-Za-z0-9]/.test(v) || (/[a-z]/.test(v) && /[A-Z]/.test(v))) score++;
    if (v && score === 0) score = 1;
    meter.dataset.score = v ? String(score) : "0";
    hint.textContent = v ? labels[score] : labels[0];
  });
}

function validate(data) {
  const errors = {};
  if (mode === "register" && (data.name || "").trim().length < 2) errors.name = "Enter your full name";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(data.email || "")) errors.email = "Enter a valid email address";
  if (!data.password) errors.password = "Enter your password";
  else if (mode === "register" && (data.password.length < 8 || !/[A-Za-z]/.test(data.password) || !/\d/.test(data.password)))
    errors.password = "Use at least 8 characters with a letter and a number";
  return errors;
}

form.addEventListener("input", (e) => {
  e.target.closest(".field")?.classList.remove("has-error");
  hideAlert();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlert();
  clearErrors(form);
  const data = formData(form);
  const errors = validate(data);
  if (Object.keys(errors).length) {
    showFieldErrors(form, errors);
    shake(form);
    return;
  }
  setLoading(submit, true);
  try {
    const body = mode === "login"
      ? { email: data.email, password: data.password, remember: !!data.remember }
      : { name: data.name, email: data.email, password: data.password };
    await api(`/api/auth/${mode}`, { method: "POST", body, redirectOn401: false });
    const next = new URLSearchParams(location.search).get("next");
    location.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
  } catch (err) {
    setLoading(submit, false);
    if (!showFieldErrors(form, err.fields)) showAlert(err.message);
    if (err.code === "bad_credentials") $("#password").select();
    shake(form);
  }
});
