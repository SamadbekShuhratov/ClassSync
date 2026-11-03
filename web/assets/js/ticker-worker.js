// Timers in background tabs are throttled to ~1/s; timers inside a worker are not.
// The console tab is usually hidden while the teacher shares another window.
let timer = null;
self.onmessage = (e) => {
  clearInterval(timer);
  if (e.data && e.data.interval) timer = setInterval(() => self.postMessage(0), e.data.interval);
};
