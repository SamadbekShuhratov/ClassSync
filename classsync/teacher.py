"""Teacher-side API: classes, live controls, assignments and submissions."""
from __future__ import annotations

import json
import re
import shutil
import tempfile
import time
import zipfile
from urllib.parse import urlparse

from .auth import owned_class, require_user
from .context import ctx
from .core import (MB, FileResponse, HttpError, Request, StreamResponse, json_response,
                   require_fields, router)
from .db import now
from .realtime import sse_writer
from .security import clean_name, new_join_code, safe_filename

PALETTE_SIZE = 8


# ================================================================ helpers
def log_activity(class_id: int, kind: str, data: dict | None = None) -> dict:
    data = data or {}
    ts = now()
    aid = ctx.db.run("INSERT INTO activity(class_id, kind, data, created_at) VALUES (?,?,?,?)",
                     (class_id, kind, json.dumps(data, ensure_ascii=False), ts))
    item = {"id": aid, "kind": kind, "data": data, "created_at": ts}
    ctx.hub.to_teachers(class_id, "activity", item)
    return item


def unique_code() -> str:
    for _ in range(50):
        code = new_join_code()
        if not ctx.db.one("SELECT 1 FROM classes WHERE code = ?", (code,)):
            return code
    raise HttpError(500, "Could not allocate a join code")


def class_payload(cls: dict) -> dict:
    cid = cls["id"]
    ch = ctx.hub.channel(cid)
    return {
        "id": cid, "name": cls["name"], "subject": cls["subject"], "code": cls["code"],
        "color": cls["color"], "created_at": cls["created_at"],
        "students": ctx.db.scalar("SELECT COUNT(*) FROM students WHERE class_id = ?", (cid,)),
        "online": ctx.hub.online_count(cid),
        "open_assignments": ctx.db.scalar(
            "SELECT COUNT(*) FROM assignments WHERE class_id = ? AND is_open = 1", (cid,)),
        "live": {
            "screen": ch.screen.active,
            "viewers": ch.screen.viewers,
            "focus": ch.focus,
            "announcement": ch.announcement,
        },
    }


def normalize_url(raw: str) -> str:
    url = str(raw or "").strip()
    if not url:
        raise HttpError(422, "Enter a link to share", code="validation", fields={"url": "Enter a link"})
    if re.match(r"^[a-z][a-z0-9+.-]*://", url, re.I) and not re.match(r"^https?://", url, re.I):
        raise HttpError(422, "Only http:// and https:// links can be shared", code="validation",
                        fields={"url": "Only web links (http/https) are allowed"})
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    p = urlparse(url)
    host = p.hostname or ""
    if not host or (" " in url) or ("." not in host and host != "localhost" and not host.replace(".", "").isdigit()):
        raise HttpError(422, "That doesn't look like a valid link", code="validation",
                        fields={"url": "Check the address and try again"})
    return url[:2000]


def assignment_dir(class_id: int, assignment_id: int):
    return ctx.uploads / str(class_id) / str(assignment_id)


def assignment_payload(a: dict, total_students: int | None = None) -> dict:
    submitted = ctx.db.scalar("SELECT COUNT(DISTINCT student_id) FROM submissions WHERE assignment_id = ?",
                              (a["id"],))
    if total_students is None:
        total_students = ctx.db.scalar("SELECT COUNT(*) FROM students WHERE class_id = ?", (a["class_id"],))
    return {
        "id": a["id"], "class_id": a["class_id"], "title": a["title"], "description": a["description"],
        "due_at": a["due_at"], "allowed_ext": [e for e in a["allowed_ext"].split(",") if e],
        "max_mb": a["max_mb"], "is_open": bool(a["is_open"]), "created_at": a["created_at"],
        "submitted": submitted, "total": total_students,
    }


def parse_ext_list(raw) -> str:
    if isinstance(raw, list):
        raw = ",".join(map(str, raw))
    exts = []
    for part in re.split(r"[\s,;]+", str(raw or "")):
        part = part.strip().lower().lstrip(".")
        if part and re.fullmatch(r"[a-z0-9]{1,10}", part) and part not in exts:
            exts.append(part)
    return ",".join(exts[:30])


def owned_assignment(req: Request, assignment_id: int) -> tuple[dict, dict]:
    a = ctx.db.one("SELECT * FROM assignments WHERE id = ?", (assignment_id,))
    if not a:
        raise HttpError(404, "Assignment not found")
    cls = owned_class(req, a["class_id"])
    return a, cls


