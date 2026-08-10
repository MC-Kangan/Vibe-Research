"""Crypto valuation and combined cross-asset portfolio aggregation."""

from __future__ import annotations

from typing import Any

import coinbase_positions
import fx_rates
import manual_crypto_positions
import market_data
import portfolio as stock_portfolio
import position_service
from crypto_portfolio_errors import CryptoPortfolioError

_EQUITY_ASSET_CLASSES = {"STK", "ETF"}

# Stable public facade retained for the additive API routes.
coinbase_configured = coinbase_positions.configured
get_coinbase_snapshot = coinbase_positions.get_snapshot
refresh_coinbase = coinbase_positions.refresh
get_manual = manual_crypto_positions.get_all
upsert_manual = manual_crypto_positions.upsert
remove_manual = manual_crypto_positions.remove
parse_csv = manual_crypto_positions.parse_csv
commit_csv = manual_crypto_positions.commit_csv


def get_crypto_portfolio(reporting_currency: str = "USD") -> dict[str, Any]:
    reporting_currency = reporting_currency.upper()
    coinbase_snapshot = get_coinbase_snapshot()
    manual_rows = get_manual()
    sources = [*coinbase_snapshot.get("positions", []), *manual_rows]
    rows: list[dict[str, Any]] = []
    gaps: list[str] = []
    for item in sources:
        asset = item["asset"]
        quantity = float(item.get("quantity") or 0)
        if item.get("asset_kind") == "fiat":
            price, quote_currency = 1.0, asset
        else:
            try:
                snapshot = market_data.get_snapshot(asset, "crypto")
                price, quote_currency = snapshot.quote.price, snapshot.quote.currency
            except market_data.MarketDataError as exc:
                price, quote_currency = None, "USD"
                gaps.append(f"{asset}: {exc}")
        rate = fx_rates.get_rate(quote_currency, reporting_currency) if price is not None else None
        market_value = quantity * price if price is not None else None
        reporting_value = market_value * rate if market_value is not None and rate is not None else None
        cost_value = None
        pnl = None
        if item.get("unit_cost") is not None:
            cost_rate = fx_rates.get_rate(str(item.get("cost_currency") or "USD"), reporting_currency)
            cost_value = quantity * float(item["unit_cost"]) * cost_rate if cost_rate is not None else None
            pnl = reporting_value - cost_value if reporting_value is not None and cost_value is not None else None
        if price is not None and rate is None:
            gaps.append(f"{quote_currency}/{reporting_currency}: FX rate unavailable")
        rows.append({
            **item, "price": price, "price_currency": quote_currency, "market_value": market_value,
            "reporting_market_value": reporting_value, "reporting_currency": reporting_currency,
            "cost_value": cost_value, "pnl": pnl,
        })

    crypto_rows = [row for row in rows if row.get("asset_kind") != "fiat"]
    fiat_rows = [row for row in rows if row.get("asset_kind") == "fiat"]
    total = sum(row["reporting_market_value"] for row in crypto_rows if row.get("reporting_market_value") is not None)
    cash_like = sum(row["reporting_market_value"] for row in crypto_rows if row.get("cash_like") and row.get("reporting_market_value") is not None)
    fiat_total = sum(row["reporting_market_value"] for row in fiat_rows if row.get("reporting_market_value") is not None)
    grouped: dict[str, dict[str, Any]] = {}
    for row in crypto_rows:
        bucket = grouped.setdefault(row["asset"], {
            "asset": row["asset"], "quantity": 0.0, "reporting_market_value": None,
            "reporting_currency": reporting_currency, "cash_like": bool(row.get("cash_like")), "sources": [],
        })
        bucket["quantity"] += row["quantity"]
        if row.get("reporting_market_value") is not None:
            bucket["reporting_market_value"] = (bucket["reporting_market_value"] or 0.0) + row["reporting_market_value"]
        bucket["sources"].append({
            "source": row.get("source"), "wallet_label": row.get("wallet_label"), "quantity": row.get("quantity"),
        })
    assets = sorted(
        grouped.values(),
        key=lambda row: (row["reporting_market_value"] is not None, row["reporting_market_value"] or 0.0),
        reverse=True,
    )
    return {
        "reporting_currency": reporting_currency, "positions": crypto_rows, "assets": assets,
        "fiat_positions": fiat_rows, "total": total, "cash_like_total": cash_like,
        "fiat_total": fiat_total, "gaps": list(dict.fromkeys(gaps)),
        "coinbase": coinbase_snapshot, "manual": manual_rows,
    }


def combined_summary(reporting_currency: str | None = None) -> dict[str, Any]:
    ibkr = position_service.get_current()
    inferred = ibkr.get("summary", {}).get("reporting_currency")
    currency = (reporting_currency or inferred or "USD").upper()
    crypto = get_crypto_portfolio(currency)
    stock_total = cash_total = 0.0
    gaps = list(crypto["gaps"])
    for row in ibkr.get("positions", []):
        asset_class = str(row.get("asset_class") or "").upper()
        value = row.get("reporting_market_value")
        row_currency = row.get("reporting_currency") or row.get("currency")
        rate = fx_rates.get_rate(str(row_currency), currency) if value is not None else None
        if value is None or rate is None:
            gaps.append(f"IBKR {row.get('symbol')}: reporting value unavailable")
            continue
        if asset_class == "CASH":
            cash_total += value * rate
        elif asset_class in _EQUITY_ASSET_CLASSES:
            stock_total += value * rate
        else:
            gaps.append(f"IBKR {row.get('symbol')}: asset class {asset_class or 'unknown'} excluded from stock total")
    manual = stock_portfolio.get_portfolio()
    for row in manual.get("holdings", []):
        if not row.get("include_in_total") or row.get("market_value") is None:
            continue
        rate = fx_rates.get_rate(row.get("currency") or "USD", currency)
        if rate is None:
            gaps.append(f"Manual stock {row.get('code')}: FX rate unavailable")
        else:
            stock_total += row["market_value"] * rate
    cash_total += crypto["fiat_total"]
    grand = stock_total + crypto["total"] + cash_total
    return {
        "reporting_currency": currency,
        "stock": stock_total, "crypto": crypto["total"], "cash": cash_total, "total": grand,
        "cash_like_crypto": crypto["cash_like_total"],
        "weights": {
            key: (value / grand if grand else 0.0)
            for key, value in {"stock": stock_total, "crypto": crypto["total"], "cash": cash_total}.items()
        },
        "gaps": list(dict.fromkeys(gaps)),
    }
