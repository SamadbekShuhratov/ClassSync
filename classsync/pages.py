"""HTML page routes and static assets."""
from __future__ import annotations

import hashlib
from pathlib import Path

from .auth import current_student, current_user, owned_class
from .context import ctx
from .core import FileResponse, HttpError, Request, redirect, router


def page(name: str) -> FileResponse:
    return FileResponse(ctx.web_root / f"{name}.html", content_type="text/html; charset=utf-8",
                        cache="no-cache")


def login_redirect(req: Request):
    return redirect(f"/login?next={req.path}")


@router.get("/")
def landing(req: Request):
    return page("index")


@router.get("/login")
def login_page(req: Request):
    return redirect("/dashboard") if current_user(req) else page("login")


@router.get("/register")
def register_page(req: Request):
    return redirect("/dashboard") if current_user(req) else page("register")


@router.get("/dashboard")
def dashboard_page(req: Request):
    return page("dashboard") if current_user(req) else login_redirect(req)


@router.get("/classes/<int:cid>")
def class_page(req: Request):
    if not current_user(req):
        return login_redirect(req)
    owned_class(req, req.params["cid"])        # 404 if not the owner
    return page("console")


@router.get("/join")
def join_page(req: Request):
    return page("join")


@router.get("/portal")
def portal_page(req: Request):
    return page("portal") if current_student(req) else redirect("/join")


@router.get("/favicon.ico")
def favicon(req: Request):
    return redirect("/assets/img/logo.svg", 301)


_etags: dict[str, tuple[float, str]] = {}


def serve_asset(req: Request):
    rel = req.path[len("/assets/"):]
    root = (ctx.web_root / "assets").resolve()
    target = (root / rel).resolve()
    if root not in target.parents or not target.is_file():
        raise HttpError(404, "Not found")
    stat = target.stat()
    cached = _etags.get(str(target))
    if not cached or cached[0] != stat.st_mtime:
        tag = hashlib.md5(f"{stat.st_mtime_ns}-{stat.st_size}".encode()).hexdigest()[:16]
        cached = _etags[str(target)] = (stat.st_mtime, f'"{tag}"')
    return FileResponse(target, cache="no-cache", etag=cached[1])


def not_found_page() -> Path:
    return ctx.web_root / "404.html"
