import { $, api, initChrome } from "../ui.js";

initChrome();

const scene = $("#scene");
if ("IntersectionObserver" in window) {
  new IntersectionObserver(([entry]) => scene.classList.toggle("play", entry.isIntersecting), { threshold: 0.3 })
    .observe(scene);
} else {
  scene.classList.add("play");
}

api("/api/session")
  .then(({ user }) => { if (user) { $("#navGuest").hidden = true; $("#navUser").hidden = false; } })
  .catch(() => {});
