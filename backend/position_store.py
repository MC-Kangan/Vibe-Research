"""Shared SQLite persistence for current positions and user-owned portfolio state."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


_LOCK = threading.RLock()


def database_path(legacy_path: str | Path | None = None) -> Path:
    configured = os.environ.get("VR_IBKR_ANALYTICS_STORE", "").strip()
    if configured:
        return Path(configured).expanduser()
    if legacy_path is not None:
        return Path(legacy_path).expanduser().parent / "ibkr-analytics.sqlite3"
    data_dir = os.environ.get("VR_DATA_DIR", "").strip()
    if data_dir:
        return Path(data_dir).expanduser() / "ibkr-analytics.sqlite3"
    return Path("~/.vibe-research/ibkr-analytics.sqlite3").expanduser()


def _connection(legacy_path: str | Path | None = None) -> sqlite3.Connection:
    path = database_path(legacy_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=30, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute(
        """CREATE TABLE IF NOT EXISTS position_state (
             state_key TEXT PRIMARY KEY,
             payload_json TEXT NOT NULL,
             updated_at TEXT NOT NULL
           )"""
    )
    return connection


def load(key: str, legacy_path: str | Path | None = None) -> Any | None:
    """Load one state document, importing its previous JSON file once when present."""
    with _LOCK, _connection(legacy_path) as database:
        row = database.execute(
            "SELECT payload_json FROM position_state WHERE state_key = ?",
            (key,),
        ).fetchone()
        if row is not None:
            try:
                return json.loads(row["payload_json"])
            except json.JSONDecodeError:
                return None
        if legacy_path is None:
            return None
        try:
            payload = json.loads(Path(legacy_path).expanduser().read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return None
        database.execute(
            "INSERT INTO position_state(state_key, payload_json, updated_at) VALUES (?, ?, ?)",
            (key, json.dumps(payload, ensure_ascii=False), datetime.now(UTC).isoformat()),
        )
        return payload


def save(key: str, payload: Any, legacy_path: str | Path | None = None) -> None:
    encoded = json.dumps(payload, ensure_ascii=False)
    with _LOCK, _connection(legacy_path) as database:
        database.execute(
            """INSERT INTO position_state(state_key, payload_json, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(state_key) DO UPDATE SET
                 payload_json = excluded.payload_json,
                 updated_at = excluded.updated_at""",
            (key, encoded, datetime.now(UTC).isoformat()),
        )
