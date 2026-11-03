"""Teacher accounts & sessions, student identities, and the guards routes use."""
from __future__ import annotations

from .context import ctx
from .core import HttpError, Request, Response, json_response, require_fields, router
from .db import now
from .security import (DUMMY_HASH, EMAIL_RE, RateLimiter, clean_name, digest, hash_password,
                       new_token, password_problem, verify_password)

SESSION_COOKIE = "cs_session"
STUDENT_COOKIE = "cs_student"

login_limiter = RateLimiter(limit=6, window=300)       # per ip+email
register_limiter = RateLimiter(limit=10, window=3600)  # per ip


# ---------------------------------------------------------------- guards
def current_user(req: Request) -> dict | None:
    if req._user is not None:
        return req._user or None
    token = req.cookies.get(SESSION_COOKIE)
    user = None
    if token:
        user = ctx.db.one(
            "SELECT u.id, u.name, u.email, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token_hash = ? AND s.expires_at > ?", (digest(token), now()))
    req._user = user or False
    return user


def require_user(req: Request) -> dict:
    user = current_user(req)
    if not user:
        raise HttpError(401, "Please sign in to continue", code="auth_required")
    return user


def owned_class(req: Request, class_id: int) -> dict:
    user = require_user(req)
    cls = ctx.db.one("SELECT * FROM classes WHERE id = ?", (class_id,))
    if not cls or cls["owner_id"] != user["id"]:
        raise HttpError(404, "Class not found")
    return cls


def current_student(req: Request) -> dict | None:
    if req._student is not None:
        return req._student or None
    token = req.headers.get("X-Student-Token") or req.cookies.get(STUDENT_COOKIE)
    student = None
    if token:
        student = ctx.db.one(
            "SELECT s.id, s.name, s.class_id, s.joined_at, c.name AS class_name, c.subject, c.code, "
            "c.color, u.name AS teacher_name FROM students s JOIN classes c ON c.id = s.class_id "
            "JOIN users u ON u.id = c.owner_id WHERE s.token_hash = ?", (digest(token),))
    req._student = student or False
    return student


def require_student(req: Request) -> dict:
    student = current_student(req)
    if not student:
        raise HttpError(401, "Your session has ended. Join the class again.", code="student_auth")
    return student


# ---------------------------------------------------------------- helpers
def _start_session(req: Request, user_id: int, remember: bool) -> Response:
    token = new_token()
    days = ctx.config.session_days if remember else 1
    ctx.db.run("INSERT INTO sessions(token_hash, user_id, created_at, expires_at, ip, user_agent) "
               "VALUES (?,?,?,?,?,?)",
               (digest(token), user_id, now(), now() + days * 86400, req.ip,
                (req.headers.get("User-Agent") or "")[:200]))
    ctx.db.run("DELETE FROM sessions WHERE expires_at < ?", (now(),))
    user = ctx.db.one("SELECT id, name, email, created_at FROM users WHERE id = ?", (user_id,))
    resp = json_response({"user": user})
    resp.set_cookie(SESSION_COOKIE, token, max_age=days * 86400 if remember else None,
                    secure=ctx.config.secure_cookies)
    return resp


# ---------------------------------------------------------------- routes
@router.post("/api/auth/register")
def register(req: Request):
    if not ctx.config.allow_registration:
        raise HttpError(403, "Registration is disabled on this server")
    wait = register_limiter.blocked_for(req.ip)
    if wait:
        raise HttpError(429, f"Too many sign-ups from this device. Try again in {wait // 60 + 1} min.")
    data = require_fields(req.json(), name=(str, 2, 60, True), email=(str, 3, 254, True),
                          password=(str, 1, 200, True))
    errors = {}
    email = data["email"].lower()
    if not EMAIL_RE.match(email):
        errors["email"] = "Enter a valid email address"
    problem = password_problem(data["password"])
    if problem:
        errors["password"] = problem
    if not errors and ctx.db.one("SELECT 1 FROM users WHERE email = ?", (email,)):
        errors["email"] = "An account with this email already exists"
    if errors:
        raise HttpError(422, "Please fix the highlighted fields", code="validation", fields=errors)
    register_limiter.hit(req.ip)
    user_id = ctx.db.run("INSERT INTO users(name, email, password_hash, created_at) VALUES (?,?,?,?)",
                         (clean_name(data["name"]), email, hash_password(data["password"]), now()))
    resp = _start_session(req, user_id, remember=True)
    resp.status = 201
    return resp


@router.post("/api/auth/login")
def login(req: Request):
    data = req.json()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    key = f"{req.ip}|{email}"
    wait = login_limiter.blocked_for(key)
    if wait:
        raise HttpError(429, f"Too many attempts. Try again in {wait} seconds.", code="rate_limited")
    user = ctx.db.one("SELECT id, password_hash FROM users WHERE email = ?", (email,))
    ok = verify_password(password, user["password_hash"] if user else DUMMY_HASH)
    if not (user and ok):
        login_limiter.hit(key)
        raise HttpError(401, "Incorrect email or password", code="bad_credentials")
    login_limiter.reset(key)
    return _start_session(req, user["id"], remember=bool(data.get("remember", True)))


@router.post("/api/auth/logout")
def logout(req: Request):
    token = req.cookies.get(SESSION_COOKIE)
    if token:
        ctx.db.run("DELETE FROM sessions WHERE token_hash = ?", (digest(token),))
    return json_response({"ok": True}).delete_cookie(SESSION_COOKIE)


@router.get("/api/session")
def session_probe(req: Request):
    """Non-failing check used by public pages to adapt their navigation."""
    st = current_student(req)
    return json_response({"user": current_user(req),
                          "student": {"name": st["name"], "class": st["class_name"]} if st else None})


@router.get("/api/me")
def me(req: Request):
    return json_response({"user": require_user(req)})


@router.patch("/api/me")
def update_me(req: Request):
    user = require_user(req)
    data = require_fields(req.json(), name=(str, 2, 60, True))
    ctx.db.run("UPDATE users SET name = ? WHERE id = ?", (clean_name(data["name"]), user["id"]))
    return json_response({"user": ctx.db.one("SELECT id, name, email, created_at FROM users WHERE id = ?",
                                             (user["id"],))})


@router.post("/api/me/password")
def change_password(req: Request):
    user = require_user(req)
    data = require_fields(req.json(), current=(str, 1, 200, True), new=(str, 1, 200, True))
    row = ctx.db.one("SELECT password_hash FROM users WHERE id = ?", (user["id"],))
    if not verify_password(data["current"], row["password_hash"]):
        raise HttpError(422, "Please fix the highlighted fields", code="validation",
                        fields={"current": "Current password is incorrect"})
    problem = password_problem(data["new"])
    if problem:
        raise HttpError(422, "Please fix the highlighted fields", code="validation", fields={"new": problem})
    token = req.cookies.get(SESSION_COOKIE, "")
    with ctx.db.transaction() as c:
        c.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(data["new"]), user["id"]))
        # sign out every other device
        c.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", (user["id"], digest(token)))
    return json_response({"ok": True})
