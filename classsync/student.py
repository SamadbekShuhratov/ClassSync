"""Student-side API: joining, live event stream, screen viewing and submissions."""
from __future__ import annotations

import json
import os
import secrets
import threading
import time
from urllib.parse import unquote

from .auth import STUDENT_COOKIE, current_student, require_student
from .context import ctx
from .core import (FileResponse, HttpError, MB, Request, StreamResponse, json_response, redirect,
                   router)
from .db import now
from .realtime import mjpeg_writer, sse_writer
from .security import RateLimiter, clean_name, digest, name_key, new_token, normalize_code, safe_filename
from .teacher import assignment_dir, log_activity

join_limiter = RateLimiter(limit=40, window=600)
STUDENT_COOKIE_AGE = 60 * 86400

_handoffs: dict[str, tuple[str, float]] = {}       # one-time code -> (student token, expires)
_handoff_lock = threading.Lock()


# ================================================================ helpers
def links_for(class_id: int, limit: int = 15) -> list[dict]:
    rows = ctx.db.all("SELECT id, data, created_at FROM activity WHERE class_id = ? AND kind = 'link' "
                      "ORDER BY id DESC LIMIT ?", (class_id, limit))
    return [{"id": r["id"], **json.loads(r["data"]), "at": r["created_at"]} for r in rows]


def state_snapshot(student: dict) -> dict:
    ch = ctx.hub.channel(student["class_id"])
    return {
        "student": {"id": student["id"], "name": student["name"]},
        "class": {"id": student["class_id"], "name": student["class_name"], "subject": student["subject"],
                  "teacher": student["teacher_name"], "color": student["color"]},
        "screen": {"active": ch.screen.active},
        "focus": {"active": ch.focus is not None, **(ch.focus or {})},
        "announcement": ch.announcement,
        "links": links_for(student["class_id"]),
        "presence": ctx.hub.student_presence(student["class_id"], student["id"]),
    }


def _issue_cookie(resp, token: str):
    resp.set_cookie(STUDENT_COOKIE, token, max_age=STUDENT_COOKIE_AGE, secure=ctx.config.secure_cookies)
    return resp


# ================================================================ join / session
@router.post("/api/join")
def join(req: Request):
    wait = join_limiter.blocked_for(req.ip)
    if wait:
        raise HttpError(429, "Too many attempts. Wait a moment and try again.")
    join_limiter.hit(req.ip)
    data = req.json()
    code = normalize_code(data.get("code", ""))
    name = clean_name(data.get("name", ""))
    errors = {}
    if len(code) != 6:
        errors["code"] = "The class code has 6 characters"
    if len(name) < 2:
        errors["name"] = "Enter your full name"
    if errors:
        raise HttpError(422, "Please fix the highlighted fields", code="validation", fields=errors)
    cls = ctx.db.one("SELECT id, name FROM classes WHERE code = ?", (code,))
    if not cls:
        raise HttpError(404, "No class found with that code", code="validation",
                        fields={"code": "No class found with this code"})

    key = name_key(name)
    existing = ctx.db.one("SELECT * FROM students WHERE class_id = ? AND name_key = ?", (cls["id"], key))
    me = current_student(req)
    token = new_token()
    if existing:
        p = ctx.hub.student_presence(cls["id"], existing["id"])
        is_self = me and me["id"] == existing["id"]
        if (p["portal"] or p["agent"]) and not is_self:
            raise HttpError(409, "Someone with this name is already connected", code="validation",
                            fields={"name": "This name is already connected. Add your surname or initial."})
        if is_self:      # same device re-joining: keep its token so the agent stays connected
            token = req.headers.get("X-Student-Token") or req.cookies.get(STUDENT_COOKIE)
        else:
            ctx.db.run("UPDATE students SET token_hash = ?, last_seen = ? WHERE id = ?",
                       (digest(token), now(), existing["id"]))
        name = existing["name"]
        student_id = existing["id"]
    else:
        student_id = ctx.db.run(
            "INSERT INTO students(class_id, name, name_key, token_hash, joined_at, last_seen) VALUES (?,?,?,?,?,?)",
            (cls["id"], name, key, digest(token), now(), now()))
        log_activity(cls["id"], "student_joined", {"name": name})
        ctx.hub.to_teachers(cls["id"], "roster", {})
    resp = json_response({"token": token, "student": {"id": student_id, "name": name},
                          "class": {"id": cls["id"], "name": cls["name"]}})
    return _issue_cookie(resp, token)


@router.post("/api/s/leave")
def leave(req: Request):
    return json_response({"ok": True}).delete_cookie(STUDENT_COOKIE)


@router.post("/api/s/handoff")
def create_handoff(req: Request):
    """Desktop agent → browser: exchange the agent's token for a one-time login link."""
    require_student(req)
    token = req.headers.get("X-Student-Token")
    if not token:
        raise HttpError(400, "Agent token required")
    code = secrets.token_urlsafe(18)
    with _handoff_lock:
        t = time.time()
        for k in [k for k, (_, exp) in _handoffs.items() if exp < t]:
            _handoffs.pop(k, None)
        _handoffs[code] = (token, t + 120)
    return json_response({"path": f"/s/handoff?c={code}"})


@router.get("/s/handoff")
def use_handoff(req: Request):
    with _handoff_lock:
        item = _handoffs.pop(req.query.get("c", ""), None)
    if not item or item[1] < time.time():
        return redirect("/portal" if current_student(req) else "/join?expired=1")
    return _issue_cookie(redirect("/portal"), item[0])