def notify_assignments(class_id: int):
    ctx.hub.to_students(class_id, "assignments", {})
    ctx.hub.to_teachers(class_id, "assignments", {})


# ================================================================ classes
@router.get("/api/info")
def server_info(req: Request):
    require_user(req)
    return json_response({"urls": ctx.lan_urls, "port": ctx.config.port})


@router.get("/api/classes")
def list_classes(req: Request):
    user = require_user(req)
    rows = ctx.db.all("SELECT * FROM classes WHERE owner_id = ? ORDER BY created_at DESC", (user["id"],))
    return json_response({"classes": [class_payload(c) for c in rows]})


@router.post("/api/classes")
def create_class(req: Request):
    user = require_user(req)
    data = require_fields(req.json(), name=(str, 2, 80, True), subject=(str, 0, 80, False),
                          color=(int, 0, PALETTE_SIZE - 1, False))
    count = ctx.db.scalar("SELECT COUNT(*) FROM classes WHERE owner_id = ?", (user["id"],))
    color = data["color"] if data["color"] is not None else count % PALETTE_SIZE
    cid = ctx.db.run("INSERT INTO classes(owner_id, name, subject, code, color, created_at) VALUES (?,?,?,?,?,?)",
                     (user["id"], data["name"], data["subject"] or "", unique_code(), color, now()))
    cls = ctx.db.one("SELECT * FROM classes WHERE id = ?", (cid,))
    log_activity(cid, "class_created", {"name": cls["name"]})
    return json_response({"class": class_payload(cls)}, 201)


@router.get("/api/classes/<int:cid>")
def get_class(req: Request):
    cls = owned_class(req, req.params["cid"])
    return json_response({"class": class_payload(cls), "urls": ctx.lan_urls})


@router.patch("/api/classes/<int:cid>")
def update_class(req: Request):
    cls = owned_class(req, req.params["cid"])
    data = require_fields(req.json(), name=(str, 2, 80, True), subject=(str, 0, 80, False),
                          color=(int, 0, PALETTE_SIZE - 1, False))
    ctx.db.run("UPDATE classes SET name = ?, subject = ?, color = ? WHERE id = ?",
               (data["name"], data["subject"] or "", cls["color"] if data["color"] is None else data["color"],
                cls["id"]))
    cls = ctx.db.one("SELECT * FROM classes WHERE id = ?", (cls["id"],))
    ctx.hub.to_students(cls["id"], "class", {"name": cls["name"], "subject": cls["subject"]})
    return json_response({"class": class_payload(cls)})


@router.post("/api/classes/<int:cid>/code")
def regenerate_code(req: Request):
    cls = owned_class(req, req.params["cid"])
    code = unique_code()
    ctx.db.run("UPDATE classes SET code = ? WHERE id = ?", (code, cls["id"]))
    log_activity(cls["id"], "code_changed", {})
    return json_response({"code": code})


@router.delete("/api/classes/<int:cid>")
def delete_class(req: Request):
    cls = owned_class(req, req.params["cid"])
    ctx.hub.to_students(cls["id"], "removed", {"reason": "class_deleted"})
    ctx.hub.drop_channel(cls["id"])
    ctx.db.run("DELETE FROM classes WHERE id = ?", (cls["id"],))
    shutil.rmtree(ctx.uploads / str(cls["id"]), ignore_errors=True)
    return json_response({"ok": True})


@router.get("/api/classes/<int:cid>/events")
def teacher_events(req: Request):
    cls = owned_class(req, req.params["cid"])
    sub = ctx.hub.subscribe(cls["id"], "teacher")
    ch = ctx.hub.channel(cls["id"])
    initial = [("hello", {"presence": {str(k): v for k, v in ctx.hub.presence(cls["id"]).items()},
                          "viewers": ch.screen.viewers, "screen": ch.screen.active})]
    return StreamResponse(sse_writer(ctx.hub, sub, initial), "text/event-stream; charset=utf-8")


@router.get("/api/classes/<int:cid>/activity")
def activity(req: Request):
    cls = owned_class(req, req.params["cid"])
    before = int(req.query.get("before") or 0) or 2 ** 62
    rows = ctx.db.all("SELECT id, kind, data, created_at FROM activity WHERE class_id = ? AND id < ? "
                      "ORDER BY id DESC LIMIT 50", (cls["id"], before))
    for r in rows:
        r["data"] = json.loads(r["data"] or "{}")
    return json_response({"items": rows, "has_more": len(rows) == 50})


