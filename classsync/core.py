"""A small, dependency-free HTTP toolkit on top of ``http.server``.

Provides request parsing, typed route patterns, response objects and a
consistent error type. Kept deliberately tiny so the whole server runs on a
stock Python install inside offline classroom networks.
"""
from __future__ import annotations

import json
import mimetypes
import re
from http.cookies import SimpleCookie
from typing import Callable
from urllib.parse import parse_qs, quote, urlparse

MB = 1024 * 1024

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("application/manifest+json", ".webmanifest")


class HttpError(Exception):
    """Raised anywhere in a handler to produce a clean JSON/HTML error."""

    def __init__(self, status: int, message: str = "", *, code: str | None = None,
                 fields: dict | None = None):
        super().__init__(message)
        self.status = status
        self.message = message or "Request failed"
        self.code = code
        self.fields = fields or {}


class Request:
    def __init__(self, handler):
        self.handler = handler
        self.method = handler.command.upper()
        parsed = urlparse(handler.path)
        self.path = parsed.path
        self.query = {k: v[-1] for k, v in parse_qs(parsed.query).items()}
        self.headers = handler.headers
        self.ip = handler.client_address[0]
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
        except Exception:  # malformed cookies are ignored, never fatal
            pass
        self.cookies = {k: m.value for k, m in jar.items()}
        self.params: dict = {}
        self.consumed = False
        self._user = None
        self._student = None

    @property
    def length(self) -> int:
        try:
            return max(0, int(self.headers.get("Content-Length") or 0))
        except ValueError:
            raise HttpError(400, "Invalid Content-Length header")

    def _check_size(self, limit: int) -> int:
        n = self.length
        if n > limit:
            raise HttpError(413, f"File is too large (maximum {max(1, limit // MB)} MB)",
                            code="too_large")
        return n

    def read(self, limit: int) -> bytes:
        n = self._check_size(limit)
        self.consumed = True
        return self.handler.rfile.read(n) if n else b""

    def json(self, limit: int = 256 * 1024) -> dict:
        raw = self.read(limit)
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except ValueError:
            raise HttpError(400, "Malformed JSON body")
        if not isinstance(data, dict):
            raise HttpError(400, "Expected a JSON object")
        return data

    def copy_body_to(self, fh, limit: int, chunk: int = 256 * 1024) -> int:
        remaining = n = self._check_size(limit)
        while remaining:
            buf = self.handler.rfile.read(min(chunk, remaining))
            if not buf:
                raise HttpError(400, "Upload was interrupted")
            fh.write(buf)
            remaining -= len(buf)
        self.consumed = True
        return n


class Response:
    def __init__(self, body: bytes | str = b"", status: int = 200,
                 content_type: str = "text/plain; charset=utf-8", headers: dict | None = None):
        self.body = body.encode() if isinstance(body, str) else body
        self.status = status
        self.content_type = content_type
        self.headers = dict(headers or {})
        self.cookies: list[str] = []

    def set_cookie(self, name: str, value: str, *, max_age: int | None = None,
                   http_only: bool = True, same_site: str = "Lax", path: str = "/",
                   secure: bool = False) -> "Response":
        parts = [f"{name}={value}", f"Path={path}", f"SameSite={same_site}"]
        if max_age is not None:
            parts.append(f"Max-Age={int(max_age)}")
        if http_only:
            parts.append("HttpOnly")
        if secure:
            parts.append("Secure")
        self.cookies.append("; ".join(parts))
        return self

    def delete_cookie(self, name: str, path: str = "/") -> "Response":
        return self.set_cookie(name, "", max_age=0, path=path)


