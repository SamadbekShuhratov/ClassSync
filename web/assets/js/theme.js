// Runs before first paint (loaded synchronously in <head>) so there is no theme flash.
(function () {
  var stored = null;
  try { stored = localStorage.getItem("cs-theme"); } catch (e) {}
  var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
})();
