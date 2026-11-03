"""In-memory real-time layer: per-class event channels, presence and screen frames.

Transport is Server-Sent Events (one-way, auto-reconnecting in browsers, trivial
to consume from Python) plus a multipart MJPEG stream for the teacher's screen.
Only the newest screen frame is ever kept, so slow viewers skip frames instead
of building up latency.
"""
from __future__ import annotations

import json
import queue
import threading
import time
from dataclasses import dataclass, field

PING_INTERVAL = 10          # seconds between SSE keep-alive comments
SCREEN_STALE_AFTER = 15     # stop a share automatically if no frame arrives for this long


@dataclass(eq=False)
class Subscriber:
    class_id: int
    role: str                       # "teacher" | "portal" | "agent"
    student_id: int | None = None
    queue: "queue.Queue[tuple[str, dict] | None]" = field(default_factory=lambda: queue.Queue(maxsize=256))
    alive: bool = True

    def send(self, event: str, data: dict) -> bool:
        if not self.alive:
            return False
        try:
            self.queue.put_nowait((event, data))
            return True
        except queue.Full:            # consumer is stuck — drop it, it will reconnect
            self.close()
            return False

    def close(self):
        self.alive = False
        try:
            self.queue.put_nowait(None)
        except queue.Full:
            pass


@dataclass
class ScreenState:
    active: bool = False
    started_at: float = 0
    frame: bytes | None = None
    frame_id: int = 0
    last_frame_at: float = 0
    viewers: int = 0
    width: int = 0
    height: int = 0


@dataclass
class Channel:
    class_id: int
    subscribers: set = field(default_factory=set)
    screen: ScreenState = field(default_factory=ScreenState)
    focus: dict | None = None             # {"message": str, "since": ts}
    announcement: dict | None = None      # {"text": str, "at": ts}
    frame_cond: threading.Condition = field(default_factory=threading.Condition)


