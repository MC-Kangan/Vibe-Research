"""Persistent defaults for optional TradeAgent evidence in AI research flows."""

from __future__ import annotations

import json
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import research


_LOCK = threading.Lock()


class ResearchSkillPreferenceError(ValueError):
    """Raised when saved defaults violate the approved skill contract."""


def _path() -> Path:
    root = Path(os.environ.get("VR_DATA_DIR", "~/.vibe-research")).expanduser()
    return root / "research-skill-defaults.json"


def _empty() -> dict[str, Any]:
    return {"equity": [], "crypto": [], "updated_at": None}


def _valid(asset_type: str, values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    allowed = {
        name for name, asset_types in research.DEFAULT_SKILL_ASSET_TYPES.items()
        if asset_type in asset_types and name in research.INSTRUMENT_SKILLS
    }
    return list(dict.fromkeys(value for value in values if isinstance(value, str) and value in allowed))[:5]


def _read() -> dict[str, Any]:
    try:
        payload = json.loads(_path().read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return _empty()
    if not isinstance(payload, dict):
        return _empty()
    return {
        "equity": _valid("equity", payload.get("equity")),
        "crypto": _valid("crypto", payload.get("crypto")),
        "updated_at": payload.get("updated_at"),
    }


def get() -> dict[str, Any]:
    with _LOCK:
        return _read()


def save(asset_type: str, skills: list[str]) -> dict[str, Any]:
    if asset_type not in {"equity", "crypto"}:
        raise ResearchSkillPreferenceError("asset_type must be equity or crypto")
    if len(skills) > 5:
        raise ResearchSkillPreferenceError("At most five default skills may be saved")
    normalized = list(dict.fromkeys(skills))
    allowed = {
        name for name, asset_types in research.DEFAULT_SKILL_ASSET_TYPES.items()
        if asset_type in asset_types and name in research.INSTRUMENT_SKILLS
    }
    invalid = [name for name in normalized if name not in allowed]
    if invalid:
        raise ResearchSkillPreferenceError(
            f"Skills do not support {asset_type}: {', '.join(invalid)}"
        )

    with _LOCK:
        payload = _read()
        payload[asset_type] = normalized
        payload["updated_at"] = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        path = _path()
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, path)
    return payload