# ================================================================ students
@router.get("/api/classes/<int:cid>/students")
def list_students(req: Request):
    cls = owned_class(req, req.params["cid"])
    rows = ctx.db.all(
        "SELECT s.id, s.name, s.joined_at, s.last_seen, "
        "(SELECT COUNT(DISTINCT assignment_id) FROM submissions WHERE student_id = s.id) AS submitted "
        "FROM students s WHERE s.class_id = ? ORDER BY s.name COLLATE NOCASE", (cls["id"],))
    presence = ctx.hub.presence(cls["id"])
    for r in rows:
        p = presence.get(r["id"], {"portal": 0, "agent": 0})
        r.update(portal=p["portal"], agent=p["agent"], online=bool(p["portal"] or p["agent"]))
    return json_response({"students": rows})


@router.delete("/api/classes/<int:cid>/students/<int:sid>")
def remove_student(req: Request):
    cls = owned_class(req, req.params["cid"])
    st = ctx.db.one("SELECT * FROM students WHERE id = ? AND class_id = ?", (req.params["sid"], cls["id"]))
    if not st:
        raise HttpError(404, "Student not found")
    files = ctx.db.all("SELECT s.stored_name, s.assignment_id FROM submissions s WHERE s.student_id = ?",
                       (st["id"],))
    ctx.hub.disconnect_student(cls["id"], st["id"])
    ctx.db.run("DELETE FROM students WHERE id = ?", (st["id"],))
    for f in files:
        (assignment_dir(cls["id"], f["assignment_id"]) / f["stored_name"]).unlink(missing_ok=True)
    log_activity(cls["id"], "student_removed", {"name": st["name"]})
    notify_assignments(cls["id"])
    return json_response({"ok": True})


# ================================================================ live controls
@router.post("/api/classes/<int:cid>/links")
def push_link(req: Request):
    cls = owned_class(req, req.params["cid"])
    data = req.json()
    url = normalize_url(data.get("url"))
    title = clean_name(data.get("title") or "", 120)
    item = log_activity(cls["id"], "link", {"url": url, "title": title})
    ctx.hub.to_students(cls["id"], "link", {"id": item["id"], "url": url, "title": title,
                                            "at": item["created_at"]})
    return json_response({"link": {"id": item["id"], "url": url, "title": title, "at": item["created_at"]},
                          "delivered": ctx.hub.online_count(cls["id"])})


@router.get("/api/classes/<int:cid>/links")
def recent_links(req: Request):
    cls = owned_class(req, req.params["cid"])
    rows = ctx.db.all("SELECT id, data, created_at FROM activity WHERE class_id = ? AND kind = 'link' "
                      "ORDER BY id DESC LIMIT 30", (cls["id"],))
    seen, links = set(), []
    for r in rows:
        d = json.loads(r["data"])
        if d["url"] in seen:
            continue
        seen.add(d["url"])
        links.append({"id": r["id"], "url": d["url"], "title": d.get("title", ""), "at": r["created_at"]})
    return json_response({"links": links[:12]})


@router.post("/api/classes/<int:cid>/screen")
def screen_control(req: Request):
    cls = owned_class(req, req.params["cid"])
    data = req.json()
    cid = cls["id"]
    if data.get("active"):
        was = ctx.hub.channel(cid).screen.active
        ctx.hub.screen_start(cid, int(data.get("width") or 0), int(data.get("height") or 0))
        if not was:
            log_activity(cid, "screen_on", {})
        ctx.hub.to_students(cid, "screen", {"active": True})
    else:
        if ctx.hub.channel(cid).screen.active:
            log_activity(cid, "screen_off", {})
        ctx.hub.screen_stop(cid)
        ctx.hub.to_students(cid, "screen", {"active": False})
    ctx.hub.to_teachers(cid, "screen", {"active": bool(data.get("active"))})
    return json_response({"active": bool(data.get("active"))})


@router.post("/api/classes/<int:cid>/screen/frame")
def screen_frame(req: Request):
    cls = owned_class(req, req.params["cid"])
    ch = ctx.hub.channel(cls["id"])
    body = req.read(ctx.config.max_frame_mb * MB)
    if not ch.screen.active:
        raise HttpError(409, "Screen sharing is not active", code="screen_inactive")
    if not body.startswith(b"\xff\xd8"):
        raise HttpError(415, "Frames must be JPEG images")
    ctx.hub.push_frame(cls["id"], body)
    return json_response({"ok": True, "viewers": ch.screen.viewers})


