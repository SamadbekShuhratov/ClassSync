// Shared UI toolkit: API client, toasts, modals, menus, forms, formatting.
import { icon, hydrateIcons } from "./icons.js";

export { icon, hydrateIcons };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** Tagged template that escapes interpolations unless wrapped with raw(). */
export function html(strings, ...values) {
  return strings.reduce((out, s, i) => {
    if (i === 0) return s;
    const v = values[i - 1];
    const str = Array.isArray(v) ? v.map((x) => (x && x.__raw !== undefined ? x.__raw : esc(x))).join("")
      : v && v.__raw !== undefined ? v.__raw : esc(v);
    return out + str + s;
  }, "");
}
export const raw = (s) => ({ __raw: String(s) });

export function fragment(markup) {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  hydrateIcons(t.content);
  return t.content.childElementCount === 1 ? t.content.firstElementChild : t.content;
}

// ------------------------------------------------------------------ API
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.code = body?.code;
    this.fields = body?.fields || {};
  }
}

export async function api(path, { method = "GET", body, headers = {}, signal, redirectOn401 = true } = {}) {
  const opts = { method, headers: { "X-Requested-With": "ClassSync", ...headers }, signal, credentials: "same-origin" };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError(0, { error: "Can't reach the ClassSync server. Check your network connection." });
  }
  const data = (res.headers.get("Content-Type") || "").includes("json") ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    if (res.status === 401 && redirectOn401 && data.code === "auth_required") {
      location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    }
    throw new ApiError(res.status, data);
  }
  return data;
}

/** XHR upload with progress (fetch can't report upload progress). */
export function uploadFile(url, file, { headers = {}, onProgress, method = "PUT" } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader("X-Requested-With", "ClassSync");
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      xhr.status >= 200 && xhr.status < 300 ? resolve(data) : reject(new ApiError(xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError(0, { error: "Upload failed — the connection was interrupted." }));
    xhr.send(file);
  });
}

// ------------------------------------------------------------------ toasts
let toastRoot;
const TOAST_ICONS = { success: "check-circle", error: "alert", warning: "alert", info: "info" };

export function toast(message, { type = "info", title, duration = 4200, action } = {}) {
  toastRoot ??= document.body.appendChild(Object.assign(document.createElement("div"),
    { className: "toasts", role: "region", ariaLabel: "Notifications" }));
  const el = fragment(html`<div class="toast toast-${type}" role="${type === "error" ? "alert" : "status"}">
      ${raw(icon(TOAST_ICONS[type] || "info"))}
      <div>
        ${title ? raw(html`<div class="toast-title">${title}</div>`) : ""}
        <div class="${title ? "toast-msg" : "toast-title"}">${message}</div>
        ${action ? raw(html`<button class="toast-action">${action.label}</button>`) : ""}
      </div>
      <button class="toast-close" aria-label="Dismiss">${raw(icon("x", 16))}</button>
      ${duration ? raw(`<span class="toast-bar" style="animation-duration:${duration}ms"></span>`) : ""}
    </div>`);
  let timer;
  const close = () => {
    clearTimeout(timer);
    el.classList.add("leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  };
  el.querySelector(".toast-close").onclick = close;
  if (action) el.querySelector(".toast-action").onclick = () => { action.onClick(); close(); };
  if (duration) {
    timer = setTimeout(close, duration);
    el.addEventListener("mouseenter", () => { clearTimeout(timer); el.querySelector(".toast-bar")?.style.setProperty("animation-play-state", "paused"); });
    el.addEventListener("mouseleave", () => { timer = setTimeout(close, 1500); el.querySelector(".toast-bar")?.remove(); });
  }
  toastRoot.append(el);
  while (toastRoot.children.length > 4) toastRoot.firstElementChild.remove();
  return close;
}

export const toastError = (err, title) => toast(err?.message || String(err), { type: "error", title });

// ------------------------------------------------------------------ modal / drawer
const openStack = [];
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && openStack.length) openStack.at(-1).dismiss();
});

