"""Password hashing, tokens, rate limiting and input helpers."""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import threading
import time
import unicodedata

PBKDF2_ITERATIONS = 260_000
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"   # no 0/O, 1/I/L — easy to read aloud
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


# Verifying against this when the e-mail is unknown keeps response times uniform.
DUMMY_HASH = hash_password(secrets.token_hex(8))


def password_problem(password: str) -> str | None:
    if len(password) < 8:
        return "Use at least 8 characters"
    if len(password) > 200:
        return "Password is too long"
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return "Include at least one letter and one number"
    return None


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_join_code(length: int = 6) -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(length))


def normalize_code(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(code).upper())


def name_key(name: str) -> str:
    """Case/spacing-insensitive identity for a student's display name."""
    folded = unicodedata.normalize("NFKC", name).casefold()
    return re.sub(r"\s+", " ", folded).strip()


def clean_name(name: str, limit: int = 60) -> str:
    name = unicodedata.normalize("NFKC", str(name))
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C")
    return re.sub(r"\s+", " ", name).strip()[:limit]


def safe_filename(name: str, limit: int = 120) -> str:
    name = unicodedata.normalize("NFKC", str(name)).replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f<>:\"|?*]", "_", name).strip(" .")
    if len(name) > limit:
        stem, dot, ext = name.rpartition(".")
        name = (stem[: limit - len(ext) - 1] + "." + ext) if dot and len(ext) < 12 else name[:limit]
    return name or "file"


class RateLimiter:
    """Sliding-window limiter keyed by arbitrary strings (e.g. ip|email)."""

    def __init__(self, limit: int, window: float):
        self.limit, self.window = limit, window
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> list[float]:
        hits = [t for t in self._hits.get(key, []) if now - t < self.window]
        if hits:
            self._hits[key] = hits
        else:
            self._hits.pop(key, None)
        return hits

    def blocked_for(self, key: str) -> int:
        """Seconds until the key may try again (0 = allowed)."""
        with self._lock:
            now = time.monotonic()
            hits = self._prune(key, now)
            if len(hits) < self.limit:
                return 0
            return int(self.window - (now - hits[0])) + 1

    def hit(self, key: str):
        with self._lock:
            self._hits.setdefault(key, []).append(time.monotonic())

    def reset(self, key: str):
        with self._lock:
            self._hits.pop(key, None)