@router.post("/api/classes/<int:cid>/focus")
def focus_mode(req: Request):
    cls = owned_class(req, req.params["cid"])
    data = req.json()
    ch = ctx.hub.channel(cls["id"])
    if data.get("active"):
        message = clean_name(data.get("message") or "", 140) or "Eyes on the teacher, please"
        changed = ch.focus is None
        ch.focus = {"message": message, "since": now()}
        if changed:
            log_activity(cls["id"], "focus_on", {"message": message})
    else:
        if ch.focus:
            log_activity(cls["id"], "focus_off", {})
        ch.focus = None
    ctx.hub.to_students(cls["id"], "focus", {"active": ch.focus is not None, **(ch.focus or {})})
    ctx.hub.to_teachers(cls["id"], "focus", {"active": ch.focus is not None, **(ch.focus or {})})
    return json_response({"focus": ch.focus})


@router.post("/api/classes/<int:cid>/announce")
def announce(req: Request):
    cls = owned_class(req, req.params["cid"])
    data = req.json()
    text = str(data.get("text") or "").strip()[:500]
    ch = ctx.hub.channel(cls["id"])
    if not text:
        ch.announcement = None
        ctx.hub.to_students(cls["id"], "announcement", {"text": None})
        return json_response({"announcement": None})
    item = log_activity(cls["id"], "announcement", {"text": text})
    ch.announcement = {"id": item["id"], "text": text, "at": item["created_at"]}
    ctx.hub.to_students(cls["id"], "announcement", ch.announcement)
    return json_response({"announcement": ch.announcement})


# ================================================================ assignments
def _assignment_fields(raw: dict) -> dict:
    data = require_fields(raw, title=(str, 2, 120, True), description=(str, 0, 4000, False),
                          max_mb=(int, 1, 500, False), due_at=(int, 0, 2 ** 40, False))
    data["allowed_ext"] = parse_ext_list(raw.get("allowed_ext"))
    data["max_mb"] = data["max_mb"] or 25
    data["description"] = data["description"] or ""
    return data


@router.get("/api/classes/<int:cid>/assignments")
def list_assignments(req: Request):
    cls = owned_class(req, req.params["cid"])
    total = ctx.db.scalar("SELECT COUNT(*) FROM students WHERE class_id = ?", (cls["id"],))
    rows = ctx.db.all("SELECT * FROM assignments WHERE class_id = ? ORDER BY is_open DESC, created_at DESC",
                      (cls["id"],))
    return json_response({"assignments": [assignment_payload(a, total) for a in rows]})


@router.post("/api/classes/<int:cid>/assignments")
def create_assignment(req: Request):
    cls = owned_class(req, req.params["cid"])
    d = _assignment_fields(req.json())
    aid = ctx.db.run(
        "INSERT INTO assignments(class_id, title, description, due_at, allowed_ext, max_mb, is_open, created_at) "
        "VALUES (?,?,?,?,?,?,1,?)",
        (cls["id"], d["title"], d["description"], d["due_at"], d["allowed_ext"], d["max_mb"], now()))
    a = ctx.db.one("SELECT * FROM assignments WHERE id = ?", (aid,))
    log_activity(cls["id"], "assignment_created", {"id": aid, "title": a["title"]})
    ctx.hub.to_students(cls["id"], "assignment_opened", {"id": aid, "title": a["title"]})
    notify_assignments(cls["id"])
    return json_response({"assignment": assignment_payload(a)}, 201)


@router.patch("/api/assignments/<int:aid>")
def update_assignment(req: Request):
    a, cls = owned_assignment(req, req.params["aid"])
    raw = req.json()
    if set(raw) == {"is_open"}:
        is_open = 1 if raw["is_open"] else 0
        ctx.db.run("UPDATE assignments SET is_open = ? WHERE id = ?", (is_open, a["id"]))
        log_activity(cls["id"], "assignment_opened" if is_open else "assignment_closed",
                     {"id": a["id"], "title": a["title"]})
        if is_open:
            ctx.hub.to_students(cls["id"], "assignment_opened", {"id": a["id"], "title": a["title"]})
    else:
        d = _assignment_fields(raw)
        ctx.db.run("UPDATE assignments SET title=?, description=?, due_at=?, allowed_ext=?, max_mb=? WHERE id=?",
                   (d["title"], d["description"], d["due_at"], d["allowed_ext"], d["max_mb"], a["id"]))
    notify_assignments(cls["id"])
    return json_response({"assignment": assignment_payload(
        ctx.db.one("SELECT * FROM assignments WHERE id = ?", (a["id"],)))})


