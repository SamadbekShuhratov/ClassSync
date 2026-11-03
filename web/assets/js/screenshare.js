// Screen capture → JPEG frames → server. Unchanged frames are skipped, so a static
// slide costs almost no bandwidth; a keep-alive frame is still sent every 2 s.

export const QUALITY = {
  saver:    { maxWidth: 1024, jpeg: 0.5,  interval: 333 },
  balanced: { maxWidth: 1440, jpeg: 0.62, interval: 166 },
  sharp:    { maxWidth: 1920, jpeg: 0.78, interval: 110 },
};
const KEEPALIVE_MS = 2000;
const HEADERS = { "X-Requested-With": "ClassSync" };

export class ScreenShare {
  constructor(classId, { onState = () => {}, onStats = () => {}, onError = () => {} } = {}) {
    this.classId = classId;
    this.onState = onState;
    this.onStats = onStats;
    this.onError = onError;
    this.quality = "balanced";
    this.active = false;
    this.busy = false;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this.probe = document.createElement("canvas");
    this.probe.width = 48; this.probe.height = 27;
    this.pctx = this.probe.getContext("2d", { willReadFrequently: true });
    this.lastSig = null;
    this.lastSent = 0;
    this.stats = { sent: 0, bytes: 0, since: performance.now(), fps: 0, kbps: 0 };
    window.addEventListener("pagehide", () => this.active && this.notify(false, true));
  }

  get supported() { return !!navigator.mediaDevices?.getDisplayMedia; }

  async start(video) {
    if (!this.supported) throw new Error("This browser can't share the screen. Use Chrome, Edge or Firefox on a computer.");
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 }, width: { ideal: 1920 }, cursor: "always" }, audio: false,
    });
    this.stream = stream;
    this.track = stream.getVideoTracks()[0];
    this.track.addEventListener("ended", () => this.stop());
    this.capture = "ImageCapture" in window ? new ImageCapture(this.track) : null;
    this.video = video;
    video.srcObject = stream;
    await video.play().catch(() => {});
    const s = this.track.getSettings();
    await this.notify(true, false, s.width, s.height);
    this.active = true;
    this.lastSig = null;
    this.stats = { sent: 0, bytes: 0, since: performance.now(), fps: 0, kbps: 0 };
    this.worker = new Worker("/assets/js/ticker-worker.js");
    this.worker.onmessage = () => this.tick();
    this.setQuality(this.quality);
    this.onState(true);
  }

  setQuality(q) {
    this.quality = QUALITY[q] ? q : "balanced";
    this.lastSig = null;                      // force a fresh frame at the new quality
    this.worker?.postMessage({ interval: QUALITY[this.quality].interval });
  }

  async stop() {
    if (!this.active) return;
    this.active = false;
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.srcObject = null;
    this.onState(false);
    await this.notify(false);
  }

  async notify(active, beacon = false, width = 0, height = 0) {
    const opts = { method: "POST", headers: { ...HEADERS, "Content-Type": "application/json" },
                   body: JSON.stringify({ active, width, height }), keepalive: beacon, credentials: "same-origin" };
    const res = await fetch(`/api/classes/${this.classId}/screen`, opts).catch(() => null);
    if (active && (!res || !res.ok)) throw new Error("Couldn't start sharing — the server didn't respond.");
  }

  async grab() {
    if (this.capture) {
      try { return await this.capture.grabFrame(); } catch { /* fall back to <video> */ }
    }
    const v = this.video;
    return v && v.videoWidth ? v : null;
  }

  signature(src, w, h) {
    this.pctx.drawImage(src, 0, 0, w, h, 0, 0, 48, 27);
    return this.pctx.getImageData(0, 0, 48, 27).data;
  }

  changed(sig) {
    const prev = this.lastSig;
    if (!prev) return true;
    let diff = 0;
    for (let i = 0; i < sig.length; i += 4) {
      diff += Math.abs(sig[i] - prev[i]) + Math.abs(sig[i + 1] - prev[i + 1]) + Math.abs(sig[i + 2] - prev[i + 2]);
      if (diff > 900) return true;
    }
    return false;
  }

  async tick() {
    if (!this.active || this.busy) return;
    this.busy = true;
    try {
      const src = await this.grab();
      if (!src) return;
      const w = src.width || src.videoWidth, h = src.height || src.videoHeight;
      const sig = this.signature(src, w, h);
      const now = performance.now();
      if (!this.changed(sig) && now - this.lastSent < KEEPALIVE_MS) { src.close?.(); return; }
      const { maxWidth, jpeg } = QUALITY[this.quality];
      const scale = Math.min(1, maxWidth / w);
      this.canvas.width = Math.round(w * scale);
      this.canvas.height = Math.round(h * scale);
      this.ctx.drawImage(src, 0, 0, this.canvas.width, this.canvas.height);
      src.close?.();
      const blob = await new Promise((r) => this.canvas.toBlob(r, "image/jpeg", jpeg));
      if (!blob || !this.active) return;
      const res = await fetch(`/api/classes/${this.classId}/screen/frame`, {
        method: "POST", headers: { ...HEADERS, "Content-Type": "image/jpeg" }, body: blob, credentials: "same-origin" });
      if (res.status === 409) await this.notify(true, false, w, h);       // server timed us out — resume
      else if (res.ok) {
        const { viewers } = await res.json();
        this.lastSig = sig;
        this.lastSent = now;
        this.stats.sent++;
        this.stats.bytes += blob.size;
        this.stats.viewers = viewers;
      }
      const elapsed = (now - this.stats.since) / 1000;
      if (elapsed >= 2) {
        this.stats.fps = this.stats.sent / elapsed;
        this.stats.kbps = (this.stats.bytes * 8) / 1000 / elapsed;
        this.onStats({ ...this.stats, width: this.canvas.width, height: this.canvas.height });
        Object.assign(this.stats, { sent: 0, bytes: 0, since: now });
      }
    } catch (err) {
      if (this.active) this.onError(err);
    } finally {
      this.busy = false;
    }
  }
}
