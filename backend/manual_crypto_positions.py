"""Validated local repository and atomic CSV import for manual crypto holdings."""

from __future__ import annotations

import csv
import io
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import market_data
import position_store
from crypto_portfolio_errors import CryptoPortfolioError

_DATA_DIR = Path(os.environ.get("VR_DATA_DIR", "~/.vibe-research")).expanduser()
_STORE = _DATA_DIR / "crypto-holdings.json"
_LOCK = threading.Lock()
_STABLE = {"USDC", "USDT", "DAI", "USDE", "FDUSD", "TUSD", "USDS", "PYUSD"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def get_all() -> list[dict[str, Any]]:
    payload = position_store.load("manual-crypto", _STORE)
    rows = payload.get("positions", []) if isinstance(payload, dict) else []
    return [row for row in rows if isinstance(row, dict)]


def _write(rows: list[dict[str, Any]]) -> None:
    position_store.save("manual-crypto", {"positions": rows, "updated_at": _now()}, _STORE)


def _validated(row: dict[str, Any]) -> dict[str, Any]:
    label = str(row.get("wallet_label") or "").strip()
    asset = str(row.get("asset") or "").strip().upper().removesuffix("-USD")
    try:
        quantity = float(row.get("quantity"))
    except (TypeError, ValueError) as exc:
        raise CryptoPortfolioError("quantity 必须是数字") from exc
    if not label or len(label) > 80:
        raise CryptoPortfolioError("wallet_label 必填且最多 80 个字符")
    market_data.resolve_crypto_symbol(asset)
    if quantity < 0:
        raise CryptoPortfolioError("quantity 不能为负数")
    unit_cost = row.get("unit_cost")
    if unit_cost in (None, ""):
        parsed_cost = None
    else:
        try:
            parsed_cost = float(unit_cost)
        except (TypeError, ValueError) as exc:
            raise CryptoPortfolioError("unit_cost 必须是数字") from exc
        if parsed_cost < 0:
            raise CryptoPortfolioError("unit_cost 不能为负数")
    cost_currency = str(row.get("cost_currency") or "USD").strip().upper()
    if len(cost_currency) != 3:
        raise CryptoPortfolioError("cost_currency 必须是三位币种代码")
    return {
        "source": "manual", "wallet_label": label, "asset": asset, "quantity": quantity,
        "unit_cost": parsed_cost, "cost_currency": cost_currency, "cash_like": asset in _STABLE,
        "updated_at": _now(),
    }


def upsert(row: dict[str, Any]) -> list[dict[str, Any]]:
    item = _validated(row)
    with _LOCK:
        rows = [existing for existing in get_all() if (existing.get("wallet_label"), existing.get("asset")) != (item["wallet_label"], item["asset"])]
        if item["quantity"] > 0:
            rows.append(item)
        _write(rows)
    return rows

def remove(wallet_label: str, asset: str) -> list[dict[str, Any]]:
    target = (wallet_label.strip(), asset.strip().upper().removesuffix("-USD"))
    with _LOCK:
        rows = [row for row in get_all() if (row.get("wallet_label"), row.get("asset")) != target]
        _write(rows)
    return rows


def parse_csv(content: str) -> list[dict[str, Any]]:
    if len(content.encode("utf-8")) > 1_000_000:
        raise CryptoPortfolioError("CSV 最大 1MB")
    try:
        reader = csv.DictReader(io.StringIO(content))
        required = {"wallet_label", "asset", "quantity"}
        if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
            raise CryptoPortfolioError("CSV 必须包含 wallet_label、asset、quantity")
        rows = [_validated(row) for row in reader]
    except csv.Error as exc:
        raise CryptoPortfolioError("CSV 无法解析") from exc
    keys = [(row["wallet_label"], row["asset"]) for row in rows]
    if len(keys) != len(set(keys)):
        raise CryptoPortfolioError("CSV 中存在重复的 wallet_label + asset")
    return rows


def commit_csv(content: str) -> list[dict[str, Any]]:
    incoming = parse_csv(content)
    keys = {(row["wallet_label"], row["asset"]) for row in incoming}
    with _LOCK:
        rows = [row for row in get_all() if (row.get("wallet_label"), row.get("asset")) not in keys]
        rows.extend(row for row in incoming if row["quantity"] > 0)
        _write(rows)
    return rows