@router.delete("/api/assignments/<int:aid>")
def delete_assignment(req: Request):
    a, cls = owned_assignment(req, req.params["aid"])
    ctx.db.run("DELETE FROM assignments WHERE id = ?", (a["id"],))
    shutil.rmtree(assignment_dir(cls["id"], a["id"]), ignore_errors=True)
    log_activity(cls["id"], "assignment_deleted", {"title": a["title"]})
    notify_assignments(cls["id"])
    return json_response({"ok": True})


def _latest_by_student(assignment_id: int) -> dict[int, list[dict]]:
    rows = ctx.db.all(
        "SELECT sub.* FROM submissions sub JOIN (SELECT student_id, MAX(version) v FROM submissions "
        "WHERE assignment_id = ? GROUP BY student_id) last ON last.student_id = sub.student_id "
        "AND last.v = sub.version WHERE sub.assignment_id = ? ORDER BY sub.id", (assignment_id, assignment_id))
    out: dict[int, list[dict]] = {}
    for r in rows:
        out.setdefault(r["student_id"], []).append(r)
    return out


@router.get("/api/assignments/<int:aid>/submissions")
def assignment_submissions(req: Request):
    a, cls = owned_assignment(req, req.params["aid"])
    students = ctx.db.all("SELECT id, name FROM students WHERE class_id = ? ORDER BY name COLLATE NOCASE",
                          (cls["id"],))
    latest = _latest_by_student(a["id"])
    versions = {r["student_id"]: r["n"] for r in ctx.db.all(
        "SELECT student_id, MAX(version) n FROM submissions WHERE assignment_id = ? GROUP BY student_id",
        (a["id"],))}
    rows = []
    for s in students:
        files = latest.get(s["id"], [])
        rows.append({
            "student_id": s["id"], "name": s["name"],
            "status": ("late" if any(f["late"] for f in files) else "submitted") if files else "missing",
            "submitted_at": max((f["created_at"] for f in files), default=None),
            "versions": versions.get(s["id"], 0),
            "note": next((f["note"] for f in reversed(files) if f["note"]), ""),
            "files": [{"id": f["id"], "name": f["filename"], "size": f["size"]} for f in files],
        })
    rows.sort(key=lambda r: (r["status"] == "missing", -(r["submitted_at"] or 0)))
    return json_response({"assignment": assignment_payload(a, len(students)), "rows": rows})


@router.get("/api/submissions/<int:fid>/file")
def download_submission(req: Request):
    f = ctx.db.one("SELECT sub.*, a.class_id, st.name AS student FROM submissions sub "
                   "JOIN assignments a ON a.id = sub.assignment_id JOIN students st ON st.id = sub.student_id "
                   "WHERE sub.id = ?", (req.params["fid"],))
    if not f:
        raise HttpError(404, "File not found")
    owned_class(req, f["class_id"])
    path = assignment_dir(f["class_id"], f["assignment_id"]) / f["stored_name"]
    if not path.is_file():
        raise HttpError(404, "File is missing from disk")
    return FileResponse(path, download_name=f"{f['student']} - {f['filename']}",
                        content_type="application/octet-stream")


@router.get("/api/assignments/<int:aid>/zip")
def download_zip(req: Request):
    a, cls = owned_assignment(req, req.params["aid"])
    latest = _latest_by_student(a["id"])
    names = {s["id"]: s["name"] for s in ctx.db.all("SELECT id, name FROM students WHERE class_id = ?",
                                                     (cls["id"],))}
    if not latest:
        raise HttpError(404, "No submissions yet")
    tmp = tempfile.TemporaryFile()
    folder = assignment_dir(cls["id"], a["id"])
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=5) as z:
        for sid, files in latest.items():
            student_dir = safe_filename(names.get(sid, f"student-{sid}"))
            used = set()
            for f in files:
                src = folder / f["stored_name"]
                if not src.is_file():
                    continue
                arc = safe_filename(f["filename"])
                stem, dot, ext = arc.rpartition(".")
                n = 2
                while arc.lower() in used:
                    arc = f"{stem} ({n}).{ext}" if dot else f"{ext} ({n})"
                    n += 1
                used.add(arc.lower())
                z.write(src, f"{student_dir}/{arc}")
    size = tmp.tell()
    tmp.seek(0)
    stamp = time.strftime("%Y-%m-%d")
    return FileResponse(fileobj=tmp, size=size, content_type="application/zip",
                        download_name=f"{safe_filename(a['title'])} - {stamp}.zip")
