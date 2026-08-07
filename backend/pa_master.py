"""Read-only adapter for the PA Master portfolio analytics endpoints."""

from __future__ import annotations

import hashlib
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

import requests


class PaMasterClientError(RuntimeError):
    """Safe error raised for PA Master configuration or transport failures."""


def configured() -> bool:
    return (
        os.environ.get("VR_PA_MASTER_ENABLED", "false").strip().lower()
        in {"1", "true", "yes", "on"}
        and bool(_base_url())
    )


def _base_url() -> str:
    return os.environ.get("VR_PA_MASTER_BASE_URL", "").strip().rstrip("/")


def _auth() -> tuple[str, str] | None:
    username = os.environ.get("VR_PA_MASTER_USERNAME", "").strip()
    password = os.environ.get("VR_PA_MASTER_PASSWORD", "").strip()
    if bool(username) != bool(password):
        raise PaMasterClientError("PA Master credentials must be supplied together")
    return (username, password) if username else None


def _timeout() -> float:
    try:
        return max(3.0, min(float(os.environ.get("VR_PA_MASTER_TIMEOUT_SECONDS", "10")), 30.0))
    except ValueError:
        return 10.0


def _request(path: str) -> Any:
    try:
        response = requests.get(
            f"{_base_url()}{path}",
            auth=_auth(),
            timeout=_timeout(),
        )
    except PaMasterClientError:
        raise
    except requests.RequestException as exc:
        raise PaMasterClientError("PA Master is unreachable") from exc
    if response.status_code in {401, 403}:
        raise PaMasterClientError("PA Master authentication failed")
    if response.status_code >= 400:
        raise PaMasterClientError(f"PA Master returned status {response.status_code}")
    try:
        return response.json()
    except (TypeError, ValueError) as exc:
        raise PaMasterClientError("PA Master returned invalid JSON") from exc


def _allocation_rows(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("holdings"), list):
        raise PaMasterClientError("PA Master returned an invalid allocation payload")
    fields = (
        "symbol",
        "asset_class",
        "local_currency",
        "reporting_market_value",
        "portfolio_weight",
        "reporting_unrealized_pnl",
        "cost_status",
    )
    return [{field: item.get(field) for field in fields} for item in payload["holdings"] if isinstance(item, dict)]


def _position_rows(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        raise PaMasterClientError("PA Master returned an invalid position payload")
    fields = (
        "instrument_id",
        "symbol",
        "name",
        "asset_class",
        "currency",
        "venue",
        "trade_agent_market",
        "quantity",
        "average_cost",
        "latest_price",
        "unrealized_pnl",
        "cost_status",
    )
    rows: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        account_id = str(item.get("account_id") or "")
        suffix = account_id[-4:] if account_id else ""
        row = {field: item.get(field) for field in fields}
        row["account_ref"] = hashlib.sha256(
            f"vibe-pa-account:{account_id}".encode()
        ).hexdigest()[:16]
        row["account_label"] = f"PA ••••{suffix}" if suffix else "PA account"
        rows.append(row)
    return rows


def _freshness(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise PaMasterClientError("PA Master returned an invalid freshness payload")
    return {
        key: payload.get(key)
        for key in (
            "last_positions_refreshed_at",
            "last_history_refreshed_at",
            "last_full_refresh_completed_at",
        )
    }


def get_portfolio() -> dict[str, Any]:
    """Fetch PA Master's current allocation and detailed positions without persistence."""
    if not configured():
        return {
            "configured": False,
            "status": "disabled",
            "source": "pa-master",
            "allocations": [],
            "positions": [],
        }

    payloads: dict[str, Any] = {}
    errors: list[str] = []
    paths = {
        "current": "/analysis/current",
        "positions": "/analysis/research/positions",
        "freshness": "/analysis/refresh/status",
    }
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(_request, path): name for name, path in paths.items()}
        for future in as_completed(futures):
            name = futures[future]
            try:
                payloads[name] = future.result()
            except PaMasterClientError as exc:
                errors.append(str(exc))

    allocations: list[dict[str, Any]] = []
    positions: list[dict[str, Any]] = []
    freshness: dict[str, Any] = {
        "last_positions_refreshed_at": None,
        "last_history_refreshed_at": None,
        "last_full_refresh_completed_at": None,
    }
    valid_sections: set[str] = set()
    summary: dict[str, Any] = {
        "reporting_currency": None,
        "nav": None,
        "reporting_coverage": None,
    }
    if "current" in payloads:
        current = payloads["current"]
        try:
            allocations = _allocation_rows(current)
            valid_sections.add("current")
        except PaMasterClientError as exc:
            errors.append(str(exc))
        if isinstance(current, dict):
            summary = {
                key: current.get(key)
                for key in ("reporting_currency", "nav", "reporting_coverage")
            }
    if "positions" in payloads:
        try:
            positions = _position_rows(payloads["positions"])
            valid_sections.add("positions")
        except PaMasterClientError as exc:
            errors.append(str(exc))

    if "freshness" in payloads:
        try:
            freshness = _freshness(payloads["freshness"])
            valid_sections.add("freshness")
        except PaMasterClientError as exc:
            errors.append(str(exc))

    status = "available" if not errors else "partial" if valid_sections else "unavailable"
    return {
        "configured": True,
        "status": status,
        "detail": "; ".join(dict.fromkeys(errors)) if errors else None,
        "source": "pa-master",
        "fetched_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "summary": summary,
        "freshness": freshness,
        "allocations": allocations,
        "positions": positions,
    }
