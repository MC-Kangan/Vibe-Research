"""Read-only Coinbase account adapter with an atomic local snapshot."""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

try:
    import jwt
except ImportError:  # optional until Coinbase account import is configured
    jwt = None

from crypto_portfolio_errors import CryptoPortfolioError

_DATA_DIR = Path(os.environ.get("VR_DATA_DIR", "~/.vibe-research")).expanduser()
_STORE = _DATA_DIR / "coinbase-positions.json"
_LOCK = threading.Lock()
_FIAT = {"USD", "GBP", "EUR", "CHF", "CAD", "AUD", "JPY", "CNY", "HKD", "SGD"}
_STABLE = {"USDC", "USDT", "DAI", "USDE", "FDUSD", "TUSD", "USDS", "PYUSD"}


def configured() -> bool:
    return bool(os.environ.get("VR_COINBASE_API_KEY_NAME", "").strip() and os.environ.get("VR_COINBASE_API_PRIVATE_KEY", "").strip())


def _jwt(method: str, path: str) -> str:
    key_name = os.environ.get("VR_COINBASE_API_KEY_NAME", "").strip()
    private_key = os.environ.get("VR_COINBASE_API_PRIVATE_KEY", "").replace("\\n", "\n").strip()
    if not key_name or not private_key:
        raise CryptoPortfolioError("Coinbase API key is not configured")
    if jwt is None:
        raise CryptoPortfolioError("PyJWT[crypto] is required for Coinbase account import")
    now = int(time.time())
    algorithm = os.environ.get("VR_COINBASE_API_ALGORITHM", "ES256").strip() or "ES256"
    return jwt.encode(
        {"sub": key_name, "iss": "cdp", "nbf": now, "exp": now + 120, "uri": f"{method} api.coinbase.com{path}"},
        private_key,
        algorithm=algorithm,
        headers={"kid": key_name, "nonce": secrets.token_hex()},
    )


def _fetch_accounts() -> list[dict[str, Any]]:
    path = "/api/v3/brokerage/accounts"
    accounts: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        params: dict[str, Any] = {"limit": 250}
        if cursor:
            params["cursor"] = cursor
        try:
            response = requests.get(
                f"https://api.coinbase.com{path}",
                params=params,
                headers={"Authorization": f"Bearer {_jwt('GET', path)}"},
                timeout=15,
            )
        except requests.RequestException as exc:
            raise CryptoPortfolioError("Coinbase account request failed; previous snapshot was kept") from exc
        if response.status_code in {401, 403}:
            raise CryptoPortfolioError("Coinbase view-only authentication failed; previous snapshot was kept")
        if response.status_code >= 400:
            raise CryptoPortfolioError(f"Coinbase accounts returned HTTP {response.status_code}; previous snapshot was kept")
        try:
            payload = response.json()
        except ValueError as exc:
            raise CryptoPortfolioError("Coinbase returned invalid account data; previous snapshot was kept") from exc
        batch = payload.get("accounts", []) if isinstance(payload, dict) else []
        accounts.extend(row for row in batch if isinstance(row, dict))
        if not isinstance(payload, dict) or not payload.get("has_next"):
            break
        cursor = str(payload.get("cursor") or "")
        if not cursor:
            break
    return accounts


def _normalize(accounts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for account in accounts:
        currency = str(account.get("currency") or "").upper()
        try:
            available = float((account.get("available_balance") or {}).get("value") or 0)
            hold = float((account.get("hold") or {}).get("value") or 0)
        except (TypeError, ValueError):
            continue
        quantity = available + hold
        if not currency or quantity == 0 or account.get("active") is False:
            continue
        rows.append({
            "source": "coinbase", "source_id": str(account.get("uuid") or currency),
            "wallet_label": "Coinbase", "asset": currency, "quantity": quantity,
            "available_quantity": available, "hold_quantity": hold,
            "asset_kind": "fiat" if currency in _FIAT else "crypto",
            "cash_like": currency in _STABLE,
        })
    return sorted(rows, key=lambda row: (row["asset_kind"], row["asset"]))


def _fallback() -> dict[str, Any]:
    return {
        "status": "not_configured" if not configured() else "empty",
        "source": "coinbase", "refreshed_at": None, "positions": [], "warnings": [],
    }


def get_snapshot() -> dict[str, Any]:
    try:
        return json.loads(_STORE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return _fallback()


def refresh() -> dict[str, Any]:
    if not configured():
        raise CryptoPortfolioError("Coinbase API key is not configured")
    rows = _normalize(_fetch_accounts())
    snapshot = {
        "status": "available" if rows else "empty", "source": "coinbase",
        "refreshed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "positions": rows, "warnings": [],
    }
    with _LOCK:
        _STORE.parent.mkdir(parents=True, exist_ok=True)
        temporary = _STORE.with_suffix(_STORE.suffix + ".tmp")
        temporary.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, _STORE)
    return snapshot
