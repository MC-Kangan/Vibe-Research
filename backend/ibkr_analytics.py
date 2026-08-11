"""Local IBKR portfolio analytics owned by Vibe Research.

Flex XML is fetched on request, normalized into a small SQLite ledger, and exposed through read-only
analytics helpers.  The existing JSON current-position snapshot remains the
compatibility source for ``/api/positions/current``.
"""

from __future__ import annotations

import hashlib
import logging
import os
import sqlite3
import threading
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import market_data
import position_service


LOGGER = logging.getLogger("uvicorn.error")
_DB_LOCK = threading.RLock()
_JOB_LOCK = threading.Lock()
_ACTIVE_JOB: str | None = None


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _db_path() -> Path:
    configured = _env("VR_IBKR_ANALYTICS_STORE")
    if configured:
        return Path(configured).expanduser()
    return Path(os.environ.get("VR_DATA_DIR", "~/.vibe-research")).expanduser() / "ibkr-analytics.sqlite3"


def configured() -> bool:
    return bool(_env("VR_IBKR_FLEX_TOKEN") and _env("VR_IBKR_FLEX_QUERY_ID"))


def history_configured() -> bool:
    return bool(_env("VR_IBKR_FLEX_TOKEN") and _env("VR_IBKR_FLEX_HISTORY_QUERY_ID"))


