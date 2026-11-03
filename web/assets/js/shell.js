// Teacher app chrome: top bar, user menu, account settings.
import { $, api, attachMenu, avatar, esc, fragment, html, initChrome, openModal, raw, setLoading,
         showFieldErrors, toast } from "./ui.js";

export async function teacherShell({ active = "classes", crumbs = "" } = {}) {
  initChrome();
  const { user } = await api("/api/me");
  const bar = fragment(html`<header class="topbar"><div class="wrap">
      <a class="brand" href="/dashboard"><img class="brand-mark" src="/assets/img/logo.svg" alt="">ClassSync</a>
      <nav aria-label="Main">
        <a href="/dashboard" ${raw(active === "classes" ? 'aria-current="page"' : "")}>Classes</a>
      </nav>
      ${raw(crumbs)}
      <span class="spacer"></span>
      <button class="btn btn-ghost btn-icon theme-toggle" aria-label="Toggle dark mode">
        <i data-icon="moon" class="i-moon"></i><i data-icon="sun" class="i-sun"></i></button>
      <button class="btn btn-ghost" id="userMenu" style="padding:0 8px 0 4px;gap:9px">
        ${raw(avatar(user.name, "sm"))}<span class="truncate hide-sm" style="max-width:160px">${user.name}</span>
        <i data-icon="chevron-down" data-size="16"></i></button>
    </div></header>`);
  document.body.prepend(bar);
  initChrome();

  const userBtn = $("#userMenu");
  attachMenu(userBtn, () => [
    { header: html`<div style="font-weight:650">${user.name}</div><div class="muted small truncate">${user.email}</div>` },
    { label: "Account settings", icon: "sliders", onClick: () => accountSettings(user, userBtn) },
    { label: "Join page for students", icon: "door", onClick: () => window.open("/join", "_blank") },
    "-",
    { label: "Sign out", icon: "log-out", danger: true, onClick: signOut },
  ]);
  return user;
}

async function signOut() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  location.href = "/login";
}

function accountSettings(user, userBtn) {
  const body = fragment(html`<div class="stack" style="--gap:22px">
    <form id="profileForm" class="stack" novalidate>
      <div class="field"><label for="acc-name">Display name</label>
        <input class="input" id="acc-name" name="name" value="${user.name}" autocomplete="name">
        <span class="hint">Students see this name in their portal.</span></div>
      <div class="row"><span class="muted small">Signed in as ${user.email}</span><span class="spacer"></span>
        <button class="btn btn-primary btn-sm" type="submit">Save name</button></div>
    </form>
    <hr class="divider">
    <form id="pwForm" class="stack" novalidate>
      <h3>Change password</h3>
      <div class="field"><label for="acc-cur">Current password</label>
        <input class="input" id="acc-cur" name="current" type="password" autocomplete="current-password"></div>
      <div class="field"><label for="acc-new">New password</label>
        <input class="input" id="acc-new" name="new" type="password" autocomplete="new-password">
        <span class="hint">At least 8 characters with a letter and a number. Other devices will be signed out.</span></div>
      <div class="row"><span class="spacer"></span><button class="btn btn-sm" type="submit">Update password</button></div>
    </form></div>`);
  const m = openModal({ title: "Account settings", body, footer: false });

  body.querySelector("#profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    setLoading(btn, true);
    try {
      const { user: u } = await api("/api/me", { method: "PATCH", body: { name: e.target.name.value } });
      user.name = u.name;
      userBtn.querySelector(".truncate").textContent = u.name;
      userBtn.querySelector(".avatar").outerHTML = avatar(u.name, "sm");
      toast("Name updated", { type: "success" });
    } catch (err) {
      if (!showFieldErrors(e.target, err.fields)) toast(err.message, { type: "error" });
    } finally { setLoading(btn, false); }
  });
  body.querySelector("#pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    setLoading(btn, true);
    try {
      await api("/api/me/password", { method: "POST", body: { current: e.target.current.value, new: e.target.new.value } });
      toast("Password updated. Other devices were signed out.", { type: "success" });
      m.close();
    } catch (err) {
      if (!showFieldErrors(e.target, err.fields)) toast(err.message, { type: "error" });
    } finally { setLoading(btn, false); }
  });
}

export function greeting(name) {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${esc(name.split(" ")[0])}`;
}

import { CLASS_COLORS } from "./ui.js";

/** Form fields for creating/editing a class. Returns the form element. */
export function classFields(initial = {}) {
  const color = initial.color ?? 0;
  return fragment(html`<form class="stack" style="--gap:18px" novalidate>
    <div class="field"><label for="cls-name">Class name</label>
      <input class="input" id="cls-name" name="name" value="${initial.name || ""}" placeholder="e.g. Computer Science 10A" maxlength="80" autofocus></div>
    <div class="field"><label for="cls-subject">Subject <span class="muted" style="font-weight:400">(optional)</span></label>
      <input class="input" id="cls-subject" name="subject" value="${initial.subject || ""}" placeholder="e.g. Python basics" maxlength="80"></div>
    <div class="field"><span class="label">Colour</span>
      <div class="swatches" role="radiogroup" aria-label="Class colour">
        ${CLASS_COLORS.map((c, i) => raw(html`<label class="swatch" style="--c:${c}">
          <input type="radio" name="color" value="${i}" ${raw(i === color ? "checked" : "")} aria-label="Colour ${i + 1}"><span></span></label>`))}
      </div></div>
  </form>`);
}

export function classFormValues(form) {
  return { name: form.name.value.trim(), subject: form.subject.value.trim(),
           color: Number(form.querySelector('[name="color"]:checked')?.value || 0) };
}
