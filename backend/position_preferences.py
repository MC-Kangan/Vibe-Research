"""Persistent single-user investment goals and risk preferences."""

from __future__ import annotations

import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import position_store


_LOCK = threading.Lock()
_MAX_ITEMS = 20
_MAX_ITEM_LENGTH = 500
_MAX_TOTAL_LENGTH = 5000


class PositionPreferenceError(ValueError):
    """Raised when a preference payload exceeds the bounded prompt contract."""


def _path() -> Path:
    root = Path(os.environ.get("VR_DATA_DIR", "~/.vibe-research")).expanduser()
    return root / "position-preferences.json"


def _empty() -> dict[str, Any]:
    return {"items": [], "updated_at": None}


def get() -> dict[str, Any]:
    with _LOCK:
        payload = position_store.load("position-preferences", _path())
    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list) or not all(isinstance(item, str) for item in items):
        return _empty()
    return {"items": items, "updated_at": payload.get("updated_at")}


def save(items: list[str]) -> dict[str, Any]:
    normalized = [item.strip().removeprefix("-").strip() for item in items if item.strip()]
    if len(normalized) > _MAX_ITEMS:
        raise PositionPreferenceError(f"最多保存 {_MAX_ITEMS} 条目标或风险偏好")
    if any(len(item) > _MAX_ITEM_LENGTH for item in normalized):
        raise PositionPreferenceError(f"每条内容最多 {_MAX_ITEM_LENGTH} 个字符")
    if sum(len(item) for item in normalized) > _MAX_TOTAL_LENGTH:
        raise PositionPreferenceError(f"总内容最多 {_MAX_TOTAL_LENGTH} 个字符")
    payload = {
        "items": normalized,
        "updated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }
    with _LOCK:
        position_store.save("position-preferences", payload, _path())
    return payload
