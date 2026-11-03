// Hand-drawn 24×24 stroke icon set.
const P = (d) => `<path d="${d}"/>`;
const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const R = (x, y, w, h, rx = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;

export const ICONS = {
  plus: P("M12 5v14M5 12h14"),
  x: P("M18 6 6 18M6 6l12 12"),
  check: P("M20 6 9 17l-5-5"),
  "chevron-down": P("m6 9 6 6 6-6"),
  "chevron-right": P("m9 18 6-6-6-6"),
  "chevron-left": P("m15 18-6-6 6-6"),
  "arrow-left": P("M19 12H5M11 19l-7-7 7-7"),
  link: P("M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"),
  globe: C(12, 12, 10) + P("M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"),
  monitor: R(2, 3, 20, 14) + P("M8 21h8M12 17v4"),
  cast: R(2, 4, 20, 14) + P("M8 21h8M12 18v3M9 11l3-3 3 3M12 8v6"),
  upload: P("M12 15V3M7 8l5-5 5 5M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"),
  download: P("M12 3v12M7 10l5 5 5-5M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"),
  file: P("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6"),
  "file-check": P("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15l2 2 4-4"),
  folder: P("M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"),
  users: P("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75") + C(9, 7, 4),
  user: C(12, 8, 4) + P("M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"),
  "user-plus": C(9, 8, 4) + P("M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M19 8v6M16 11h6"),
  "log-out": P("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"),
  sliders: P("M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"),
  trash: P("M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"),
  copy: R(9, 9, 13, 13) + P("M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"),
  eye: P("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z") + C(12, 12, 3),
  "eye-off": P("M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6"),
  lock: R(3, 11, 18, 11) + P("M7 11V7a5 5 0 0 1 10 0v4"),
  mail: R(2, 4, 20, 16) + P("m22 7-10 6L2 7"),
  megaphone: P("M3 11v2a1 1 0 0 0 1 1h2l6 5V5L6 10H4a1 1 0 0 0-1 1ZM16 8.5a5 5 0 0 1 0 7M19 5.5a9 9 0 0 1 0 13"),
  target: C(12, 12, 10) + C(12, 12, 6) + C(12, 12, 2),
  clock: C(12, 12, 10) + P("M12 6v6l4 2"),
  calendar: R(3, 4, 18, 18) + P("M16 2v4M8 2v4M3 10h18"),
  more: `<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>`,
  sun: C(12, 12, 4) + P("M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"),
  moon: P("M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"),
  external: P("M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"),
  refresh: P("M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12A9 9 0 0 1 18.5 5.7L21 8M21 3v5h-5M3 21v-5h5"),
  stop: R(6, 6, 12, 12, 2),
  play: P("m7 4 13 8-13 8V4Z"),
  zap: P("M13 2 3 14h9l-1 8 10-12h-9l1-8Z"),
  info: C(12, 12, 10) + P("M12 16v-4M12 8h.01"),
  alert: P("M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01"),
  "check-circle": C(12, 12, 10) + P("m8.5 12 2.5 2.5 4.5-5"),
  "wifi-off": P("M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.7M10.7 5.1A15 15 0 0 1 22 8.8M5 12.9a10 10 0 0 1 5.2-2.8M16.9 12.9a10 10 0 0 0-1.6-1.2M12 20h.01"),
  maximize: P("M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"),
  edit: P("M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"),
  key: C(7.5, 15.5, 5.5) + P("m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"),
  send: P("M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"),
  grid: R(3, 3, 7, 7, 1.5) + R(14, 3, 7, 7, 1.5) + R(14, 14, 7, 7, 1.5) + R(3, 14, 7, 7, 1.5),
  activity: P("M22 12h-4l-3 9L9 3l-3 9H2"),
  present: P("M2 3h20M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3M12 16v5M8 21h8"),
  search: C(11, 11, 8) + P("m21 21-4.3-4.3"),
  inbox: P("M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"),
  book: P("M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"),
  laptop: R(4, 4, 16, 11) + P("M2 19h20"),
  bolt: P("M13 2 3 14h9l-1 8 10-12h-9l1-8Z"),
  door: P("M3 21h18M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M14 12h.01"),
  hash: P("M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"),
  shield: P("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"),
  wifi: P("M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 20 0M12 20h.01"),
};

export function icon(name, size = 18, cls = "") {
  const body = ICONS[name] || ICONS.info;
  return `<svg class="i ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    const size = Number(el.dataset.size || 18);
    el.outerHTML = icon(el.dataset.icon, size, el.className || "");
  });
}
