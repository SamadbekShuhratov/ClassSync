"""SQLite persistence with one connection per thread (WAL mode)."""
from __future__ import annotations

import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip         TEXT    NOT NULL DEFAULT '',
    user_agent TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS classes (
    id         INTEGER PRIMARY KEY,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    subject    TEXT    NOT NULL DEFAULT '',
    code       TEXT    NOT NULL UNIQUE,
    color      INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_classes_owner ON classes(owner_id);

CREATE TABLE IF NOT EXISTS students (
    id         INTEGER PRIMARY KEY,
    class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    name_key   TEXT    NOT NULL,
    token_hash TEXT    NOT NULL UNIQUE,
    joined_at  INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    UNIQUE (class_id, name_key)
);

CREATE TABLE IF NOT EXISTS assignments (
    id          INTEGER PRIMARY KEY,
    class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    due_at      INTEGER,
    allowed_ext TEXT    NOT NULL DEFAULT '',
    max_mb      INTEGER NOT NULL DEFAULT 25,
    is_open     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_assignments_class ON assignments(class_id);

CREATE TABLE IF NOT EXISTS submissions (
    id            INTEGER PRIMARY KEY,
    assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    filename      TEXT    NOT NULL,
    stored_name   TEXT    NOT NULL,
    size          INTEGER NOT NULL,
    note          TEXT    NOT NULL DEFAULT '',
    version       INTEGER NOT NULL,
    late          INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_submissions ON submissions(assignment_id, student_id, version);

CREATE TABLE IF NOT EXISTS activity (
    id         INTEGER PRIMARY KEY,
    class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL,
    data       TEXT    NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_activity_class ON activity(class_id, id DESC);
"""


def now() -> int:
    return int(time.time())


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        with self.connection() as c:
            c.executescript(SCHEMA)
            c.execute("INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', ?)",
                      (str(SCHEMA_VERSION),))

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=15, isolation_level=None, check_same_thread=True)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=15000")
        return conn

    @property
    def conn(self) -> sqlite3.Connection:
        c = getattr(self._local, "conn", None)
        if c is None:
            c = self._local.conn = self._connect()
        return c

    @contextmanager
    def connection(self):
        yield self.conn

    @contextmanager
    def transaction(self):
        c = self.conn
        c.execute("BEGIN IMMEDIATE")
        try:
            yield c
        except BaseException:
            c.execute("ROLLBACK")
            raise
        c.execute("COMMIT")

    def all(self, sql: str, args=()) -> list[dict]:
        return [dict(r) for r in self.conn.execute(sql, args).fetchall()]

    def one(self, sql: str, args=()) -> dict | None:
        row = self.conn.execute(sql, args).fetchone()
        return dict(row) if row else None

    def scalar(self, sql: str, args=()):
        row = self.conn.execute(sql, args).fetchone()
        return row[0] if row else None

    def run(self, sql: str, args=()) -> int:
        cur = self.conn.execute(sql, args)
        return cur.lastrowid if cur.lastrowid else cur.rowcount
