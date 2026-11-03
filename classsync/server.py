"""HTTP server: request dispatch, security middleware and application bootstrap."""
from __future__ import annotations

import json
import logging
import shutil
import socket
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from . import auth, pages, student, teacher  # noqa: F401  (registers routes)
from .context import Config, ctx
from .core import FileResponse, HttpError, Request, Response, StreamResponse, json_response, router
from .db import Database, now
from .realtime import Hub

log = logging.getLogger("classsync")

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSP = ("default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
       "style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; "
       "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), display-capture=(self)",
}


def check_csrf(req: Request):
    """Mutating API calls must carry a custom header (forces a CORS preflight that we never
    grant) and, when the browser sends one, a same-origin ``Origin``."""
    if req.method in SAFE_METHODS or not req.path.startswith(("/api/", "/s/")):
        return
    if req.headers.get("X-Student-Token"):
        return  # desktop agent — no ambient cookies involved
    if req.headers.get("X-Requested-With") != "ClassSync":
        raise HttpError(403, "Missing request header", code="csrf")
    origin = req.headers.get("Origin")
    if origin and origin != "null" and urlparse(origin).netloc != req.headers.get("Host"):
        raise HttpError(403, "Cross-origin request blocked", code="csrf")


class Handler(BaseHTTPRequestHandler):
    server_version = "ClassSync"
    sys_version = ""
    protocol_version = "HTTP/1.0"

    def log_message(self, fmt, *args):
        log.debug("%s %s", self.client_address[0], fmt % args)

    def do_GET(self): self.dispatch()
    def do_HEAD(self): self.dispatch()
    def do_POST(self): self.dispatch()
    def do_PUT(self): self.dispatch()
    def do_PATCH(self): self.dispatch()
    def do_DELETE(self): self.dispatch()

    # -------------------------------------------------------------- dispatch
    def dispatch(self):
        req = None
        try:
            req = Request(self)
            check_csrf(req)
            if req.path.startswith("/assets/"):
                resp = pages.serve_asset(req)
            else:
                fn, params = router.resolve(req.method, req.path)
                req.params = params
                resp = fn(req)
        except HttpError as e:
            resp = self.error_response(req, e)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return
        except Exception:
            log.error("Unhandled error on %s %s\n%s", self.command, self.path, traceback.format_exc())
            resp = self.error_response(req, HttpError(500, "Something went wrong on the server"))
        try:
            self.send(req, resp)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError):
            pass

    def error_response(self, req: Request | None, e: HttpError) -> Response:
        if req is not None and not req.consumed:
            try:
                n = req.length
                if 0 < n <= 512 * 1024 * 1024:     # drain so the client can read our reply
                    while n > 0:
                        chunk = self.rfile.read(min(n, 1 << 20))
                        if not chunk:
                            break
                        n -= len(chunk)
            except Exception:
                pass
        path = req.path if req else ""
        wants_html = (req is not None and req.method == "GET" and not path.startswith(("/api/", "/assets/"))
                      and "text/html" in (req.headers.get("Accept") or ""))
        if wants_html and e.status == 404:
            resp = FileResponse(pages.not_found_page(), content_type="text/html; charset=utf-8")
            resp.status = 404
            return resp
        body = {"error": e.message}
        if e.code:
            body["code"] = e.code
        if e.fields:
            body["fields"] = e.fields
        return json_response(body, e.status)

    def send(self, req: Request | None, resp: Response):
        head_only = req is not None and req.method == "HEAD"
        if isinstance(resp, FileResponse):
            return self.send_file(req, resp, head_only)
        self.send_response(resp.status)
        self._headers(resp)
        if isinstance(resp, StreamResponse):
            self.end_headers()
            self.wfile.flush()
            if not head_only:
                self.connection.settimeout(None)
                resp.writer(self.wfile)
            return
        self.send_header("Content-Length", str(len(resp.body)))
        self.end_headers()
        if not head_only and resp.body:
            self.wfile.write(resp.body)

    def _headers(self, resp: Response):
        self.send_header("Content-Type", resp.content_type)
        for k, v in SECURITY_HEADERS.items():
            if k not in resp.headers:
                self.send_header(k, v)
        for k, v in resp.headers.items():
            self.send_header(k, v)
        for c in resp.cookies:
            self.send_header("Set-Cookie", c)

    def send_file(self, req, resp: FileResponse, head_only: bool):
        if resp.etag and req is not None and req.headers.get("If-None-Match") == resp.etag:
            self.send_response(304)
            self.send_header("ETag", resp.etag)
            self.send_header("Cache-Control", resp.headers.get("Cache-Control", "no-cache"))
            self.end_headers()
            return
        fh = resp.fileobj or open(resp.path, "rb")
        try:
            size = resp.size if resp.size is not None else Path(resp.path).stat().st_size
            self.send_response(resp.status)
            self._headers(resp)
            if resp.etag:
                self.send_header("ETag", resp.etag)
            self.send_header("Content-Length", str(size))
            self.end_headers()
            if not head_only:
                shutil.copyfileobj(fh, self.wfile, 256 * 1024)
        finally:
            fh.close()


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 128

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError)):
            return
        super().handle_error(request, client_address)


# ------------------------------------------------------------------ bootstrap
def lan_addresses(port: int) -> list[str]:
    ips: list[str] = []
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("10.255.255.255", 1))
        ips.append(probe.getsockname()[0])
    except OSError:
        pass
    finally:
        probe.close()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except OSError:
        pass
    return [f"http://{ip}:{port}" for ip in ips] or [f"http://localhost:{port}"]


def create_app(config: Config) -> Server:
    data_dir = Path(config.data_dir).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    ctx.config = config
    ctx.db = Database(data_dir / "classsync.db")
    ctx.hub = Hub()
    ctx.uploads = data_dir / "uploads"
    ctx.uploads.mkdir(exist_ok=True)
    ctx.web_root = Path(__file__).resolve().parent.parent / "web"
    ctx.lan_urls = lan_addresses(config.port)

    def on_presence(class_id: int, student_id: int, online: bool):
        try:
            ctx.db.run("UPDATE students SET last_seen = ? WHERE id = ?", (now(), student_id))
        except Exception:
            log.exception("presence update failed")

    def on_screen_timeout(class_id: int):
        teacher.log_activity(class_id, "screen_off", {"reason": "timeout"})
        ctx.hub.to_students(class_id, "screen", {"active": False})
        ctx.hub.to_teachers(class_id, "screen", {"active": False, "reason": "timeout"})

    ctx.hub.on_presence = on_presence
    ctx.hub.on_screen_timeout = on_screen_timeout
    return Server((config.host, config.port), Handler)
