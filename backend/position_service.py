"""Small, local-first IBKR Flex current-position service.

This module intentionally owns only the current position snapshot. It does not
import orders, transactions, history, Notion data, or raw Flex XML. The last
valid normalized snapshot remains available when a later broker refresh fails.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from time import sleep
from typing import Any
from xml.etree import ElementTree

import requests


class PositionServiceError(RuntimeError):
    """Safe user-facing error for position configuration or broker failures."""


_LOCK = threading.Lock()
_DEFAULT_BASE_URL = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService"
_DEFAULT_STORE = Path(os.environ.get("VR_DATA_DIR", "~/.vibe-research")).expanduser() / "ibkr-positions.json"


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _store_path() -> Path:
    return Path(os.environ.get("VR_IBKR_POSITION_STORE", str(_DEFAULT_STORE))).expanduser()


def _configured() -> bool:
    return bool(_env("VR_IBKR_FLEX_TOKEN") and _env("VR_IBKR_FLEX_QUERY_ID"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_decimal(value: str, default: Decimal | None = None) -> Decimal | None:
    if not value:
        return default
    try:
        return Decimal(value.replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return default


def _number(value: Decimal | None) -> float | None:
    return None if value is None else float(value)


def _first(node: ElementTree.Element, *keys: str, default: str = "") -> str:
    for key in keys:
        value = node.attrib.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return default


def _mask_account(account_id: str) -> str:
    suffix = account_id[-4:] if len(account_id) >= 4 else account_id
    return f"IBKR ••••{suffix}"


def _account_ref(account_id: str) -> str:
    return hashlib.sha256(f"vibe-account:{account_id}".encode()).hexdigest()[:16]


def _load() -> dict[str, Any] | None:
    try:
        return json.loads(_store_path().read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _save(snapshot: dict[str, Any]) -> None:
    path = _store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)


def _status_snapshot() -> dict[str, Any]:
    snapshot = _load()
    if snapshot is not None:
        return snapshot
    return {
        "status": "not_configured" if not _configured() else "empty",
        "source": "ibkr-flex",
        "fetched_at": None,
        "refreshed_at": None,
        "report_date": None,
        "summary": {"reporting_currency": None, "nav": None, "reporting_coverage": None},
        "positions": [],
        "warnings": [],
    }


def _public_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Remove locally useful but sensitive broker account IDs at the API boundary."""
    result = json.loads(json.dumps(snapshot))
    for row in result.get("positions", []):
        row.pop("account_id", None)
    return result


def _request_xml(path: str, params: dict[str, str]) -> ElementTree.Element:
    base_url = _env("VR_IBKR_FLEX_BASE_URL", _DEFAULT_BASE_URL).rstrip("/")
    timeout = max(5.0, min(float(_env("VR_IBKR_FLEX_TIMEOUT_SECONDS", "20")), 60.0))
    try:
        response = requests.get(
            f"{base_url}{path}",
            params=params,
            headers={"User-Agent": "vibe-research/position-service"},
            timeout=timeout,
        )
        response.raise_for_status()
        return ElementTree.fromstring(response.text)
    except (requests.RequestException, ElementTree.ParseError) as exc:
        raise PositionServiceError("IBKR Flex service is unavailable or returned invalid XML") from exc


def _load_flex_statement() -> ElementTree.Element:
    token = _env("VR_IBKR_FLEX_TOKEN")
    query_id = _env("VR_IBKR_FLEX_QUERY_ID")
    root = _request_xml("/SendRequest", {"t": token, "q": query_id, "v": "3"})
    _raise_flex_failure(root)
    reference = root.findtext(".//ReferenceCode", default="").strip()
    if not reference:
        raise PositionServiceError("IBKR Flex request did not return a reference code")

    retries = max(1, min(int(_env("VR_IBKR_FLEX_RETRIES", "3")), 5))
    delay = max(0.5, min(float(_env("VR_IBKR_FLEX_RETRY_DELAY_SECONDS", "1")), 10.0))
    last_error: PositionServiceError | None = None
    for attempt in range(retries):
        statement = _request_xml("/GetStatement", {"t": token, "q": reference, "v": "3"})
        try:
            _raise_flex_failure(statement)
            return statement
        except PositionServiceError as exc:
            last_error = exc
            if attempt < retries - 1:
                sleep(delay)
    raise last_error or PositionServiceError("IBKR Flex statement was not available")


