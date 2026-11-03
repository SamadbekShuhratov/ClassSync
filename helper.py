#!/usr/bin/env python3
"""ClassSync Helper — runs quietly on a student computer.

* opens every link the teacher sends in the default browser, automatically
* brings up the student portal when the teacher shares their screen,
  turns on focus mode or opens an assignment
* reconnects by itself if Wi-Fi drops or the teacher's laptop restarts

First run (asks for anything missing):
    python helper.py --server 192.168.1.10:8000 --code ABC123 --name "Aziza Karimova"
After that:
    python helper.py
Start automatically when this computer signs in:
    python helper.py --autostart
Only standard-library Python 3.9+ is needed.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import time
import webbrowser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import ProxyHandler, Request, build_opener

VERSION = "1.0.0"
CONFIG_DIR = Path(os.environ.get("CLASSSYNC_HOME", Path.home() / ".classsync"))
CONFIG_FILE = CONFIG_DIR / "helper.json"
OPENER = build_opener(ProxyHandler({}))          # classroom LAN: never route through a system proxy
PORTAL_COOLDOWN = 12                              # seconds between automatic portal openings

COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None
if COLOR and platform.system() == "Windows":
    os.system("")                                 # enables ANSI colours in Windows 10+ consoles


def paint(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if COLOR else text


def log(text: str, kind: str = "info"):
    mark = {"info": paint("2", "·"), "ok": paint("32", "✓"), "warn": paint("33", "!"),
            "err": paint("31", "✗"), "link": paint("34", "→")}[kind]
    print(f"{paint('2', time.strftime('%H:%M:%S'))}  {mark} {text}", flush=True)


# ------------------------------------------------------------------ config
def load_config() -> dict:
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_config(cfg: dict):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        os.chmod(CONFIG_FILE, 0o600)
    except OSError:
        pass


def normalize_server(addr: str) -> str:
    addr = addr.strip().rstrip("/")
    if not addr.startswith(("http://", "https://")):
        addr = "http://" + addr
    p = urlparse(addr)
    if not p.port and p.scheme == "http":
        addr = f"{p.scheme}://{p.hostname}:8000"
    return addr


# ------------------------------------------------------------------ HTTP
class ApiError(Exception):
    def __init__(self, status: int, message: str, code: str | None = None):
        super().__init__(message)
        self.status, self.code = status, code


def call(cfg: dict, method: str, path: str, body: dict | None = None, timeout: float = 10) -> dict:
    headers = {"X-Requested-With": "ClassSync", "User-Agent": f"ClassSyncHelper/{VERSION}"}
    if cfg.get("token"):
        headers["X-Student-Token"] = cfg["token"]
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = Request(cfg["server"] + path, data=data, method=method, headers=headers)
    try:
        with OPENER.open(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except HTTPError as e:
        try:
            payload = json.loads(e.read() or b"{}")
        except ValueError:
            payload = {}
        fields = payload.get("fields") or {}
        msg = next(iter(fields.values()), None) or payload.get("error") or e.reason
        raise ApiError(e.code, msg, payload.get("code")) from None


def join(cfg: dict) -> dict:
    cfg.pop("token", None)
    r = call(cfg, "POST", "/api/join", {"code": cfg["code"], "name": cfg["name"]})
    cfg.update(token=r["token"], name=r["student"]["name"], class_name=r["class"]["name"])
    save_config(cfg)
    log(f"Joined {paint('1', cfg['class_name'])} as {paint('1', cfg['name'])}", "ok")
    return cfg


# ------------------------------------------------------------------ actions
class Helper:
    def __init__(self, cfg: dict, open_portal: bool = True):
        self.cfg = cfg
        self.open_portal_enabled = open_portal
        self.portal_tabs = 0
        self.last_portal = 0.0
        self.seen_links: set[int] = set()
        self.first_state = True

    def open_url(self, url: str):
        if urlparse(url).scheme not in ("http", "https"):
            log(f"Ignored a non-web link: {url}", "warn")
            return
        webbrowser.open(url, new=2)

    def ensure_portal(self, reason: str):
        if not self.open_portal_enabled or self.portal_tabs > 0:
            return
        if time.time() - self.last_portal < PORTAL_COOLDOWN:
            return
        self.last_portal = time.time()
        try:
            path = call(self.cfg, "POST", "/api/s/handoff")["path"]
        except (ApiError, URLError, OSError) as e:
            log(f"Couldn't open the class page: {e}", "warn")
            return
        log(f"Opening the class page ({reason})")
        self.open_url(self.cfg["server"] + path)

    def handle(self, event: str, data: dict):
        if event == "state":
            self.portal_tabs = data.get("presence", {}).get("portal", 0)
            new_links = [l for l in data.get("links", []) if l["id"] not in self.seen_links]
            self.seen_links.update(l["id"] for l in data.get("links", []))
            if not self.first_state and new_links:                 # sent while we were reconnecting
                latest = new_links[0]
                log(f"Opening {latest['url']} (sent while offline)", "link")
                self.open_url(latest["url"])
            if data.get("screen", {}).get("active"):
                self.ensure_portal("teacher is sharing")
            elif data.get("focus", {}).get("active"):
                self.ensure_portal("focus mode")
            elif self.first_state:
                self.ensure_portal("start")
            self.first_state = False
        elif event == "link":
            if data["id"] in self.seen_links:
                return
            self.seen_links.add(data["id"])
            log(f"Opening {data['url']}", "link")
            self.open_url(data["url"])
        elif event == "screen" and data.get("active"):
            log("Teacher started sharing their screen")
            self.ensure_portal("screen share")
        elif event == "focus" and data.get("active"):
            log("Focus mode is on")
            self.ensure_portal("focus mode")
        elif event == "assignment_opened":
            log(f"New assignment: {data.get('title')}")
            self.ensure_portal("new assignment")
        elif event == "announcement" and data.get("text"):
            log(f"Announcement: {data['text']}")
        elif event == "self_presence":
            self.portal_tabs = data.get("portal", 0)
        elif event == "class":
            self.cfg["class_name"] = data.get("name", self.cfg.get("class_name"))
        elif event == "removed":
            raise Removed(data.get("reason"))

    def stream(self):
        """Consume the SSE stream until it drops. Raises ApiError/URLError/OSError."""
        req = Request(self.cfg["server"] + "/api/s/events?role=agent",
                      headers={"X-Student-Token": self.cfg["token"], "Accept": "text/event-stream",
                               "User-Agent": f"ClassSyncHelper/{VERSION}"})
        try:
            resp = OPENER.open(req, timeout=45)            # server pings every 15 s
        except HTTPError as e:
            raise ApiError(e.code, e.reason) from None
        log(f"Connected to {paint('1', self.cfg.get('class_name', 'class'))} — waiting for your teacher", "ok")
        event, data_lines = "message", []
        with resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                if not line:
                    if data_lines:
                        try:
                            payload = json.loads("\n".join(data_lines))
                        except ValueError:
                            payload = {}
                        self.handle(event, payload)
                    event, data_lines = "message", []
                elif line.startswith(":"):
                    continue
                elif line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[5:].lstrip())


class Removed(Exception):
    pass


# ------------------------------------------------------------------ autostart
def install_autostart() -> str:
    script = Path(__file__).resolve()
    system = platform.system()
    if system == "Windows":
        folder = Path(os.environ["APPDATA"]) / "Microsoft/Windows/Start Menu/Programs/Startup"
        target = folder / "ClassSync Helper.bat"
        pyw = Path(sys.executable).with_name("pythonw.exe")
        exe = pyw if pyw.exists() else Path(sys.executable)
        target.write_text(f'@echo off\r\nstart "" "{exe}" "{script}"\r\n', encoding="utf-8")
    elif system == "Darwin":
        target = Path.home() / "Library/LaunchAgents/uz.classsync.helper.plist"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>uz.classsync.helper</string>
  <key>ProgramArguments</key><array><string>{sys.executable}</string><string>{script}</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
""", encoding="utf-8")
    else:
        target = Path.home() / ".config/autostart/classsync-helper.desktop"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"""[Desktop Entry]
Type=Application
Name=ClassSync Helper
Exec="{sys.executable}" "{script}"
X-GNOME-Autostart-enabled=true
NoDisplay=true
""", encoding="utf-8")
    return str(target)


