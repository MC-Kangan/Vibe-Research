"""Portfolio-owned candidate universe for cross-asset research."""

from __future__ import annotations

from typing import Any, Callable

import crypto_portfolio
import ibkr_analytics
import portfolio as manual_stock_portfolio
from instrument_overview import resolve_research_identity


def _load_source(
    name: str,
    loader: Callable[[], list[dict[str, Any]]],
    gaps: list[dict[str, str]],
) -> list[dict[str, Any]]:
    try:
        return loader()
    except Exception as exc:  # noqa: BLE001 — independent sources degrade explicitly
        gaps.append({"source": name, "detail": str(exc) or "Source unavailable"})
        return []


def candidate_universe() -> dict[str, Any]:
    """Return normalized non-cash holdings and explicit source-coverage gaps."""
    gaps: list[dict[str, str]] = []
    candidates: dict[str, dict[str, str]] = {}
    ibkr_rows = _load_source(
        "IBKR",
        lambda: ibkr_analytics.list_instruments("open"),
        gaps,
    )
    manual_stock_rows = _load_source(
        "Manual stocks",
        lambda: manual_stock_portfolio.get_portfolio().get("holdings", []),
        gaps,
    )
    coinbase_rows = _load_source(
        "Coinbase",
        lambda: crypto_portfolio.get_coinbase_snapshot().get("positions", []),
        gaps,
    )
    manual_crypto_rows = _load_source(
        "Manual crypto",
        crypto_portfolio.get_manual,
        gaps,
    )

    for item in ibkr_rows:
        if str(item.get("asset_class") or "").upper() not in {"STK", "ETF"}:
            continue
        provider_symbol = str(item.get("provider_symbol") or "").strip()
        if not provider_symbol:
            continue
        try:
            symbol, market = resolve_research_identity(provider_symbol, "equity")
        except Exception:  # noqa: BLE001 — malformed rows do not hide other candidates
            continue
        key = f"{market}:{symbol}"
        candidates[key] = {
            "key": key,
            "symbol": symbol,
            "market": market,
            "asset_type": "equity",
            "label": str(item.get("name") or item.get("symbol") or symbol),
            "source": "IBKR",
        }

    for item in manual_stock_rows:
        if not item.get("include_in_total"):
            continue
        try:
            symbol, market = resolve_research_identity(
                str(item.get("code") or ""), "equity"
            )
        except Exception:  # noqa: BLE001
            continue
        key = f"{market}:{symbol}"
        candidates.setdefault(
            key,
            {
                "key": key,
                "symbol": symbol,
                "market": market,
                "asset_type": "equity",
                "label": str(item.get("name") or symbol),
                "source": "Manual",
            },
        )

    for item in [*coinbase_rows, *manual_crypto_rows]:
        try:
            quantity = float(item.get("quantity") or 0)
        except (TypeError, ValueError):
            continue
        if item.get("asset_kind") == "fiat" or quantity <= 0:
            continue
        try:
            symbol, market = resolve_research_identity(
                str(item.get("asset") or ""), "crypto"
            )
        except Exception:  # noqa: BLE001
            continue
        key = f"{market}:{symbol}"
        candidates.setdefault(
            key,
            {
                "key": key,
                "symbol": symbol,
                "market": market,
                "asset_type": "crypto",
                "label": str(item.get("asset") or symbol),
                "source": "Coinbase / wallet",
            },
        )

    items = sorted(
        candidates.values(), key=lambda item: (item["asset_type"], item["symbol"])
    )
    return {
        "status": "available" if not gaps else "partial" if items else "unavailable",
        "items": items,
        "gaps": gaps,
    }
