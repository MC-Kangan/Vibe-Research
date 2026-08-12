"""Backend-owned instrument routing and core dashboard data assembly."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

import astock
import gstock
import market_data


def _a_share_reports(symbol: str) -> list[dict[str, Any]]:
    rows = astock.eastmoney_reports(symbol, max_pages=2)
    for row in rows:
        row["pdfUrl"] = astock.pdf_url(row.get("infoCode", "")) if row.get("infoCode") else None
    return rows


def _run(tasks: dict[str, Callable[[], Any]]) -> tuple[dict[str, Any], list[dict[str, str]]]:
    data: dict[str, Any] = {}
    gaps: list[dict[str, str]] = []
    with ThreadPoolExecutor(max_workers=min(6, len(tasks))) as executor:
        futures = {executor.submit(loader): section for section, loader in tasks.items()}
        for future in as_completed(futures):
            section = futures[future]
            try:
                value = future.result()
                if value in (None, {}, []):
                    gaps.append({"section": section, "detail": "No data returned"})
                else:
                    data[section] = value
            except Exception as exc:  # noqa: BLE001 — partial dashboard data remains useful
                gaps.append({"section": section, "detail": str(exc)})
    return data, gaps


def _response(
    *,
    symbol: str,
    route: str,
    data: dict[str, Any],
    gaps: list[dict[str, str]],
    primary: tuple[str, ...],
    capabilities: list[str],
) -> dict[str, Any]:
    available = any(section in data for section in primary)
    complete = all(section in data for section in primary) and not gaps
    return {
        "symbol": symbol,
        "route": route,
        "status": "available" if complete else "partial" if available else "unavailable",
        "capabilities": capabilities,
        "data": data,
        "gaps": gaps,
    }


def get_overview(symbol: str, asset_type: str = "equity") -> dict[str, Any]:
    value = (symbol or "").strip().upper()
    if asset_type == "crypto":
        canonical = market_data.resolve_crypto_symbol(value)
        data, gaps = _run({
            "market_snapshot": lambda: market_data.get_snapshot(canonical, "crypto"),
            "market_history": lambda: market_data.get_bars(canonical, "1y", "1d", "crypto"),
        })
        return _response(
            symbol=canonical.removesuffix("-USD"), route="crypto", data=data, gaps=gaps,
            primary=("market_snapshot", "market_history"), capabilities=["quote", "history", "skills"],
        )
    if asset_type != "equity":
        raise market_data.UnsupportedSymbolError("asset_type must be equity or crypto")

    if value.isdigit() and len(value) == 6:
        data, gaps = _run({
            "valuation": lambda: astock.full_valuation(value),
            "reports": lambda: _a_share_reports(value),
            "percentile": lambda: astock.valuation_percentile(value),
            "financials": lambda: astock.financials(value),
            "announcements": lambda: astock.announcements(value),
            "a_share_history": lambda: astock.kline(value, category=4, offset=240),
        })
        return _response(
            symbol=value, route="a-share", data=data, gaps=gaps,
            primary=("valuation", "a_share_history"),
            capabilities=[
                "quote", "history", "valuation", "financials", "reports", "announcements", "news",
                "margin", "block-trade", "holders", "dividend", "fund-flow", "dragon-tiger",
                "lockup", "blocks", "hot-concepts", "investor-qa", "skills",
            ],
        )

    try:
        resolved = market_data.resolve_symbol(value)
    except market_data.UnsupportedSymbolError:
        data, gaps = _run({
            "global_stock": lambda: gstock.us_hk_stock(value),
            **({"cashflow": lambda: gstock.hk_cashflow(value)} if value.isdigit() and len(value) == 5 else {}),
        })
        return _response(
            symbol=value, route="global", data=data, gaps=gaps,
            primary=("global_stock",),
            capabilities=["quote", "fundamentals", "cashflow", "skills"],
        )

    canonical = resolved.provider_symbol
    tasks: dict[str, Callable[[], Any]] = {
        "market_snapshot": lambda: market_data.get_snapshot(canonical),
        "market_history": lambda: market_data.get_bars(canonical, "1y", "1d"),
    }
    capabilities = ["quote", "history", "news", "earnings", "skills"]
    if resolved.exchange.country == "US":
        tasks["global_stock"] = lambda: gstock.us_hk_stock(canonical)
        capabilities.extend(["fundamentals", "filings", "sec-facts"])
    data, gaps = _run(tasks)
    return _response(
        symbol=canonical, route="market", data=data, gaps=gaps,
        primary=("market_snapshot", "market_history"), capabilities=capabilities,
    )