def _connection() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=30, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def initialize() -> None:
    with _DB_LOCK, _connection() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS ibkr_trades (
              trade_key TEXT PRIMARY KEY,
              account_ref TEXT NOT NULL,
              account_label TEXT NOT NULL,
              instrument_key TEXT NOT NULL,
              symbol TEXT NOT NULL,
              name TEXT NOT NULL,
              asset_class TEXT NOT NULL,
              currency TEXT NOT NULL,
              venue TEXT,
              occurred_at TEXT NOT NULL,
              side TEXT NOT NULL,
              quantity REAL NOT NULL,
              price REAL,
              fees REAL NOT NULL DEFAULT 0,
              gross_amount REAL NOT NULL DEFAULT 0,
              taxes REAL NOT NULL DEFAULT 0,
              net_cash REAL,
              description TEXT,
              external_id TEXT,
              source TEXT NOT NULL DEFAULT 'ibkr-flex'
            );
            CREATE INDEX IF NOT EXISTS idx_ibkr_trades_instrument
              ON ibkr_trades(account_ref, instrument_key, occurred_at);
            CREATE TABLE IF NOT EXISTS ibkr_instruments (
              instrument_key TEXT PRIMARY KEY,
              symbol TEXT NOT NULL,
              name TEXT NOT NULL,
              asset_class TEXT NOT NULL,
              currency TEXT NOT NULL,
              venue TEXT,
              conid TEXT,
              isin TEXT,
              provider_symbol TEXT,
              price_multiplier REAL NOT NULL DEFAULT 1,
              mapping_source TEXT NOT NULL DEFAULT 'auto',
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ibkr_daily_nav (
              account_ref TEXT NOT NULL,
              report_date TEXT NOT NULL,
              currency TEXT NOT NULL,
              starting_value REAL NOT NULL,
              ending_value REAL NOT NULL,
              mtm REAL NOT NULL,
              realized REAL NOT NULL,
              change_in_unrealized REAL NOT NULL,
              deposits_withdrawals REAL NOT NULL,
              commissions REAL NOT NULL,
              dividends REAL NOT NULL,
              interest REAL NOT NULL,
              flow_data_available INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (account_ref, report_date, currency)
            );
            CREATE TABLE IF NOT EXISTS ibkr_reconciliations (
              reconciliation_key TEXT PRIMARY KEY,
              account_ref TEXT NOT NULL,
              account_label TEXT NOT NULL,
              observed_at TEXT NOT NULL,
              currency TEXT NOT NULL,
              broker_nav REAL NOT NULL,
              calculated_nav REAL NOT NULL,
              nav_difference REAL NOT NULL,
              broker_cash REAL,
              calculated_cash REAL NOT NULL,
              cash_difference REAL,
              status TEXT NOT NULL,
              source TEXT NOT NULL DEFAULT 'ibkr-flex'
            );
            CREATE INDEX IF NOT EXISTS idx_ibkr_reconciliations_account
              ON ibkr_reconciliations(account_ref, observed_at);
            CREATE TABLE IF NOT EXISTS ibkr_daily_pnl (
              account_ref TEXT NOT NULL,
              report_date TEXT NOT NULL,
              symbol TEXT NOT NULL,
              asset_class TEXT NOT NULL,
              previous_close_quantity REAL NOT NULL,
              previous_close_price REAL NOT NULL,
              close_quantity REAL NOT NULL,
              close_price REAL NOT NULL,
              transaction_mtm REAL NOT NULL,
              prior_open_mtm REAL NOT NULL,
              commissions REAL NOT NULL,
              total REAL NOT NULL,
              is_total INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (account_ref, report_date, symbol, asset_class)
            );
            CREATE TABLE IF NOT EXISTS ibkr_refresh_runs (
              job_id TEXT PRIMARY KEY,
              status TEXT NOT NULL,
              stage TEXT NOT NULL,
              started_at TEXT NOT NULL,
              finished_at TEXT,
              positions_status TEXT NOT NULL DEFAULT 'queued',
              history_status TEXT NOT NULL DEFAULT 'queued',
              error_message TEXT,
              positions_report_date TEXT,
              history_report_date TEXT
            );
            """
        )
        _ensure_trade_ledger_columns(db)
        _ensure_daily_nav_columns(db)


def _ensure_trade_ledger_columns(db: sqlite3.Connection) -> None:
    """Keep an existing local ledger usable as its broker fact set grows."""
    columns = {row["name"] for row in db.execute("PRAGMA table_info(ibkr_trades)")}
    additions = {
        "gross_amount": "gross_amount REAL NOT NULL DEFAULT 0",
        "taxes": "taxes REAL NOT NULL DEFAULT 0",
        "description": "description TEXT",
    }
    for name, definition in additions.items():
        if name not in columns:
            db.execute(f"ALTER TABLE ibkr_trades ADD COLUMN {definition}")


def _ensure_daily_nav_columns(db: sqlite3.Connection) -> None:
    columns = {row["name"] for row in db.execute("PRAGMA table_info(ibkr_daily_nav)")}
    if "flow_data_available" not in columns:
        db.execute("ALTER TABLE ibkr_daily_nav ADD COLUMN flow_data_available INTEGER NOT NULL DEFAULT 0")


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _decimal(node: Any, *keys: str, default: float = 0.0) -> float:
    for key in keys:
        value = node.attrib.get(key) if hasattr(node, "attrib") else None
        if value is None or str(value).strip() == "":
            continue
        try:
            return float(str(value).replace(",", ""))
        except ValueError:
            continue
    return default


def _attr(node: Any, *keys: str, default: str = "") -> str:
    for key in keys:
        value = node.attrib.get(key) if hasattr(node, "attrib") else None
        if value is not None and str(value).strip():
            return str(value).strip()
    return default


def _has_attr(node: Any, *keys: str) -> bool:
    return any(key in getattr(node, "attrib", {}) and str(node.attrib[key]).strip() for key in keys)


def _parse_datetime(node: Any) -> str | None:
    value = _attr(node, "dateTime", "tradeDate", "reportDate")
    timezone_name = _env("VR_IBKR_FLEX_TIMEZONE", "Europe/London")
    try:
        local_zone = ZoneInfo(timezone_name)
    except Exception:  # noqa: BLE001
        local_zone = UTC
    for pattern in ("%Y%m%d;%H%M%S", "%Y%m%d"):
        try:
            return datetime.strptime(value, pattern).replace(tzinfo=local_zone).astimezone(UTC).isoformat().replace("+00:00", "Z")
        except ValueError:
            continue
    return None


def _parse_date(value: str, fallback: date | None = None) -> str | None:
    raw = (value or "").strip()
    for pattern in ("%Y%m%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, pattern).date().isoformat()
        except ValueError:
            continue
    return fallback.isoformat() if fallback else None


def instrument_key(account_ref: str, symbol: str, currency: str, venue: str | None = None, conid: str | None = None) -> str:
    # Keep the key stable between OpenPosition, Trade and the normalized JSON
    # snapshot.  Some Flex queries include conid on one record type but omit it
    # on another, so using it would split one holding into two deep-dive rows.
    identity = f"{venue or ''}:{symbol}:{currency}"
    return hashlib.sha256(f"{account_ref}:{identity}".encode()).hexdigest()[:24]


def _account_ref(account_id: str) -> str:
    return hashlib.sha256(f"vibe-account:{account_id}".encode()).hexdigest()[:16]


def _account_label(account_id: str) -> str:
    return f"IBKR ••••{account_id[-4:] if len(account_id) >= 4 else account_id}"


def _upsert_instrument(db: sqlite3.Connection, row: dict[str, Any]) -> None:
    db.execute(
        """INSERT INTO ibkr_instruments
        (instrument_key, symbol, name, asset_class, currency, venue, conid, isin, provider_symbol, price_multiplier, mapping_source, updated_at)
        VALUES (:instrument_key, :symbol, :name, :asset_class, :currency, :venue, :conid, :isin, :provider_symbol, :price_multiplier, :mapping_source, :updated_at)
        ON CONFLICT(instrument_key) DO UPDATE SET
          symbol=excluded.symbol, name=excluded.name, asset_class=excluded.asset_class,
          currency=excluded.currency, venue=excluded.venue, conid=excluded.conid,
          isin=excluded.isin, updated_at=excluded.updated_at""",
        row,
    )


def _instrument_from_node(node: Any, account_ref: str) -> dict[str, Any] | None:
    symbol = _attr(node, "symbol", "underlyingSymbol").upper()
    if not symbol:
        return None
    currency = _attr(node, "currency", default="USD").upper()
    venue = _attr(node, "listingExchange", "exchange") or None
    conid = _attr(node, "conid", "conId") or None
    isin = _attr(node, "isin") or None
    asset_class = _attr(node, "assetCategory", "assetClass", default="STK").upper()
    return {
        "instrument_key": instrument_key(account_ref, symbol, currency, venue, conid),
        "symbol": symbol,
        "name": _attr(node, "description", default=symbol),
        "asset_class": asset_class,
        "currency": currency,
        "venue": venue,
        "conid": conid,
        "isin": isin,
        "provider_symbol": None,
        "price_multiplier": 1.0,
        "mapping_source": "auto",
        "updated_at": _now(),
    }


def _parse_current_trades(root: Any) -> list[dict[str, Any]]:
    trades: list[dict[str, Any]] = []
    for node in root.findall(".//Trade"):
        account_id = _attr(node, "accountId", "fromAccountId")
        external_id = _attr(node, "transactionID", "tradeID", "ibExecID")
        item = _instrument_from_node(node, _account_ref(account_id)) if account_id else None
        if not account_id or not external_id or item is None:
            continue
        side = _attr(node, "buySell", default="OTHER").upper()
        if side not in {"BUY", "SELL"}:
            continue
        occurred_at = _parse_datetime(node)
        if occurred_at is None:
            LOGGER.warning("[ibkr-analytics] skipped trade with invalid timestamp external_id=%s", external_id)
            continue
        return_key = f"ibkr-flex:{account_id}:{external_id}"
        trades.append({
            "trade_key": hashlib.sha256(return_key.encode()).hexdigest(),
            "account_ref": _account_ref(account_id),
            "account_label": _account_label(account_id),
            "instrument_key": item["instrument_key"],
            "symbol": item["symbol"],
            "name": item["name"],
            "asset_class": item["asset_class"],
            "currency": item["currency"],
            "venue": item["venue"],
            "occurred_at": occurred_at,
            "side": side,
            "quantity": abs(_decimal(node, "quantity", "tradeQuantity")),
            "price": _decimal(node, "tradePrice", "price", default=0.0),
            # Preserve broker economics rather than reconstructing them later.
            # IBKR normally reports commissions and taxes as signed cash effects.
            "fees": _decimal(node, "ibCommission", "commission"),
            "gross_amount": _decimal(node, "proceeds"),
            "taxes": _decimal(node, "taxes"),
            "net_cash": _decimal(node, "netCash", default=0.0),
            "description": _attr(node, "description") or None,
            "external_id": external_id,
            "source": "ibkr-flex",
            "instrument": item,
        })
    return trades


def _insert_current_data(root: Any) -> int:
    initialize()
    trades = _parse_current_trades(root)
    with _DB_LOCK, _connection() as db:
        for trade in trades:
            _upsert_instrument(db, trade.pop("instrument"))
            db.execute(
                """INSERT INTO ibkr_trades
                (trade_key, account_ref, account_label, instrument_key, symbol, name, asset_class, currency, venue, occurred_at, side, quantity, price, fees, gross_amount, taxes, net_cash, description, external_id, source)
                VALUES (:trade_key, :account_ref, :account_label, :instrument_key, :symbol, :name, :asset_class, :currency, :venue, :occurred_at, :side, :quantity, :price, :fees, :gross_amount, :taxes, :net_cash, :description, :external_id, :source)
                ON CONFLICT(trade_key) DO UPDATE SET
                  occurred_at=excluded.occurred_at, side=excluded.side, quantity=excluded.quantity,
                  price=excluded.price, fees=excluded.fees, gross_amount=excluded.gross_amount,
                  taxes=excluded.taxes, net_cash=excluded.net_cash,
                  description=excluded.description""",
                trade,
            )
        _insert_reconciliations(db, root)
    return len(trades)


def _insert_reconciliations(db: sqlite3.Connection, root: Any) -> None:
    """Persist an account-level broker check when the statement has enough facts."""
    latest_equity: dict[str, Any] = {}
    for node in root.findall(".//EquitySummaryByReportDateInBase"):
        account_id = _attr(node, "accountId", "fromAccountId")
        report_date = _attr(node, "reportDate")
        current = latest_equity.get(account_id)
        if account_id and report_date and (current is None or report_date > _attr(current, "reportDate")):
            latest_equity[account_id] = node

    base_cash: dict[str, float] = {}
    for node in root.findall(".//CashReportCurrency"):
        account_id = _attr(node, "accountId", "fromAccountId")
        if account_id and _attr(node, "levelOfDetail").lower() == "basecurrency" and _has_attr(node, "endingCash"):
            base_cash[account_id] = _decimal(node, "endingCash")

    securities: dict[str, float] = {}
    for node in root.findall(".//OpenPosition"):
        account_id = _attr(node, "accountId", "fromAccountId")
        if not account_id:
            continue
        securities[account_id] = securities.get(account_id, 0.0) + _decimal(node, "positionValue") * _decimal(node, "fxRateToBase", default=1.0)

    tolerance = 0.02
    for account_id, node in latest_equity.items():
        if account_id not in base_cash or not _has_attr(node, "total"):
            continue
        report_date = _attr(node, "reportDate")
        broker_nav = _decimal(node, "total")
        calculated_cash = base_cash[account_id]
        calculated_nav = securities.get(account_id, 0.0) + calculated_cash
        broker_cash = _decimal(node, "cash") if _has_attr(node, "cash") else None
        nav_difference = calculated_nav - broker_nav
        cash_difference = calculated_cash - broker_cash if broker_cash is not None else None
        matched = abs(nav_difference) <= tolerance and (cash_difference is None or abs(cash_difference) <= tolerance)
        row = {
            "reconciliation_key": hashlib.sha256(f"ibkr-flex:{account_id}:{report_date}".encode()).hexdigest(),
            "account_ref": _account_ref(account_id),
            "account_label": _account_label(account_id),
            "observed_at": _parse_date(report_date) or report_date,
            "currency": _attr(node, "currency", default="USD").upper(),
            "broker_nav": broker_nav,
            "calculated_nav": calculated_nav,
            "nav_difference": nav_difference,
            "broker_cash": broker_cash,
            "calculated_cash": calculated_cash,
            "cash_difference": cash_difference,
            "status": "matched" if matched else "warning",
            "source": "ibkr-flex",
        }
        db.execute(
            """INSERT INTO ibkr_reconciliations
            (reconciliation_key, account_ref, account_label, observed_at, currency, broker_nav, calculated_nav,
             nav_difference, broker_cash, calculated_cash, cash_difference, status, source)
            VALUES (:reconciliation_key, :account_ref, :account_label, :observed_at, :currency, :broker_nav, :calculated_nav,
                    :nav_difference, :broker_cash, :calculated_cash, :cash_difference, :status, :source)
            ON CONFLICT(reconciliation_key) DO UPDATE SET
              broker_nav=excluded.broker_nav, calculated_nav=excluded.calculated_nav,
              nav_difference=excluded.nav_difference, broker_cash=excluded.broker_cash,
              calculated_cash=excluded.calculated_cash, cash_difference=excluded.cash_difference,
              status=excluded.status""",
            row,
        )


def _insert_current_instruments(root: Any) -> None:
    initialize()
    with _DB_LOCK, _connection() as db:
        for node in root.findall(".//OpenPosition") + root.findall(".//Trade"):
            account_id = _attr(node, "accountId", "fromAccountId")
            item = _instrument_from_node(node, _account_ref(account_id)) if account_id else None
            if item is not None:
                _upsert_instrument(db, item)


def _history_rows(root: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    nav_rows: list[dict[str, Any]] = []
    pnl_rows: list[dict[str, Any]] = []
    for statement in root.findall(".//FlexStatement"):
        account_id = _attr(statement, "accountId", "fromAccountId")
        if not account_id:
            continue
        account_ref = _account_ref(account_id)
        fallback = _parse_date(_attr(statement, "toDate", "fromDate"))
        nav = statement.find(".//ChangeInNAV")
        if nav is not None:
            report_date = _parse_date(_attr(nav, "toDate", "fromDate")) or fallback or datetime.now(UTC).date().isoformat()
            nav_rows.append({
                "account_ref": account_ref,
                "report_date": report_date,
                "currency": _attr(nav, "currency", default=_attr(statement, "currency", default="USD")).upper(),
                "starting_value": _decimal(nav, "startingValue"),
                "ending_value": _decimal(nav, "endingValue"),
                "mtm": _decimal(nav, "mtm"),
                "realized": _decimal(nav, "realized"),
                "change_in_unrealized": _decimal(nav, "changeInUnrealized"),
                "deposits_withdrawals": _decimal(nav, "depositsWithdrawals"),
                "commissions": _decimal(nav, "commissions"),
                "dividends": _decimal(nav, "dividends"),
                "interest": _decimal(nav, "interest"),
                "flow_data_available": 1 if _has_attr(nav, "startingValue") and _has_attr(nav, "endingValue") and _has_attr(nav, "depositsWithdrawals") else 0,
            })
        for node in statement.findall(".//MTMPerformanceSummaryUnderlying"):
            report_date = _parse_date(_attr(node, "reportDate")) or fallback
            if not report_date:
                continue
            pnl_rows.append({
                "account_ref": account_ref,
                "report_date": report_date,
                "symbol": _attr(node, "symbol", default="__TOTAL__").upper(),
                "asset_class": _attr(node, "assetCategory", "assetClass", default="TOTAL").upper(),
                "previous_close_quantity": _decimal(node, "prevCloseQuantity", "previousCloseQuantity"),
                "previous_close_price": _decimal(node, "prevClosePrice", "previousClosePrice"),
                "close_quantity": _decimal(node, "closeQuantity"),
                "close_price": _decimal(node, "closePrice"),
                "transaction_mtm": _decimal(node, "transactionMtm"),
                "prior_open_mtm": _decimal(node, "priorOpenMtm"),
                "commissions": _decimal(node, "commissions"),
                "total": _decimal(node, "total"),
                "is_total": 1 if _attr(node, "symbol") in {"", "__TOTAL__"} else 0,
            })
    return nav_rows, pnl_rows, len(root.findall(".//Trade"))


def _insert_history(root: Any) -> tuple[int, int, str | None]:
    initialize()
    nav_rows, pnl_rows, _trade_count = _history_rows(root)
    _insert_current_instruments(root)
    _insert_current_data(root)
    with _DB_LOCK, _connection() as db:
        for row in nav_rows:
            db.execute(
                """INSERT INTO ibkr_daily_nav
                (account_ref, report_date, currency, starting_value, ending_value, mtm, realized,
                 change_in_unrealized, deposits_withdrawals, commissions, dividends, interest, flow_data_available)
                VALUES (:account_ref, :report_date, :currency, :starting_value, :ending_value, :mtm, :realized,
                        :change_in_unrealized, :deposits_withdrawals, :commissions, :dividends, :interest, :flow_data_available)
                ON CONFLICT(account_ref, report_date, currency) DO UPDATE SET
                  starting_value=excluded.starting_value, ending_value=excluded.ending_value,
                  mtm=excluded.mtm, realized=excluded.realized, change_in_unrealized=excluded.change_in_unrealized,
                  deposits_withdrawals=excluded.deposits_withdrawals, commissions=excluded.commissions,
                  dividends=excluded.dividends, interest=excluded.interest,
                  flow_data_available=excluded.flow_data_available""",
                row,
            )
        for row in pnl_rows:
            db.execute(
                """INSERT INTO ibkr_daily_pnl VALUES
                (:account_ref, :report_date, :symbol, :asset_class, :previous_close_quantity, :previous_close_price, :close_quantity, :close_price, :transaction_mtm, :prior_open_mtm, :commissions, :total, :is_total)
                ON CONFLICT(account_ref, report_date, symbol, asset_class) DO UPDATE SET
                  previous_close_quantity=excluded.previous_close_quantity, previous_close_price=excluded.previous_close_price,
                  close_quantity=excluded.close_quantity, close_price=excluded.close_price, transaction_mtm=excluded.transaction_mtm,
                  prior_open_mtm=excluded.prior_open_mtm, commissions=excluded.commissions, total=excluded.total, is_total=excluded.is_total""",
                row,
            )
    dates = [row["report_date"] for row in nav_rows if row.get("report_date")]
    return len(nav_rows), len(pnl_rows), max(dates) if dates else None


def _update_run(job_id: str, **values: Any) -> None:
    initialize()
    assignments = ", ".join(f"{key} = ?" for key in values)
    with _DB_LOCK, _connection() as db:
        db.execute(f"UPDATE ibkr_refresh_runs SET {assignments} WHERE job_id = ?", [*values.values(), job_id])


def _load_history_with_adaptive_pacing() -> Any:
    """Load history quickly in the normal case, with one bounded provider-aware retry."""
    query_id = _env("VR_IBKR_FLEX_HISTORY_QUERY_ID")
    initial_delay = max(1.0, min(float(_env("VR_IBKR_FLEX_INTER_QUERY_DELAY_SECONDS", "5")), 60.0))
    try:
        return position_service.load_flex_statement_serialized(query_id, min_interval_seconds=initial_delay)
    except position_service.PositionServiceError as exc:
        retry_delay = {"1001": 15.0, "1019": 15.0, "1018": 60.0}.get(exc.code or "")
        if retry_delay is None:
            raise
        LOGGER.warning(
            "[ibkr-analytics] history request will retry once code=%s wait_seconds=%.1f",
            exc.code,
            retry_delay,
        )
        return position_service.load_flex_statement_serialized(query_id, min_interval_seconds=retry_delay)


def _run_worker(job_id: str) -> None:
    global _ACTIVE_JOB
    current_error: str | None = None
    try:
        _update_run(job_id, status="running", stage="positions", positions_status="running")
        try:
            current_root, snapshot = position_service.refresh_with_root()
            _insert_current_instruments(current_root)
            trade_count = _insert_current_data(current_root)
            _update_run(
                job_id,
                positions_status="complete",
                positions_report_date=snapshot.get("report_date"),
                stage="waiting",
            )
            LOGGER.info("[ibkr-analytics] positions stage complete trades=%d", trade_count)
        except Exception as exc:  # noqa: BLE001
            current_error = str(exc)
            _update_run(job_id, positions_status="failed", stage="waiting", error_message=current_error)
            LOGGER.warning("[ibkr-analytics] positions stage failed reason=%s", current_error)

        if history_configured():
            _update_run(job_id, stage="history", history_status="running")
            try:
                history_root = _load_history_with_adaptive_pacing()
                nav_count, pnl_count, report_date = _insert_history(history_root)
                if nav_count == 0 and pnl_count == 0:
                    raise position_service.PositionServiceError(
                        "IBKR history query returned no ChangeInNAV or MTMPerformanceSummaryUnderlying rows; check the query sections and date period"
                    )
                _update_run(job_id, history_status="complete", history_report_date=report_date)
                LOGGER.info("[ibkr-analytics] history stage complete nav=%d pnl=%d", nav_count, pnl_count)
            except Exception as exc:  # noqa: BLE001
                current_error = f"{current_error}; " if current_error else ""
                current_error += str(exc)
                _update_run(job_id, history_status="failed", error_message=current_error)
                LOGGER.warning("[ibkr-analytics] history stage failed reason=%s", exc)
        else:
            _update_run(job_id, history_status="not_configured")

        with _DB_LOCK, _connection() as db:
            row = db.execute("SELECT positions_status, history_status FROM ibkr_refresh_runs WHERE job_id = ?", (job_id,)).fetchone()
        status = "complete" if row and row["positions_status"] == "complete" and row["history_status"] in {"complete", "not_configured"} else "partial"
        _update_run(job_id, status=status, stage="complete", finished_at=_now(), error_message=current_error)
    except Exception as exc:  # noqa: BLE001
        current_error = str(exc)
        LOGGER.exception("[ibkr-analytics] refresh worker crashed")
        try:
            _update_run(job_id, status="partial", stage="complete", finished_at=_now(), error_message=current_error)
        except Exception:  # noqa: BLE001
            LOGGER.exception("[ibkr-analytics] unable to persist failed refresh status")
    finally:
        with _JOB_LOCK:
            _ACTIVE_JOB = None


def start_refresh() -> dict[str, Any]:
    initialize()
    global _ACTIVE_JOB
    with _JOB_LOCK:
        if _ACTIVE_JOB:
            return refresh_status(_ACTIVE_JOB)
        job_id = uuid.uuid4().hex
        _ACTIVE_JOB = job_id
        with _DB_LOCK, _connection() as db:
            db.execute(
                "INSERT INTO ibkr_refresh_runs(job_id,status,stage,started_at) VALUES (?, 'queued', 'queued', ?)",
                (job_id, _now()),
            )
        threading.Thread(target=_run_worker, args=(job_id,), daemon=True, name="ibkr-refresh").start()
        return refresh_status(job_id)


def refresh_status(job_id: str | None = None) -> dict[str, Any]:
    initialize()
    with _DB_LOCK, _connection() as db:
        row = db.execute(
            "SELECT * FROM ibkr_refresh_runs WHERE job_id = ?" if job_id else "SELECT * FROM ibkr_refresh_runs ORDER BY started_at DESC LIMIT 1",
            (job_id,) if job_id else (),
        ).fetchone()
    if row is None:
        return {"job_id": None, "status": "idle", "stage": "idle", "positions_status": "unknown", "history_status": "unknown"}
    return dict(row)


def _cutoff(range_name: str) -> str | None:
    today = datetime.now(UTC).date()
    if range_name == "all":
        return None
    if range_name == "ytd":
        return date(today.year, 1, 1).isoformat()
    days = {"1m": 31, "3m": 93, "1y": 366, "2y": 732}.get(range_name)
    if days is None:
        raise ValueError("range must be 1m, 3m, ytd, 1y, 2y, or all")
    return (today - timedelta(days=days)).isoformat()


def _performance(nav_rows: list[sqlite3.Row], mixed_currency: bool) -> dict[str, Any]:
    unavailable = {
        "method": "unavailable",
        "coverage": "unavailable",
        "flow_adjusted_return": None,
        "max_drawdown": None,
        "observations": len(nav_rows),
    }
    if not nav_rows:
        return {**unavailable, "reason": "No IBKR NAV history is available for this range."}
    if mixed_currency:
        return {**unavailable, "reason": "Performance cannot be aggregated across multiple account base currencies."}
    if any(not row["flow_data_available"] for row in nav_rows):
        return {**unavailable, "reason": "IBKR history does not include deposits and withdrawals for every day in this range."}
    if any(float(row["starting_value"] or 0) <= 0 for row in nav_rows):
        return {**unavailable, "reason": "A positive starting NAV is required for every day in this range."}

    performance_index = 1.0
    peak = performance_index
    max_drawdown = 0.0
    for row in nav_rows:
        starting = float(row["starting_value"])
        ending = float(row["ending_value"])
        flow = float(row["deposits_withdrawals"] or 0)
        performance_index *= 1 + ((ending - starting - flow) / starting)
        peak = max(peak, performance_index)
        max_drawdown = min(max_drawdown, (performance_index - peak) / peak)
    return {
        "method": "broker_flow_adjusted",
        "coverage": "complete",
        "flow_adjusted_return": performance_index - 1,
        "max_drawdown": max_drawdown,
        "observations": len(nav_rows),
        "reason": None,
    }


def analytics(range_name: str = "3m") -> dict[str, Any]:
    initialize()
    snapshot = position_service.get_current()
    cutoff = _cutoff(range_name)
    with _DB_LOCK, _connection() as db:
        nav_where = "WHERE report_date >= ?" if cutoff else ""
        nav_params = (cutoff,) if cutoff else ()
        nav_rows = db.execute(
            f"""SELECT report_date, currency, SUM(starting_value) starting_value,
            SUM(ending_value) ending_value, SUM(mtm) mtm,
            SUM(deposits_withdrawals) deposits_withdrawals,
            MIN(flow_data_available) flow_data_available
            FROM ibkr_daily_nav {nav_where}
            GROUP BY report_date, currency ORDER BY report_date""",
            nav_params,
        ).fetchall()
        latest_date = max((row["report_date"] for row in nav_rows), default=None)
        latest_rows = [row for row in nav_rows if row["report_date"] == latest_date]
        latest = latest_rows[0] if len(latest_rows) == 1 else None
        contributor_where = "WHERE is_total = 0" + (" AND report_date >= ?" if cutoff else "")
        contributor_params = (cutoff,) if cutoff else ()
        latest_date_row = db.execute(f"SELECT MAX(report_date) AS report_date FROM ibkr_daily_pnl {contributor_where}", contributor_params).fetchone()
        latest_contributor_date = latest_date_row["report_date"] if latest_date_row else None
        contributors = db.execute(
            "SELECT * FROM ibkr_daily_pnl WHERE is_total = 0 AND report_date = ? ORDER BY ABS(total) DESC LIMIT 12",
            (latest_contributor_date,),
        ).fetchall() if latest_contributor_date else []
        reconciliations = db.execute(
            """SELECT item.* FROM ibkr_reconciliations item
            JOIN (SELECT account_ref, MAX(observed_at) observed_at FROM ibkr_reconciliations GROUP BY account_ref) latest
              ON latest.account_ref = item.account_ref AND latest.observed_at = item.observed_at
            ORDER BY item.account_label"""
        ).fetchall()
        transactions = db.execute(
            "SELECT * FROM ibkr_trades ORDER BY occurred_at DESC, trade_key DESC LIMIT 50"
        ).fetchall()
    daily = []
    previous = None
    for row in nav_rows:
        ending = float(row["ending_value"] or 0)
        pnl = float(row["mtm"] or 0)
        daily.append({
            "calendar_date": row["report_date"],
            "ending_nav": ending,
            "pnl_amount": pnl,
            "pnl_percent": pnl / float(row["starting_value"]) if row["starting_value"] else None,
            "comparison_date": previous,
            "reporting_currency": row["currency"],
        })
        previous = row["report_date"]
    valued = [row for row in snapshot.get("positions", []) if row.get("reporting_market_value") is not None]
    reporting_currencies = {row.get("reporting_currency") for row in valued if row.get("reporting_currency")}
    history_currencies = {row["currency"] for row in nav_rows}
    mixed_currency = len(reporting_currencies | history_currencies) > 1
    performance = _performance(nav_rows, mixed_currency)
    warnings: list[str] = []
    if mixed_currency:
        warnings.append("Multiple account base currencies; aggregate NAV, exposure, allocation, and contributors are unavailable.")
    warning_reconciliations = [row for row in reconciliations if row["status"] == "warning"]
    if warning_reconciliations:
        warnings.append(f"IBKR reconciliation found {len(warning_reconciliations)} account mismatch(es); positions remain broker-authoritative.")
    gross = None if mixed_currency else sum(abs(float(row["reporting_market_value"])) for row in valued)
    allocation = [
        {
            "symbol": row["symbol"],
            "name": row["name"],
            "asset_class": row["asset_class"],
            "side": "Short" if float(row["reporting_market_value"]) < 0 else "Long",
            "market_value": row["reporting_market_value"],
            "weight": abs(float(row["reporting_market_value"])) / gross if gross else 0,
            "currency": row.get("reporting_currency") or row.get("currency"),
        }
        for row in valued
        if not mixed_currency
    ]
    return {
        "range": range_name,
        "source": "ibkr-flex",
        "current": snapshot,
        "allocation": allocation,
        "gross_exposure": gross,
        "latest_nav": None if mixed_currency else (latest["ending_value"] if latest else snapshot.get("summary", {}).get("nav")),
        "reporting_currency": None if mixed_currency else (latest["currency"] if latest else snapshot.get("summary", {}).get("reporting_currency")),
        "daily_pnl": daily,
        "latest_contributors": [] if mixed_currency else [dict(row) for row in contributors],
        "latest_report_date": latest_contributor_date,
        "performance": performance,
        "reconciliations": [dict(row) for row in reconciliations],
        "recent_transactions": [dict(row) for row in transactions],
        "warnings": warnings,
    }


def list_instruments(status: str = "all") -> list[dict[str, Any]]:
    initialize()
    current = position_service.get_current().get("positions", [])
    by_key: dict[str, dict[str, Any]] = {}
    for row in current:
        if row.get("asset_class") == "CASH":
            continue
        key = instrument_key(row["account_ref"], row["symbol"], row.get("currency", "USD"), row.get("venue"))
        by_key[key] = {
            "instrument_key": key,
            "account_ref": row["account_ref"],
            "account_label": row["account_label"],
            "symbol": row["symbol"],
            "name": row["name"],
            "asset_class": row["asset_class"],
            "currency": row.get("currency"),
            "venue": row.get("venue"),
            "status": "open" if float(row.get("quantity") or 0) != 0 else "closed",
            "quantity": row.get("quantity"),
            "average_cost": row.get("average_cost"),
        }
    with _DB_LOCK, _connection() as db:
        for item in by_key.values():
            _upsert_instrument(db, {
                "instrument_key": item["instrument_key"], "symbol": item["symbol"], "name": item["name"],
                "asset_class": item["asset_class"], "currency": item["currency"], "venue": item.get("venue"),
                "conid": None, "isin": None, "provider_symbol": None, "price_multiplier": 1.0,
                "mapping_source": "auto", "updated_at": _now(),
            })
        rows = db.execute("SELECT DISTINCT instrument_key, account_ref, account_label, symbol, name, asset_class, currency, venue FROM ibkr_trades").fetchall()
        trade_costs = db.execute(
            """SELECT instrument_key,
                 SUM(CASE WHEN side = 'BUY' THEN quantity * COALESCE(price, 0) ELSE 0 END) AS buy_value,
                 SUM(CASE WHEN side = 'BUY' THEN quantity ELSE 0 END) AS buy_quantity
               FROM ibkr_trades GROUP BY instrument_key"""
        ).fetchall()
        mappings = db.execute(
            "SELECT instrument_key, provider_symbol, price_multiplier, mapping_source FROM ibkr_instruments"
        ).fetchall()
    weighted_cost = {
        row["instrument_key"]: (float(row["buy_value"]) / float(row["buy_quantity"]))
        for row in trade_costs
        if row["buy_quantity"] and float(row["buy_quantity"]) > 0
    }
    for row in rows:
        by_key.setdefault(row["instrument_key"], {**dict(row), "status": "closed", "quantity": 0, "average_cost": weighted_cost.get(row["instrument_key"])})
    for key, item in by_key.items():
        if item.get("average_cost") is None and key in weighted_cost:
            item["average_cost"] = weighted_cost[key]
    mapping_by_key = {row["instrument_key"]: row for row in mappings}
    for key, item in by_key.items():
        stored = mapping_by_key.get(key)
        stored_symbol = stored["provider_symbol"] if stored else None
        item["provider_symbol"] = stored_symbol or _auto_symbol(item["symbol"], item.get("venue"))
        item["price_multiplier"] = float(stored["price_multiplier"] if stored else 1.0)
        item["mapping_source"] = stored["mapping_source"] if stored_symbol else "auto"
    result = list(by_key.values())
    if status in {"open", "closed"}:
        result = [row for row in result if row["status"] == status]
    return sorted(result, key=lambda row: (row["status"] != "open", row["symbol"]))


def save_mapping(instrument_key_value: str, provider_symbol: str, price_multiplier: float = 1.0) -> dict[str, Any]:
    initialize()
    if not provider_symbol.strip():
        raise ValueError("provider_symbol is required")
    if price_multiplier <= 0:
        raise ValueError("price_multiplier must be positive")
    with _DB_LOCK, _connection() as db:
        db.execute(
            "UPDATE ibkr_instruments SET provider_symbol = ?, price_multiplier = ?, mapping_source = 'manual', updated_at = ? WHERE instrument_key = ?",
            (provider_symbol.strip().upper(), price_multiplier, _now(), instrument_key_value),
        )
        row = db.execute("SELECT * FROM ibkr_instruments WHERE instrument_key = ?", (instrument_key_value,)).fetchone()
    if row is None:
        raise KeyError("instrument not found")
    return dict(row)


def _auto_symbol(symbol: str, venue: str | None) -> str | None:
    if not symbol or symbol.startswith("CASH."):
        return None
    value = symbol.upper()
    if "." in value:
        return value
    venue_text = (venue or "").upper()
    suffixes = (("LSE", ".L"), ("XLON", ".L"), ("LSEETF", ".L"), ("XAMS", ".AS"), ("AEB", ".AS"), ("XETRA", ".DE"), ("IBIS", ".DE"))
    for marker, suffix in suffixes:
        if marker in venue_text:
            return f"{value}{suffix}"
    if any(marker in venue_text for marker in ("NASDAQ", "NYSE", "ARCA", "CBOE", "US")) or not venue_text:
        return value
    return None


def chart(instrument_key_value: str, range_name: str = "3m") -> dict[str, Any]:
    initialize()
    _cutoff(range_name)
    instruments = {row["instrument_key"]: row for row in list_instruments("all")}
    instrument = instruments.get(instrument_key_value)
    if instrument is None:
        raise KeyError("instrument not found")
    with _DB_LOCK, _connection() as db:
        mapping = db.execute("SELECT * FROM ibkr_instruments WHERE instrument_key = ?", (instrument_key_value,)).fetchone()
        trades = db.execute("SELECT * FROM ibkr_trades WHERE instrument_key = ? ORDER BY occurred_at", (instrument_key_value,)).fetchall()
    provider_symbol = mapping["provider_symbol"] if mapping and mapping["provider_symbol"] else _auto_symbol(instrument["symbol"], instrument.get("venue"))
    price_multiplier = float(mapping["price_multiplier"] if mapping else 1.0)
    warnings: list[str] = []
    if range_name == "all":
        warnings.append("Market data provider is capped at the available 2-year daily history.")
    bars: list[dict[str, Any]] = []
    provider = None
    if provider_symbol:
        try:
            provider_range = {"1m": "1mo", "3m": "3mo", "ytd": "1y", "1y": "1y", "2y": "2y", "all": "2y"}[range_name]
            series = market_data.get_bars(provider_symbol, provider_range, "1d")
            provider = series.source
            closes = [bar.close for bar in series.bars]
            for index, bar in enumerate(series.bars):
                if cutoff := _cutoff(range_name):
                    if bar.date < cutoff:
                        continue
                valid = [value for value in closes[max(0, index - 19): index + 1] if value is not None]
                scale = price_multiplier
                bars.append({"date": bar.date, "open": bar.open * scale if bar.open is not None else None, "high": bar.high * scale if bar.high is not None else None, "low": bar.low * scale if bar.low is not None else None, "close": bar.close * scale if bar.close is not None else None, "adjusted_close": bar.adjusted_close * scale if bar.adjusted_close is not None else None, "volume": bar.volume, "sma20": (sum(valid) / len(valid)) * scale if valid else None, "currency": bar.currency})
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"Chart data unavailable for {provider_symbol}: {exc}")
    else:
        warnings.append("No confident market-data mapping; set a manual provider symbol.")
    if not trades:
        warnings.append("No IBKR executions are available for this instrument yet.")
    return {
        "instrument": instrument,
        "provider_symbol": provider_symbol,
        "price_multiplier": price_multiplier,
        "mapping_source": mapping["mapping_source"] if mapping else "auto",
        "provider": provider,
        "bars": bars,
        "executions": [dict(row) for row in trades],
        "warnings": warnings,
    }