def _raise_flex_failure(root: ElementTree.Element) -> None:
    status = root.findtext(".//Status", default="Success").strip().lower()
    if status == "fail":
        code = root.findtext(".//ErrorCode", default="unknown").strip()
        # Do not include the provider's raw response in the persisted snapshot.
        raise PositionServiceError(f"IBKR Flex request failed ({code})")


def _base_currencies(root: ElementTree.Element) -> dict[str, str]:
    result: dict[str, str] = {}
    for node in root.findall(".//FlexStatement") + root.findall(".//AccountInformation"):
        account_id = _first(node, "accountId", "fromAccountId")
        if account_id:
            result[account_id] = _first(node, "currency", "baseCurrency", default="USD").upper()
    return result


def _average_cost(node: ElementTree.Element, quantity: Decimal) -> tuple[Decimal | None, str]:
    unit = _parse_decimal(_first(node, "costBasisPrice", "avgCost", "avgPrice"))
    if unit is not None and unit != 0:
        return abs(unit), "broker"
    total = _parse_decimal(_first(node, "costBasisMoney", "costBasis"))
    if total is not None and quantity != 0 and total != 0:
        return abs(total / quantity), "broker"
    return None, "unavailable"


def _position_row(node: ElementTree.Element, base_currency: str, imported_at: str) -> dict[str, Any] | None:
    account_id = _first(node, "accountId", "fromAccountId")
    symbol = _first(node, "symbol", "underlyingSymbol")
    if not account_id or not symbol:
        return None
    quantity = _parse_decimal(_first(node, "position", "quantity", "openPosition"), Decimal("0")) or Decimal("0")
    average_cost, cost_status = _average_cost(node, quantity)
    latest_price = _parse_decimal(_first(node, "markPrice", "closePrice", "price"))
    local_value = _parse_decimal(_first(node, "positionValue"))
    fx_rate = _parse_decimal(_first(node, "fxRateToBase"), Decimal("1")) or Decimal("1")
    reporting_value = local_value * fx_rate if local_value is not None else (
        latest_price * quantity * fx_rate if latest_price is not None else None
    )
    broker_pnl = _parse_decimal(_first(node, "unrealizedPnL", "unrealizedPnl", "unrealizedPL"))
    pnl = broker_pnl
    if pnl is None and latest_price is not None and average_cost is not None:
        pnl = (latest_price - average_cost) * quantity
    currency = _first(node, "currency", default="USD").upper()
    return {
        "account_ref": _account_ref(account_id),
        "account_label": _mask_account(account_id),
        "account_id": account_id,
        "symbol": symbol,
        "name": _first(node, "description", default=symbol),
        "asset_class": _first(node, "assetCategory", "assetClass", default="STK").upper(),
        "currency": currency,
        "venue": _first(node, "listingExchange", "exchange") or None,
        "quantity": _number(quantity),
        "average_cost": _number(average_cost),
        "latest_price": _number(latest_price),
        "market_value": _number(local_value),
        "reporting_market_value": _number(reporting_value),
        "unrealized_pnl": _number(pnl),
        "fx_rate": _number(fx_rate),
        "reporting_currency": base_currency,
        "cost_status": cost_status,
        "observed_at": imported_at,
    }