@router.get("/api/s/me")
def student_me(req: Request):
    return json_response(state_snapshot(require_student(req)))


@router.get("/api/s/events")
def student_events(req: Request):
    student = require_student(req)
    role = "agent" if req.query.get("role") == "agent" else "portal"
    sub = ctx.hub.subscribe(student["class_id"], role, student["id"])
    snapshot = state_snapshot(student)
    snapshot["presence"] = ctx.hub.student_presence(student["class_id"], student["id"])
    return StreamResponse(sse_writer(ctx.hub, sub, [("state", snapshot)]), "text/event-stream; charset=utf-8")


@router.get("/api/s/screen")
def student_screen(req: Request):
    student = require_student(req)
    if not ctx.hub.channel(student["class_id"]).screen.active:
        raise HttpError(409, "The teacher is not sharing their screen")
    writer, ctype = mjpeg_writer(ctx.hub, student["class_id"])
    return StreamResponse(writer, ctype)


# ================================================================ assignments
def _student_assignment(student: dict, aid: int) -> dict:
    a = ctx.db.one("SELECT * FROM assignments WHERE id = ? AND class_id = ?", (aid, student["class_id"]))
    if not a:
        raise HttpError(404, "Assignment not found")
    return a


@router.get("/api/s/assignments")
def student_assignments(req: Request):
    student = require_student(req)
    rows = ctx.db.all(
        "SELECT * FROM assignments WHERE class_id = ? AND (is_open = 1 OR id IN "
        "(SELECT assignment_id FROM submissions WHERE student_id = ?)) ORDER BY is_open DESC, created_at DESC",
        (student["class_id"], student["id"]))
    out = []
    for a in rows:
        version = ctx.db.scalar("SELECT MAX(version) FROM submissions WHERE assignment_id = ? AND student_id = ?",
                                (a["id"], student["id"])) or 0
        files = ctx.db.all("SELECT id, filename AS name, size, created_at, late FROM submissions "
                           "WHERE assignment_id = ? AND student_id = ? AND version = ? ORDER BY id",
                           (a["id"], student["id"], version)) if version else []
        out.append({
            "id": a["id"], "title": a["title"], "description": a["description"], "due_at": a["due_at"],
            "allowed_ext": [e for e in a["allowed_ext"].split(",") if e], "max_mb": a["max_mb"],
            "is_open": bool(a["is_open"]), "version": version, "files": files,
            "submitted_at": max((f["created_at"] for f in files), default=None),
            "late": any(f["late"] for f in files),
        })
    return json_response({"assignments": out})


@router.put("/api/s/assignments/<int:aid>/files")
def upload_file(req: Request):
    student = require_student(req)
    a = _student_assignment(student, req.params["aid"])
    if not a["is_open"]:
        raise HttpError(409, "This assignment is closed — submissions are no longer accepted")
    filename = safe_filename(unquote(req.headers.get("X-Filename", "")))
    if not req.headers.get("X-Filename"):
        raise HttpError(400, "Missing file name")
    ext = filename.rpartition(".")[2].lower() if "." in filename else ""
    allowed = [e for e in a["allowed_ext"].split(",") if e]
    if allowed and ext not in allowed:
        raise HttpError(415, f"Only these file types are accepted: {', '.join('.' + e for e in allowed)}")
    if req.length == 0:
        raise HttpError(400, "The file is empty")
    note = clean_name(unquote(req.headers.get("X-Note", "")), 500)

    folder = assignment_dir(student["class_id"], a["id"])
    folder.mkdir(parents=True, exist_ok=True)
    stored = f"{student['id']}_{secrets.token_hex(8)}" + (f".{ext}" if ext else "")
    tmp_path = folder / (stored + ".part")
    try:
        with open(tmp_path, "wb") as fh:
            size = req.copy_body_to(fh, a["max_mb"] * MB)
        os.replace(tmp_path, folder / stored)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise

    with ctx.db.transaction() as c:
        current = c.execute("SELECT MAX(version) FROM submissions WHERE assignment_id = ? AND student_id = ?",
                            (a["id"], student["id"])).fetchone()[0] or 0
        version = current + 1 if (req.headers.get("X-Batch") != "same" or current == 0) else current
        late = 1 if a["due_at"] and now() > a["due_at"] else 0
        fid = c.execute(
            "INSERT INTO submissions(assignment_id, student_id, filename, stored_name, size, note, version, late, "
            "created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (a["id"], student["id"], filename, stored, size, note, version, late, now())).lastrowid
    if version != current:
        log_activity(student["class_id"], "submission",
                     {"assignment": a["title"], "assignment_id": a["id"], "name": student["name"],
                      "late": bool(late), "version": version})
    ctx.hub.to_teachers(student["class_id"], "submission",
                        {"assignment_id": a["id"], "student_id": student["id"], "name": student["name"],
                         "file": filename})
    return json_response({"file": {"id": fid, "name": filename, "size": size}, "version": version,
                          "late": bool(late)}, 201)


@router.get("/api/s/files/<int:fid>")
def own_file(req: Request):
    student = require_student(req)
    f = ctx.db.one("SELECT sub.*, a.class_id FROM submissions sub JOIN assignments a ON a.id = sub.assignment_id "
                   "WHERE sub.id = ? AND sub.student_id = ?", (req.params["fid"], student["id"]))
    if not f:
        raise HttpError(404, "File not found")
    path = assignment_dir(f["class_id"], f["assignment_id"]) / f["stored_name"]
    if not path.is_file():
        raise HttpError(404, "File is missing")
    return FileResponse(path, download_name=f["filename"], content_type="application/octet-stream")