class Hub:
    def __init__(self):
        self._channels: dict[int, Channel] = {}
        self._lock = threading.RLock()
        self.on_presence = None           # callback(class_id, student_id, online: bool)
        self.on_screen_timeout = None     # callback(class_id)
        threading.Thread(target=self._watchdog, name="hub-watchdog", daemon=True).start()

    # ------------------------------------------------------------------ channels
    def channel(self, class_id: int) -> Channel:
        with self._lock:
            ch = self._channels.get(class_id)
            if ch is None:
                ch = self._channels[class_id] = Channel(class_id)
            return ch

    def drop_channel(self, class_id: int):
        with self._lock:
            ch = self._channels.pop(class_id, None)
        if ch:
            for sub in list(ch.subscribers):
                sub.close()
            with ch.frame_cond:
                ch.screen.active = False
                ch.frame_cond.notify_all()

    # ------------------------------------------------------------------ pub/sub
    def subscribe(self, class_id: int, role: str, student_id: int | None = None) -> Subscriber:
        sub = Subscriber(class_id, role, student_id)
        with self._lock:
            ch = self.channel(class_id)
            was_online = student_id is not None and self._student_online(ch, student_id)
            ch.subscribers.add(sub)
        if student_id is not None:
            self._presence_changed(class_id, student_id, was_online)
        return sub

    def unsubscribe(self, sub: Subscriber):
        sub.alive = False
        with self._lock:
            ch = self._channels.get(sub.class_id)
            if not ch or sub not in ch.subscribers:
                return
            ch.subscribers.discard(sub)
        if sub.student_id is not None:
            self._presence_changed(sub.class_id, sub.student_id, True)

    def publish(self, class_id: int, event: str, data: dict | None = None, *,
                roles: tuple[str, ...] | None = None, student_id: int | None = None):
        data = data or {}
        with self._lock:
            ch = self._channels.get(class_id)
            targets = list(ch.subscribers) if ch else []
        for sub in targets:
            if roles and sub.role not in roles:
                continue
            if student_id is not None and sub.student_id != student_id:
                continue
            sub.send(event, data)

    def to_teachers(self, class_id: int, event: str, data: dict | None = None):
        self.publish(class_id, event, data, roles=("teacher",))

    def to_students(self, class_id: int, event: str, data: dict | None = None):
        self.publish(class_id, event, data, roles=("portal", "agent"))

    def disconnect_student(self, class_id: int, student_id: int, event: str = "removed"):
        with self._lock:
            ch = self._channels.get(class_id)
            targets = [s for s in (ch.subscribers if ch else ()) if s.student_id == student_id]
        for sub in targets:
            sub.send(event, {})
            sub.close()

    # ------------------------------------------------------------------ presence
    @staticmethod
    def _student_online(ch: Channel, student_id: int) -> bool:
        return any(s.student_id == student_id and s.alive for s in ch.subscribers)

    def presence(self, class_id: int) -> dict[int, dict]:
        out: dict[int, dict] = {}
        with self._lock:
            ch = self._channels.get(class_id)
            for s in (ch.subscribers if ch else ()):
                if s.student_id is None or not s.alive:
                    continue
                p = out.setdefault(s.student_id, {"portal": 0, "agent": 0})
                p[s.role] = p.get(s.role, 0) + 1
        return out

    def student_presence(self, class_id: int, student_id: int) -> dict:
        return self.presence(class_id).get(student_id, {"portal": 0, "agent": 0})

    def online_count(self, class_id: int) -> int:
        return len(self.presence(class_id))

    def _presence_changed(self, class_id: int, student_id: int, was_online: bool):
        p = self.student_presence(class_id, student_id)
        online = bool(p["portal"] or p["agent"])
        self.to_teachers(class_id, "presence", {"student_id": student_id, **p, "online": online})
        self.publish(class_id, "self_presence", p, roles=("portal", "agent"), student_id=student_id)
        if online != was_online and self.on_presence:
            self.on_presence(class_id, student_id, online)

    # ------------------------------------------------------------------ screen
    def screen_start(self, class_id: int, width: int = 0, height: int = 0):
        ch = self.channel(class_id)
        with ch.frame_cond:
            ch.screen.active = True
            ch.screen.started_at = time.time()
            ch.screen.last_frame_at = time.time()
            ch.screen.width, ch.screen.height = width, height
            ch.frame_cond.notify_all()

    def screen_stop(self, class_id: int):
        ch = self.channel(class_id)
        with ch.frame_cond:
            ch.screen.active = False
            ch.screen.frame = None
            ch.frame_cond.notify_all()

    def push_frame(self, class_id: int, data: bytes):
        ch = self.channel(class_id)
        with ch.frame_cond:
            ch.screen.frame = data
            ch.screen.frame_id += 1
            ch.screen.last_frame_at = time.time()
            ch.frame_cond.notify_all()

    def viewer_delta(self, class_id: int, delta: int):
        ch = self.channel(class_id)
        with ch.frame_cond:
            ch.screen.viewers = max(0, ch.screen.viewers + delta)
            viewers = ch.screen.viewers
        self.to_teachers(class_id, "viewers", {"count": viewers})

    def _watchdog(self):
        while True:
            time.sleep(3)
            with self._lock:
                channels = list(self._channels.values())
            for ch in channels:
                s = ch.screen
                if s.active and time.time() - s.last_frame_at > SCREEN_STALE_AFTER:
                    self.screen_stop(ch.class_id)
                    if self.on_screen_timeout:
                        try:
                            self.on_screen_timeout(ch.class_id)
                        except Exception:
                            pass


# ---------------------------------------------------------------------- writers
def sse_writer(hub: Hub, sub: Subscriber, initial: list[tuple[str, dict]]):
    """Return a writer function that streams events for ``sub`` until it disconnects."""

    def write(wfile):
        def emit(event, data):
            payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
            wfile.write(f"event: {event}\ndata: {payload}\n\n".encode())
            wfile.flush()

        try:
            wfile.write(b"retry: 2500\n\n")
            for event, data in initial:
                emit(event, data)
            while sub.alive:
                try:
                    item = sub.queue.get(timeout=PING_INTERVAL)
                except queue.Empty:
                    wfile.write(b": ping\n\n")
                    wfile.flush()
                    continue
                if item is None:
                    break
                emit(*item)
        finally:
            hub.unsubscribe(sub)

    return write


def mjpeg_writer(hub: Hub, class_id: int):
    boundary = b"frame"

    def write(wfile):
        ch = hub.channel(class_id)
        last_id = -1
        last_sent = 0.0
        hub.viewer_delta(class_id, +1)
        try:
            while True:
                with ch.frame_cond:
                    ch.frame_cond.wait_for(
                        lambda: ch.screen.frame_id != last_id or not ch.screen.active, timeout=5)
                    active, fid, frame = ch.screen.active, ch.screen.frame_id, ch.screen.frame
                if not active:
                    break
                if frame is None or (fid == last_id and time.time() - last_sent < 5):
                    continue
                last_id, last_sent = fid, time.time()
                wfile.write(b"--" + boundary + b"\r\nContent-Type: image/jpeg\r\nContent-Length: "
                            + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n")
                wfile.flush()
        finally:
            hub.viewer_delta(class_id, -1)

    return write, f"multipart/x-mixed-replace; boundary={boundary.decode()}"