# ------------------------------------------------------------------ main
def ask(prompt: str, current: str | None = None) -> str:
    if not sys.stdin or not sys.stdin.isatty():
        sys.exit(f"Missing setting: {prompt}. Run once from a terminal, or pass it as an option (see --help).")
    hint = f" [{current}]" if current else ""
    value = input(f"  {prompt}{hint}: ").strip()
    return value or (current or "")


def main():
    ap = argparse.ArgumentParser(description="ClassSync Helper for student computers")
    ap.add_argument("--server", help="teacher's ClassSync address, e.g. 192.168.1.10:8000")
    ap.add_argument("--code", help="6-character class code")
    ap.add_argument("--name", help="student's full name")
    ap.add_argument("--no-portal", action="store_true", help="never open the class page automatically")
    ap.add_argument("--reset", action="store_true", help="forget the saved class and start over")
    ap.add_argument("--autostart", action="store_true", help="start the helper when this computer signs in")
    args = ap.parse_args()

    cfg = {} if args.reset else load_config()
    changed = False
    for key, prompt in (("server", "Teacher's ClassSync address"), ("code", "Class code"), ("name", "Your full name")):
        value = getattr(args, key)
        if value and value != cfg.get(key):
            cfg[key], changed = value, True
    if not all(cfg.get(k) for k in ("server", "code", "name")):
        print(paint("1", "\n  ClassSync Helper setup\n"))
        cfg["server"] = cfg.get("server") or ask("Teacher's ClassSync address (e.g. 192.168.1.10:8000)")
        cfg["code"] = cfg.get("code") or ask("Class code")
        cfg["name"] = cfg.get("name") or ask("Your full name")
        changed = True
        print()
    cfg["server"] = normalize_server(cfg["server"])
    cfg["code"] = "".join(ch for ch in cfg["code"].upper() if ch.isalnum())
    if changed:
        cfg.pop("token", None)
    save_config(cfg)

    if args.autostart:
        log(f"Helper will start automatically: {install_autostart()}", "ok")

    print(paint("1", f"  ClassSync Helper {VERSION}") + paint("2", f"  ·  {cfg['server']}  ·  Ctrl+C to quit\n"))
    helper = Helper(cfg, open_portal=not args.no_portal)
    backoff = 1
    while True:
        try:
            if not cfg.get("token"):
                join(cfg)
            helper.stream()
            backoff = 1
            log("Connection closed — reconnecting", "warn")
        except KeyboardInterrupt:
            print()
            log("Helper stopped. Bye!")
            return
        except Removed as e:
            cfg.pop("token", None)
            save_config(cfg)
            log("This class was deleted by the teacher." if str(e) == "class_deleted"
                else "Your teacher removed you from the class. Run the helper again to re-join.", "err")
            return
        except ApiError as e:
            if e.status == 401:
                log("Session ended — joining the class again", "warn")
                cfg.pop("token", None)
                continue
            if e.status in (404, 422, 409):
                log(f"Couldn't join: {e}", "err")
                if e.status == 404:
                    log("Check the class code with your teacher, then run: python helper.py --code NEWCODE", "info")
                    return
            else:
                log(f"Server error ({e.status}): {e}", "warn")
        except (URLError, OSError, TimeoutError) as e:
            reason = getattr(e, "reason", e)
            if backoff == 1:
                log(f"Can't reach {cfg['server']} ({reason}). Retrying…", "warn")
        try:
            time.sleep(backoff)
        except KeyboardInterrupt:
            log("Helper stopped. Bye!")
            return
        backoff = min(backoff * 2, 15)


if __name__ == "__main__":
    main()
