"""Small, local-first IBKR Flex current-position service.

This module intentionally owns only the current position snapshot. It does not
import orders, transactions, history, Notion data, or raw Flex XML. The last
valid normalized snapshot remains available when a later broker refresh fails.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from time import monotonic, sleep
from typing import Any
from xml.etree import ElementTree

import requests
import position_store


class PositionServiceError(RuntimeError):
    """Safe user-facing error for position configuration or broker failures."""

    def __init__(self, message: str, *, retryable: bool = False, code: str | None = None) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.code = code


_LOCK = threading.Lock()
_FLEX_REQUEST_LOCK = threading.Lock()
_LAST_FLEX_REQUEST_COMPLETED_AT: float | None = None
_LOGGER = logging.getLogger("uvicorn.error")
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
    payload = position_store.load("ibkr-current", _store_path())
    return payload if isinstance(payload, dict) else None


def _save(snapshot: dict[str, Any]) -> None:
    position_store.save("ibkr-current", snapshot, _store_path())


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
    started = monotonic()
    _LOGGER.info("[ibkr-flex] request started endpoint=%s timeout=%.1fs", path, timeout)
    try:
        response = requests.get(
            f"{base_url}{path}",
            params=params,
            headers={"User-Agent": "vibe-research/position-service"},
            timeout=timeout,
        )
    except requests.Timeout:
        _LOGGER.warning(
            "[ibkr-flex] request timeout endpoint=%s elapsed_ms=%d",
            path,
            int((monotonic() - started) * 1000),
        )
        raise PositionServiceError("IBKR Flex request timed out; previous snapshot was kept", retryable=True) from None
    except requests.ConnectionError as exc:
        _LOGGER.warning(
            "[ibkr-flex] connection failed endpoint=%s error_type=%s elapsed_ms=%d",
            path,
            type(exc).__name__,
            int((monotonic() - started) * 1000),
        )
        raise PositionServiceError("Unable to connect to IBKR Flex; previous snapshot was kept", retryable=True) from None
    except requests.RequestException as exc:
        _LOGGER.warning(
            "[ibkr-flex] request failed endpoint=%s error_type=%s elapsed_ms=%d",
            path,
            type(exc).__name__,
            int((monotonic() - started) * 1000),
        )
        raise PositionServiceError("IBKR Flex request failed before receiving a response; previous snapshot was kept") from None

    content_type = response.headers.get("Content-Type", "unknown").split(";", 1)[0].strip() or "unknown"
    body = response.content
    fingerprint = hashlib.sha256(body).hexdigest()[:12]
    diagnostic = f"{response.status_code}/{content_type}/{len(body)}b/{fingerprint}"
    try:
        response.raise_for_status()
    except requests.HTTPError:
        retryable = response.status_code in {408, 425, 429, 500, 502, 503, 504}
        _LOGGER.warning(
            "[ibkr-flex] HTTP failure endpoint=%s diagnostic=%s elapsed_ms=%d retryable=%s",
            path,
            diagnostic,
            int((monotonic() - started) * 1000),
            retryable,
        )
        raise PositionServiceError(
            f"IBKR Flex returned HTTP {response.status_code} (diagnostic {fingerprint}); previous snapshot was kept",
            retryable=retryable,
        ) from None
    try:
        root = ElementTree.fromstring(response.text)
    except ElementTree.ParseError as exc:
        _LOGGER.warning(
            "[ibkr-flex] invalid XML endpoint=%s diagnostic=%s elapsed_ms=%d",
            path,
            diagnostic,
            int((monotonic() - started) * 1000),
        )
        raise PositionServiceError(
            f"IBKR Flex returned invalid XML ({content_type}, diagnostic {fingerprint}); previous snapshot was kept",
            retryable=True,
        ) from exc
    root_name = str(root.tag).rsplit("}", 1)[-1]
    if root_name not in {"FlexQueryResponse", "FlexStatementResponse"}:
        _LOGGER.warning(
            "[ibkr-flex] unexpected document endpoint=%s root=%s diagnostic=%s elapsed_ms=%d",
            path,
            root_name,
            diagnostic,
            int((monotonic() - started) * 1000),
        )
        raise PositionServiceError(
            f"IBKR Flex returned an unexpected document ({content_type}, diagnostic {fingerprint}); previous snapshot was kept",
            retryable=True,
        )
    _LOGGER.info(
        "[ibkr-flex] response accepted endpoint=%s diagnostic=%s elapsed_ms=%d",
        path,
        diagnostic,
        int((monotonic() - started) * 1000),
    )
    return root


def _load_flex_statement(query_id: str | None = None) -> ElementTree.Element:
    token = _env("VR_IBKR_FLEX_TOKEN")
    query_id = (query_id or _env("VR_IBKR_FLEX_QUERY_ID")).strip()
    # A failed SendRequest counts against IBKR's query-level failure guard.
    # Default to one attempt; users can retry later after the provider cooldown.
    request_retries = max(1, min(int(_env("VR_IBKR_FLEX_REQUEST_RETRIES", "1")), 6))
    retry_delay = max(1.0, min(float(_env("VR_IBKR_FLEX_RETRY_DELAY_SECONDS", "5")), 30.0))
    root: ElementTree.Element | None = None
    for attempt in range(request_retries):
        root = _request_xml("/SendRequest", {"t": token, "q": query_id, "v": "3"})
        try:
            _raise_flex_failure(root)
            break
        except PositionServiceError as exc:
            # IBKR 1001 is transient: the report generator is busy or has not
            # released the previous report yet. Retry the request itself before
            # surfacing the error, rather than repeatedly polling GetStatement.
            if not exc.retryable or attempt >= request_retries - 1:
                raise
            _LOGGER.warning(
                "[ibkr-flex] retrying SendRequest attempt=%d/%d reason=%s",
                attempt + 2,
                request_retries,
                str(exc),
            )
            sleep(min(retry_delay * (2**attempt), 30.0))
    if root is None:
        raise PositionServiceError("IBKR Flex statement was not available")
    reference = _findtext_local(root, "ReferenceCode")
    if not reference:
        root_name = str(root.tag).rsplit("}", 1)[-1]
        fields = sorted({str(child.tag).rsplit("}", 1)[-1] for child in list(root)})
        shape = ",".join(fields[:8]) or "none"
        _LOGGER.warning("[ibkr-flex] reference code missing root=%s fields=%s", root_name, shape)
        raise PositionServiceError(
            f"IBKR Flex request did not return a reference code (root {root_name}; fields {shape})"
        )

    retries = max(1, min(int(_env("VR_IBKR_FLEX_RETRIES", "3")), 5))
    delay = max(0.5, min(float(_env("VR_IBKR_FLEX_RETRY_DELAY_SECONDS", "1")), 10.0))
    last_error: PositionServiceError | None = None
    for attempt in range(retries):
        try:
            statement = _request_xml("/GetStatement", {"t": token, "q": reference, "v": "3"})
            _raise_flex_failure(statement)
            return statement
        except PositionServiceError as exc:
            last_error = exc
            if exc.retryable and attempt < retries - 1:
                _LOGGER.warning(
                    "[ibkr-flex] retrying GetStatement attempt=%d/%d reason=%s",
                    attempt + 2,
                    retries,
                    str(exc),
                )
                sleep(delay)
            else:
                raise
    raise last_error or PositionServiceError("IBKR Flex statement was not available")


def load_flex_statement_serialized(
    query_id: str | None = None,
    *,
    min_interval_seconds: float = 0.0,
) -> ElementTree.Element:
    """Fetch one Flex report while serializing and pacing all broker requests."""
    global _LAST_FLEX_REQUEST_COMPLETED_AT
    interval = max(0.0, min(float(min_interval_seconds), 900.0))
    with _FLEX_REQUEST_LOCK:
        if _LAST_FLEX_REQUEST_COMPLETED_AT is not None and interval:
            remaining = interval - (monotonic() - _LAST_FLEX_REQUEST_COMPLETED_AT)
            if remaining > 0:
                _LOGGER.info("[ibkr-flex] pacing next report wait_seconds=%.1f", remaining)
                sleep(remaining)
        try:
            return _load_flex_statement() if query_id is None else _load_flex_statement(query_id)
        finally:
            # Failed report-generation requests also count for IBKR pacing.
            _LAST_FLEX_REQUEST_COMPLETED_AT = monotonic()


def _raise_flex_failure(root: ElementTree.Element) -> None:
    status = _findtext_local(root, "Status", "Success").lower()
    code = _findtext_local(root, "ErrorCode")
    message = _findtext_local(root, "ErrorMessage")
    # Some IBKR responses use namespaces or a non-standard failure status. An
    # explicit error code is authoritative even when Status is not exactly
    # "Fail"; otherwise the caller reports a misleading missing reference.
    if status in {"fail", "failed", "failure", "error"} or code:
        safe_code = code or "unknown"
        safe_message = message or "unknown error"
        if safe_code == "1025":
            safe_message += " Stop automated retries, run this Flex Query in Client Portal, and review or recreate the query before trying again."
        # Do not include the provider's raw response in the persisted snapshot.
        # 1018 is IBKR's pacing-limit response and should be retried only after
        # the user-visible cooldown, not immediately inside the same request.
        retryable = safe_code in {"1001", "1019"}
        raise PositionServiceError(
            f"IBKR Flex request failed ({safe_code}): {safe_message}",
            retryable=retryable,
            code=safe_code,
        )


def _findtext_local(root: ElementTree.Element, name: str, default: str = "") -> str:
    """Find the first element by local tag name, with or without XML namespaces."""
    for node in root.iter():
        if str(node.tag).rsplit("}", 1)[-1] == name:
            return (node.text or "").strip()
    return default


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


def _position_key(node: ElementTree.Element) -> tuple[str, str]:
    account_id = _first(node, "accountId", "fromAccountId")
    conid = _first(node, "conid", "conId")
    if conid:
        return account_id, f"conid:{conid}"
    venue = _first(node, "listingExchange", "exchange")
    symbol = _first(node, "symbol", "underlyingSymbol")
    return account_id, f"listing:{venue}:{symbol}"


def _trade_cost_basis(root: ElementTree.Element) -> dict[tuple[str, str], tuple[Decimal, Decimal, Decimal]]:
    basis: dict[tuple[str, str], tuple[Decimal, Decimal, Decimal]] = {}
    for node in root.findall(".//Trade"):
        if _first(node, "assetCategory", "assetClass").upper() not in {"STK", "STOCK", "EQUITY", "ETF", "FUND"}:
            continue
        key = _position_key(node)
        if not key[0] or not key[1].rsplit(":", 1)[-1]:
            continue
        quantity, cost, commission = basis.get(key, (Decimal("0"), Decimal("0"), Decimal("0")))
        basis[key] = (
            quantity + (_parse_decimal(_first(node, "quantity", "tradeQuantity"), Decimal("0")) or Decimal("0")),
            cost + (_parse_decimal(_first(node, "cost"), Decimal("0")) or Decimal("0")),
            commission + (_parse_decimal(_first(node, "ibCommission", "commission"), Decimal("0")) or Decimal("0")),
        )
    return basis


def _reconstructed_cost(
    node: ElementTree.Element,
    quantity: Decimal,
    trade_basis: dict[tuple[str, str], tuple[Decimal, Decimal, Decimal]],
) -> Decimal | None:
    values = trade_basis.get(_position_key(node))
    if values is None or quantity == 0:
        return None
    trade_quantity, cost, commission = values
    if trade_quantity != quantity or cost == 0:
        return None
    return abs((cost + abs(commission)) / quantity)


def _position_row(
    node: ElementTree.Element,
    base_currency: str,
    imported_at: str,
    trade_basis: dict[tuple[str, str], tuple[Decimal, Decimal, Decimal]],
) -> dict[str, Any] | None:
    account_id = _first(node, "accountId", "fromAccountId")
    symbol = _first(node, "symbol", "underlyingSymbol")
    if not account_id or not symbol:
        return None
    quantity = _parse_decimal(_first(node, "position", "quantity", "openPosition"), Decimal("0")) or Decimal("0")
    average_cost, cost_status = _average_cost(node, quantity)
    if average_cost is None:
        average_cost = _reconstructed_cost(node, quantity, trade_basis)
        if average_cost is not None:
            cost_status = "trade_reconstructed"
    latest_price = _parse_decimal(_first(node, "markPrice", "closePrice", "price"))
    local_value = _parse_decimal(_first(node, "positionValue"))
    fx_rate = _parse_decimal(_first(node, "fxRateToBase"), Decimal("1")) or Decimal("1")
    reporting_value = local_value * fx_rate if local_value is not None else (
        latest_price * quantity * fx_rate if latest_price is not None else None
    )
    broker_pnl = _parse_decimal(_first(node, "unrealizedPnL", "unrealizedPnl", "unrealizedPL", "fifoPnlUnrealized"))
    if broker_pnl is not None and (broker_pnl != 0 or cost_status == "broker"):
        pnl = broker_pnl
        pnl_status = "broker"
    elif latest_price is not None and average_cost is not None:
        pnl = (latest_price - average_cost) * quantity
        pnl_status = cost_status
    else:
        pnl = None
        pnl_status = "unavailable"
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
        "pnl_status": pnl_status,
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
            "pnl_status": "broker",
            "fx_rate": _number(fx_rate),
            "reporting_currency": currencies.get(account_id, "USD"),
            "cost_status": "broker",
            "observed_at": imported_at,
        })
    return rows


def _build_snapshot(root: ElementTree.Element) -> dict[str, Any]:
    imported_at = _now()
    currencies = _base_currencies(root)
    trade_basis = _trade_cost_basis(root)
    rows = [
        row
        for node in root.findall(".//OpenPosition")
        if (row := _position_row(node, currencies.get(_first(node, "accountId", "fromAccountId"), "USD"), imported_at, trade_basis))
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
    reconstructed = sum(row.get("cost_status") == "trade_reconstructed" for row in rows)
    unavailable = sum(row.get("cost_status") == "unavailable" for row in rows if row.get("asset_class") != "CASH")
    if reconstructed:
        warnings.append(f"Cost and unrealized P&L reconstructed from reconciled IBKR trades for {reconstructed} positions")
    if unavailable:
        warnings.append(f"Cost and unrealized P&L unavailable for {unavailable} positions because broker cost and reconcilable trades were absent")
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


def refresh_from_root(root: ElementTree.Element, *, confirm_empty: bool = False) -> dict[str, Any]:
    """Normalize and persist an already-fetched current-position statement."""
    current = _load()
    candidate = _build_snapshot(root)
    if current and current.get("positions") and not candidate.get("positions") and not confirm_empty:
        raise PositionServiceError("IBKR returned an empty portfolio; confirm_empty is required to replace the existing snapshot")
    _save(candidate)
    _LOGGER.info(
        "[ibkr-flex] refresh completed positions=%d report_date=%s",
        len(candidate.get("positions", [])),
        candidate.get("report_date"),
    )
    return _public_snapshot(candidate)


def refresh_with_root(*, confirm_empty: bool = False) -> tuple[ElementTree.Element, dict[str, Any]]:
    """Fetch current positions through the shared coordinator and return the XML plus snapshot."""
    if not _configured():
        raise PositionServiceError("IBKR Flex is not configured")
    with _LOCK:
        current = _load()
        _LOGGER.info(
            "[ibkr-flex] refresh started cached_snapshot=%s cached_refreshed_at=%s",
            bool(current),
            current.get("refreshed_at") if current else None,
        )
        cooldown = max(0.0, min(float(_env("VR_IBKR_FLEX_COOLDOWN_SECONDS", "300")), 3600.0))
        last = current.get("refreshed_at") if current else None
        if last:
            try:
                elapsed = datetime.now(timezone.utc).timestamp() - datetime.fromisoformat(last.replace("Z", "+00:00")).timestamp()
                if elapsed < cooldown:
                    raise PositionServiceError(f"IBKR refresh is cooling down; retry in {int(cooldown - elapsed)} seconds")
            except ValueError:
                pass
        try:
            root = load_flex_statement_serialized()
        except PositionServiceError as exc:
            _LOGGER.warning(
                "[ibkr-flex] refresh failed previous_snapshot_kept=%s reason=%s",
                bool(current),
                str(exc),
            )
            raise
        return root, refresh_from_root(root, confirm_empty=confirm_empty)


def refresh(*, confirm_empty: bool = False) -> dict[str, Any]:
    """Fetch and atomically replace the current snapshot from IBKR Flex."""
    _root, snapshot = refresh_with_root(confirm_empty=confirm_empty)
    return snapshot