def _cash_rows(root: ElementTree.Element, currencies: dict[str, str], imported_at: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for node in root.findall(".//CashReportCurrency"):
        if _first(node, "levelOfDetail").lower() != "currency":
            continue
        account_id = _first(node, "accountId", "fromAccountId")
        currency = _first(node, "currency").upper()
        cash = _parse_decimal(_first(node, "endingCash"))
        if not account_id or not currency or cash is None or cash == 0:
            continue
        fx_rate = _parse_decimal(_first(node, "fxRateToBase"), Decimal("1")) or Decimal("1")
        rows.append({
            "account_ref": _account_ref(account_id),
            "account_label": _mask_account(account_id),
            "account_id": account_id,
            "symbol": f"CASH.{currency}",
            "name": f"{currency} Cash",
            "asset_class": "CASH",
            "currency": currency,
            "venue": None,
            "quantity": _number(cash),
            "average_cost": 1.0,
            "latest_price": 1.0,
            "market_value": _number(cash),
            "reporting_market_value": _number(cash * fx_rate),
            "unrealized_pnl": 0.0,
            "fx_rate": _number(fx_rate),
            "reporting_currency": currencies.get(account_id, "USD"),
            "cost_status": "broker",
            "observed_at": imported_at,
        })
    return rows


def _build_snapshot(root: ElementTree.Element) -> dict[str, Any]:
    imported_at = _now()
    currencies = _base_currencies(root)
    rows = [
        row
        for node in root.findall(".//OpenPosition")
        if (row := _position_row(node, currencies.get(_first(node, "accountId", "fromAccountId"), "USD"), imported_at))
    ]
    rows.extend(_cash_rows(root, currencies, imported_at))
    accounts = set(currencies)
    accounts.update(row["account_id"] for row in rows)
    if not accounts:
        raise PositionServiceError("IBKR Flex response contained no supported accounts")
    equity_nodes = root.findall(".//EquitySummaryByReportDateInBase")
    report_dates = [_first(node, "reportDate") for node in equity_nodes if _first(node, "reportDate")]
    report_date = max(report_dates) if report_dates else None
    current_equity_nodes = (
        [node for node in equity_nodes if _first(node, "reportDate") == report_date]
        if report_date
        else equity_nodes
    )
    summary_currencies = {
        currencies.get(_first(node, "accountId", "fromAccountId"), "USD")
        for node in current_equity_nodes
    }
    summary_currencies.update(row["reporting_currency"] for row in rows)
    nav_values = [
        _parse_decimal(_first(node, "total"))
        for node in current_equity_nodes
        if _parse_decimal(_first(node, "total")) is not None
    ]
    warnings: list[str] = []
    compatible_currency = next(iter(summary_currencies)) if len(summary_currencies) == 1 else None
    if compatible_currency is None and summary_currencies:
        warnings.append("Multiple account base currencies; aggregate NAV and coverage are unavailable")
    nav = sum(nav_values, Decimal("0")) if nav_values and compatible_currency else None
    invested = sum(
        (
            Decimal(str(row["reporting_market_value"]))
            for row in rows
            if row["reporting_market_value"] is not None
            and row["reporting_currency"] == compatible_currency
        ),
        Decimal("0"),
    )
    coverage = (invested / nav) if nav not in (None, Decimal("0")) else None
    rows.sort(key=lambda row: abs(row.get("reporting_market_value") or 0), reverse=True)
    return {
        "status": "empty" if not rows else "available",
        "source": "ibkr-flex",
        "fetched_at": imported_at,
        "refreshed_at": imported_at,
        "report_date": report_date,
        "summary": {
            "reporting_currency": compatible_currency,
            "nav": _number(nav),
            "reporting_coverage": _number(coverage),
        },
        "positions": rows,
        "warnings": warnings,
    }


def get_current() -> dict[str, Any]:
    """Return the last normalized snapshot without contacting IBKR."""
    return _public_snapshot(_status_snapshot())


def refresh(*, confirm_empty: bool = False) -> dict[str, Any]:
    """Fetch and atomically replace the current snapshot from IBKR Flex."""
    if not _configured():
        raise PositionServiceError("IBKR Flex is not configured")
    with _LOCK:
        current = _load()
        cooldown = max(0.0, min(float(_env("VR_IBKR_FLEX_COOLDOWN_SECONDS", "300")), 3600.0))
        last = current.get("refreshed_at") if current else None
        if last:
            try:
                elapsed = datetime.now(timezone.utc).timestamp() - datetime.fromisoformat(last.replace("Z", "+00:00")).timestamp()
                if elapsed < cooldown:
                    raise PositionServiceError(f"IBKR refresh is cooling down; retry in {int(cooldown - elapsed)} seconds")
            except ValueError:
                pass
        candidate = _build_snapshot(_load_flex_statement())
        if current and current.get("positions") and not candidate.get("positions") and not confirm_empty:
            raise PositionServiceError("IBKR returned an empty portfolio; confirm_empty is required to replace the existing snapshot")
        _save(candidate)
        return _public_snapshot(candidate)