function trapFocus(container, e) {
  if (e.key !== "Tab") return;
  const items = $$('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', container)
    .filter((n) => n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items.at(-1);
  if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
  else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
}

/**
 * openModal({ title, description, body, actions:[{label, variant, onClick, type}], size, drawer, onClose, dismissible })
 * Returns { el, close, body }.
 */
export function openModal({ title, description, body = "", footer, size = "", drawer = false, onClose, dismissible = true } = {}) {
  const previous = document.activeElement;
  const overlay = fragment(html`<div class="overlay ${drawer ? "drawer-overlay" : ""}">
    <div class="${drawer ? "drawer" : `modal ${size ? "modal-" + size : ""}`}" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <div class="${drawer ? "drawer-head" : "modal-head"}">
        <div class="truncate" style="flex:1">
          <h2 id="dlg-title">${title || ""}</h2>
          ${description ? raw(html`<p>${description}</p>`) : ""}
        </div>
        ${dismissible ? raw(`<button class="btn btn-ghost btn-icon btn-sm modal-close" aria-label="Close">${icon("x")}</button>`) : ""}
      </div>
      <div class="${drawer ? "drawer-body" : "modal-body"}"></div>
      ${footer !== false ? raw(`<div class="modal-foot"></div>`) : ""}
    </div></div>`);
  const dialog = overlay.firstElementChild;
  const bodyEl = dialog.querySelector(drawer ? ".drawer-body" : ".modal-body");
  typeof body === "string" ? (bodyEl.innerHTML = body, hydrateIcons(bodyEl)) : bodyEl.append(body);
  const foot = dialog.querySelector(".modal-foot");
  if (foot && footer) typeof footer === "string" ? (foot.innerHTML = footer) : foot.append(footer);
  if (foot && !foot.childElementCount) foot.remove();

  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    openStack.splice(openStack.indexOf(handle), 1);
    overlay.classList.add("closing");
    setTimeout(() => overlay.remove(), 190);
    document.body.style.overflow = openStack.length ? "hidden" : "";
    previous?.focus?.();
    onClose?.(result);
  };
  const handle = { el: dialog, body: bodyEl, close, dismiss: () => dismissible && close() };
  openStack.push(handle);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) handle.dismiss(); });
  dialog.addEventListener("keydown", (e) => trapFocus(dialog, e));
  dialog.querySelector(".modal-close")?.addEventListener("click", () => close());
  document.body.append(overlay);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => (dialog.querySelector("[autofocus]") || dialog.querySelector("input, textarea, select, .btn-primary") || dialog).focus?.());
  return handle;
}

export function confirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    const foot = fragment(html`<div class="row">
      <button class="btn btn-ghost" data-act="cancel">${cancelLabel}</button>
      <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="ok">${confirmLabel}</button></div>`);
    const m = openModal({ title, body: html`<p class="muted">${message}</p>`, footer: foot, onClose: (r) => resolve(!!r) });
    foot.querySelector('[data-act="cancel"]').onclick = () => m.close(false);
    foot.querySelector('[data-act="ok"]').onclick = () => m.close(true);
    setTimeout(() => foot.querySelector('[data-act="ok"]').focus(), 30);
  });
}

// ------------------------------------------------------------------ dropdown menu
export function attachMenu(trigger, buildItems, { align = "right" } = {}) {
  let menu = null;
  const close = () => {
    menu?.remove(); menu = null;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", outside, true);
  };
  const outside = (e) => { if (menu && !menu.contains(e.target) && !trigger.contains(e.target)) close(); };
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu) return close();
    menu = document.createElement("div");
    menu.className = "menu";
    menu.setAttribute("role", "menu");
    for (const item of buildItems()) {
      if (item === "-") { menu.append(Object.assign(document.createElement("div"), { className: "menu-sep" })); continue; }
      if (item.header) { menu.append(fragment(`<div class="menu-head">${item.header}</div>`)); continue; }
      const b = fragment(html`<button class="menu-item ${item.danger ? "danger" : ""}" role="menuitem">
        ${item.icon ? raw(icon(item.icon, 17)) : ""}<span>${item.label}</span></button>`);
      b.onclick = () => { close(); item.onClick(); };
      menu.append(b);
    }
    document.body.append(menu);
    const r = trigger.getBoundingClientRect();
    menu.style.top = `${r.bottom + window.scrollY + 6}px`;
    if (align === "right") menu.style.left = `${Math.max(8, r.right + window.scrollX - menu.offsetWidth)}px`;
    else { menu.style.left = `${r.left + window.scrollX}px`; menu.style.transformOrigin = "top left"; }
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("mousedown", outside, true);
    menu.querySelector(".menu-item")?.focus();
    menu.addEventListener("keydown", (ev) => {
      const items = $$(".menu-item", menu);
      const i = items.indexOf(document.activeElement);
      if (ev.key === "ArrowDown") { items[(i + 1) % items.length].focus(); ev.preventDefault(); }
      if (ev.key === "ArrowUp") { items[(i - 1 + items.length) % items.length].focus(); ev.preventDefault(); }
      if (ev.key === "Escape") { close(); trigger.focus(); }
    });
  });
  return close;
}