class FileResponse(Response):
    """Serve a file from disk (``path``) or an open binary file object."""

    def __init__(self, path=None, *, fileobj=None, size: int | None = None,
                 content_type: str | None = None, download_name: str | None = None,
                 cache: str = "no-cache", etag: str | None = None):
        if content_type is None:
            guess = mimetypes.guess_type(str(download_name or path or ""))[0]
            content_type = guess or "application/octet-stream"
            if content_type.startswith("text/") or content_type.endswith("javascript"):
                content_type += "; charset=utf-8"
        super().__init__(b"", 200, content_type)
        self.path = path
        self.fileobj = fileobj
        self.size = size
        self.etag = etag
        self.headers["Cache-Control"] = cache
        if download_name:
            ascii_name = re.sub(r"[^A-Za-z0-9._-]+", "_", download_name) or "download"
            self.headers["Content-Disposition"] = (
                f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(download_name)}")


class StreamResponse(Response):
    """Long-lived response (Server-Sent Events, MJPEG). ``writer(wfile)`` owns the socket."""

    def __init__(self, writer: Callable, content_type: str, headers: dict | None = None):
        super().__init__(b"", 200, content_type, headers)
        self.writer = writer
        self.headers.setdefault("Cache-Control", "no-cache, no-store")
        self.headers.setdefault("X-Accel-Buffering", "no")


def json_response(data, status: int = 200) -> Response:
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
    return Response(body, status, "application/json; charset=utf-8", {"Cache-Control": "no-store"})


def redirect(location: str, status: int = 303) -> Response:
    return Response(b"", status, headers={"Location": location, "Cache-Control": "no-store"})


class Router:
    _token = re.compile(r"<(?:(int):)?(\w+)>")

    def __init__(self):
        self.routes: list[tuple[set, re.Pattern, set, Callable]] = []

    def add(self, methods, pattern: str, fn: Callable):
        def conv(m):
            return rf"(?P<{m.group(2)}>\d+)" if m.group(1) else rf"(?P<{m.group(2)}>[^/]+)"
        regex = re.compile("^" + self._token.sub(conv, pattern) + "$")
        ints = {m.group(2) for m in self._token.finditer(pattern) if m.group(1)}
        self.routes.append((set(methods), regex, ints, fn))

    def route(self, pattern: str, methods=("GET",)):
        def deco(fn):
            self.add(methods, pattern, fn)
            return fn
        return deco

    def get(self, pattern):
        return self.route(pattern, ("GET",))

    def post(self, pattern):
        return self.route(pattern, ("POST",))

    def put(self, pattern):
        return self.route(pattern, ("PUT",))

    def patch(self, pattern):
        return self.route(pattern, ("PATCH",))

    def delete(self, pattern):
        return self.route(pattern, ("DELETE",))

    def resolve(self, method: str, path: str):
        allowed: set = set()
        for methods, regex, ints, fn in self.routes:
            m = regex.match(path)
            if not m:
                continue
            if method in methods or (method == "HEAD" and "GET" in methods):
                params = {k: int(v) if k in ints else v for k, v in m.groupdict().items()}
                return fn, params
            allowed |= methods
        if allowed:
            raise HttpError(405, "Method not allowed")
        raise HttpError(404, "Not found")


router = Router()


def require_fields(data: dict, **rules) -> dict:
    """Validate a JSON body. ``rules``: name=(type, min_len, max_len, required)."""
    out, errors = {}, {}
    for name, (typ, lo, hi, required) in rules.items():
        val = data.get(name)
        if val is None or (isinstance(val, str) and not val.strip()):
            if required:
                errors[name] = "This field is required"
            out[name] = None
            continue
        if typ is str:
            val = str(val).strip()
            if lo and len(val) < lo:
                errors[name] = f"Must be at least {lo} characters"
            elif hi and len(val) > hi:
                errors[name] = f"Must be at most {hi} characters"
        elif typ is int:
            try:
                val = int(val)
            except (TypeError, ValueError):
                errors[name] = "Must be a number"
            else:
                if lo is not None and val < lo or hi is not None and val > hi:
                    errors[name] = f"Must be between {lo} and {hi}"
        elif typ is bool:
            val = bool(val)
        out[name] = val
    if errors:
        raise HttpError(422, "Please fix the highlighted fields", code="validation", fields=errors)
    return out
