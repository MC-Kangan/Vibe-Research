"""US/European market overview built from Yahoo sector proxies and user watchlists."""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import astock

from .benchmarks import get_benchmarks
from .models import MarketDataError
from .service import get_snapshot, resolve_symbol

_SECTOR_PROXIES = {
    "US": (
        {"key": "technology", "name": "Technology", "symbol": "XLK"},
        {"key": "financials", "name": "Financials", "symbol": "XLF"},
        {"key": "industrials", "name": "Industrials", "symbol": "XLI"},
        {"key": "energy", "name": "Energy", "symbol": "XLE"},
        {"key": "healthcare", "name": "Health Care", "symbol": "XLV"},
        {"key": "communication", "name": "Communication Services", "symbol": "XLC"},
    ),
    "Europe": (
        {"key": "banks", "name": "Banks", "symbol": "EXV1.DE"},
        {"key": "telecom", "name": "Telecommunications", "symbol": "EXV2.DE"},
        {"key": "oil-gas", "name": "Oil & Gas", "symbol": "EXH1.DE"},
        {"key": "healthcare", "name": "Health Care", "symbol": "EXV4.DE"},
        {"key": "autos", "name": "Automobiles & Parts", "symbol": "EXV5.DE"},
        {"key": "resources", "name": "Basic Resources", "symbol": "EXV6.DE"},
    ),
}
_SECTOR_CACHE_TTL = 300.0
_SECTOR_CACHE: tuple[float, tuple[dict[str, list[dict]], list[dict]]] | None = None
_SECTOR_CACHE_LOCK = threading.Lock()


def _market_for(symbol: str) -> str:
    if symbol.isdigit() and len(symbol) == 6:
        return "CN"
    return "US" if resolve_symbol(symbol).exchange.country == "US" else "EU"


def _watchlist_quote(symbol: str) -> tuple[dict | None, dict | None]:
    try:
        market = _market_for(symbol)
        if market == "CN":
            quote = (astock.tencent_quote([symbol]) or {}).get(symbol) or {}
            if not quote:
                return None, {"symbol": symbol, "message": "A股行情未返回数据"}
            return {
                "symbol": symbol, "name": quote.get("name") or symbol, "market": market,
                "price": quote.get("price"), "change_pct": quote.get("change_pct"),
                "currency": "CNY", "source": "tencent",
            }, None
        snapshot = get_snapshot(symbol)
        return {
            "symbol": symbol, "name": snapshot.instrument.name or symbol, "market": market,
            "price": snapshot.quote.price, "change_pct": snapshot.quote.change_pct,
            "currency": snapshot.quote.currency, "source": snapshot.quote.source,
        }, None
    except MarketDataError as exc:
        return None, {"symbol": symbol, "message": str(exc)}
    except Exception as exc:  # noqa: BLE001 — one watchlist quote must not break the overview
        return None, {"symbol": symbol, "message": str(exc)}


def _sector_snapshot(region: str, item: dict) -> tuple[dict, dict | None]:
    try:
        snapshot = get_snapshot(item["symbol"])
        quote = snapshot.quote
        return {
            **item, "region": region, "price": quote.price, "change_pct": quote.change_pct,
            "currency": quote.currency, "source": quote.source,
        }, None
    except MarketDataError as exc:
        return {**item, "region": region, "price": None, "change_pct": None,
                "currency": None, "source": "yahoo"}, {"symbol": item["symbol"], "message": str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {**item, "region": region, "price": None, "change_pct": None,
                "currency": None, "source": "yahoo"}, {"symbol": item["symbol"], "message": str(exc)}


def _build_sectors() -> tuple[dict[str, list[dict]], list[dict]]:
    results: dict[str, list[dict]] = {"US": [], "Europe": []}
    gaps: list[dict] = []
    jobs = [(region, item) for region, items in _SECTOR_PROXIES.items() for item in items]
    with ThreadPoolExecutor(max_workers=len(jobs)) as executor:
        futures = {executor.submit(_sector_snapshot, region, item): (region, item) for region, item in jobs}
        for future in as_completed(futures):
            region, _item = futures[future]
            value, gap = future.result()
            results[region].append(value)
            if gap:
                gaps.append(gap)
    for region, items in results.items():
        order = {item["key"]: index for index, item in enumerate(_SECTOR_PROXIES[region])}
        items.sort(key=lambda item: order[item["key"]])
    return results, gaps


def _sectors() -> tuple[dict[str, list[dict]], list[dict]]:
    global _SECTOR_CACHE
    now = time.monotonic()
    with _SECTOR_CACHE_LOCK:
        if _SECTOR_CACHE and now - _SECTOR_CACHE[0] < _SECTOR_CACHE_TTL:
            return _SECTOR_CACHE[1]
        value = _build_sectors()
        _SECTOR_CACHE = (now, value)
        return value


def get_market_overview(symbols: list[str] | None = None) -> dict:
    normalized = list(dict.fromkeys(str(symbol).strip().upper() for symbol in (symbols or []) if str(symbol).strip()))[:30]
    watchlist: list[dict] = []
    gaps: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(8, max(1, len(normalized)))) as executor:
        futures = {executor.submit(_watchlist_quote, symbol): symbol for symbol in normalized}
        for future in as_completed(futures):
            quote, gap = future.result()
            if quote:
                watchlist.append(quote)
            if gap:
                gaps.append(gap)
    watchlist.sort(key=lambda item: normalized.index(item["symbol"]))
    valid = [item for item in watchlist if isinstance(item.get("change_pct"), (int, float))]
    up = [item for item in valid if item["change_pct"] > 0]
    down = [item for item in valid if item["change_pct"] < 0]
    flat = [item for item in valid if item["change_pct"] == 0]
    movers = sorted(valid, key=lambda item: abs(item["change_pct"]), reverse=True)[:8]
    sectors, sector_gaps = _sectors()
    return {
        "benchmarks": get_benchmarks(),
        "watchlist": {
            "symbols": normalized, "quotes": watchlist,
            "breadth": {"total": len(watchlist), "up": len(up), "down": len(down), "flat": len(flat), "unavailable": len(normalized) - len(watchlist)},
            "movers": movers,
        },
        "sectors": sectors,
        "gaps": gaps + [{**gap, "scope": "sector"} for gap in sector_gaps],
        "fetched_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "notes": ["Breadth and movers are calculated from the user's watchlist.", "Sector rows are Yahoo ETF proxies, not constituent-level sector breadth."],
    }