// ------------------------------------------------------------------ forms
export function setLoading(btn, on) {
  if (!btn) return;
  if (on && !btn.querySelector(".spinner")) btn.insertAdjacentHTML("beforeend", '<span class="spinner" aria-hidden="true"></span>');
  btn.classList.toggle("is-loading", on);
  btn.disabled = on;
  btn.setAttribute("aria-busy", on ? "true" : "false");
}

export function clearErrors(form) {
  $$(".field.has-error", form).forEach((f) => f.classList.remove("has-error"));
}

/** Show server-side field errors next to inputs; returns true if any were shown. */
export function showFieldErrors(form, fields = {}) {
  clearErrors(form);
  let first = null;
  for (const [name, message] of Object.entries(fields)) {
    const input = form.querySelector(`[name="${name}"]`);
    const field = input?.closest(".field");
    if (!field) continue;
    let err = field.querySelector(".error");
    if (!err) { err = fragment(`<div class="error" role="alert"></div>`); field.append(err); }
    err.innerHTML = icon("alert", 14) + `<span>${esc(message)}</span>`;
    field.classList.add("has-error");
    first ??= input;
  }
  first?.focus();
  return !!first;
}

export function shake(el) {
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

export function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// ------------------------------------------------------------------ formatting
export function timeAgo(ts) {
  if (!ts) return "never";
  const s = Math.round(Date.now() / 1000 - ts);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return formatDate(ts);
}
export function formatDate(ts, withTime = false) {
  const d = new Date(ts * 1000);
  const opts = { day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  if (withTime) Object.assign(opts, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString(undefined, opts);
}
export function formatTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
export function dueLabel(ts) {
  if (!ts) return "No due date";
  const diff = ts - Date.now() / 1000;
  const when = formatDate(ts, true);
  if (diff < 0) return `Was due ${when}`;
  if (diff < 3600) return `Due in ${Math.max(1, Math.round(diff / 60))} min`;
  if (diff < 86400) return `Due in ${Math.round(diff / 3600)} h · ${formatTime(ts)}`;
  return `Due ${when}`;
}
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
export function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; }
}

export function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts.at(-1)[0] : "")).toUpperCase();
}
export function hue(str = "") {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}
export function avatar(name, size = "") {
  return `<span class="avatar ${size ? "avatar-" + size : ""}" style="--h:${hue(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
}

export const CLASS_COLORS = ["#1e3b35", "#2b59e0", "#8a3ffc", "#c0392b", "#d68100", "#0f8b8d", "#b8336a", "#4d5b2a"];

export async function copyText(text, label = "Copied to clipboard") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.append(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  }
  toast(label, { type: "success", duration: 2000 });
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ------------------------------------------------------------------ theme
export function bindThemeToggle(btn) {
  if (!btn) return;
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("cs-theme", next); } catch {}
  });
}

// ------------------------------------------------------------------ live events
/** EventSource wrapper with status reporting. Browsers reconnect automatically. */
export function liveEvents(url, handlers, onStatus = () => {}) {
  let es, closed = false, retryTimer;
  const connect = () => {
    onStatus("connecting");
    es = new EventSource(url, { withCredentials: true });
    es.onopen = () => onStatus("open");
    es.onerror = () => {
      onStatus("reconnecting");
      if (es.readyState === EventSource.CLOSED && !closed) {     // server refused (e.g. 401) — back off
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, 4000);
      }
    };
    for (const [name, fn] of Object.entries(handlers)) {
      es.addEventListener(name, (ev) => {
        let data = {};
        try { data = JSON.parse(ev.data); } catch {}
        fn(data);
      });
    }
  };
  connect();
  return { close() { closed = true; clearTimeout(retryTimer); es?.close(); } };
}

// ------------------------------------------------------------------ page chrome
export function initChrome() {
  hydrateIcons();
  bindThemeToggle($(".theme-toggle"));
}

/** Animated underline indicator for .tabs */
export function moveIndicator(tabs) {
  const active = tabs.querySelector('[aria-selected="true"]');
  const ind = tabs.querySelector(".tab-indicator");
  if (!active || !ind) return;
  ind.style.width = `${active.offsetWidth}px`;
  ind.style.transform = `translateX(${active.offsetLeft}px)`;
}
