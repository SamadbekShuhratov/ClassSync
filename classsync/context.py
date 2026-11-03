"""Process-wide application context, initialised once by ``server.create_app``."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .db import Database
from .realtime import Hub


@dataclass
class Config:
    host: str = "0.0.0.0"
    port: int = 8000
    data_dir: Path = Path("data")
    session_days: int = 30
    secure_cookies: bool = False      # set when serving behind HTTPS
    max_frame_mb: int = 8
    allow_registration: bool = True


class Context:
    config: Config
    db: Database
    hub: Hub
    uploads: Path
    web_root: Path
    lan_urls: list[str]


ctx = Context()
