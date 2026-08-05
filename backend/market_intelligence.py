"""Normalized watchlist intelligence across A-shares, US, and Europe."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import astock
import market_data

_KINDS = {"filings", "news", "earnings"}
_MAX_SYMBOLS = 30
_MAX_ITEMS = 10


def _market(symbol: str) -> str:
    if symbol.isdigit() and len(symbol) == 6:
        return "CN"
    return "US" if market_data.resolve_symbol(symbol).exchange.country == "US" else "EU"


def _item(symbol: str, market: str, kind: str, title: str, published_at=None,
          source=None, url=None, summary=None, meta=None) -> dict:
    return {
        "symbol": symbol, "market": market, "kind": kind,
        "title": title or "", "summary": summary, "published_at": str(published_at or ""),
        "source": source or "", "url": url, "meta": meta or {},
    }


def _fetch_one(symbol: str, kind: str, limit: int) -> tuple[list[dict], dict | None]:
    try:
        market = _market(symbol)
    except market_data.MarketDataError as exc:
        return [], {"symbol": symbol, "kind": kind, "reason": "unsupported", "message": str(exc)}

    try:
        if kind == "filings":
            if market == "CN":
                rows = astock.announcements(symbol) or []
                items = [_item(symbol, market, kind, row.get("title", ""), row.get("date"),
                               "Eastmoney", row.get("url"), meta={"type": row.get("type")})
                         for row in rows[:limit] if isinstance(row, dict)]
            elif market == "US":
                data = market_data.get_filings(symbol, limit)
                items = [_item(symbol, market, kind, row.get("primaryDocDescription") or row.get("primary_document"),
                               row.get("filingDate"), "SEC EDGAR", row.get("url"),
                               meta={"form": row.get("form"), "report_date": row.get("reportDate")})
                         for row in data.get("items", [])[:limit]]
            else:
                return [], {"symbol": symbol, "kind": kind, "reason": "unsupported",
                            "message": "欧洲统一监管文件源尚未接入"}
        elif kind == "news":
            if market == "CN":
                rows = astock.stock_news(symbol, limit=limit) or []
                items = [_item(symbol, market, kind, row.get("新闻标题", ""), row.get("发布时间"),
                               row.get("文章来源"), row.get("新闻链接"))
                         for row in rows[:limit] if isinstance(row, dict)]
            else:
                data = market_data.get_company_news(symbol, days=30, limit=limit)
                items = [_item(symbol, market, kind, row.get("headline"), row.get("published_at"),
                               row.get("source"), row.get("url"), row.get("summary"),
                               meta={"category": row.get("category")})
                         for row in data.get("items", [])[:limit]]
        elif kind == "earnings":
            if market == "CN":
                return [], {"symbol": symbol, "kind": kind, "reason": "unsupported",
                            "message": "A股 earnings 实际值与一致预期尚未统一接入"}
            data = market_data.get_earnings(symbol, limit)
            items = [_item(symbol, market, kind, row.get("period") or "Earnings",
                           row.get("period"), "Finnhub", meta={
                               "quarter": row.get("quarter"), "year": row.get("year"),
                               "actual": row.get("actual"), "estimate": row.get("estimate"),
                               "surprise": row.get("surprise"), "surprise_pct": row.get("surprise_pct"),
                           }) for row in data.get("items", [])[:limit]]
        else:
            return [], {"symbol": symbol, "kind": kind, "reason": "unsupported", "message": "未知信息类型"}
    except market_data.ProviderConfigurationError as exc:
        return [], {"symbol": symbol, "kind": kind, "reason": "not_configured", "message": str(exc)}
    except market_data.MarketDataError as exc:
        return [], {"symbol": symbol, "kind": kind, "reason": "provider_error", "message": str(exc)}
    except Exception as exc:  # noqa: BLE001 — feed failures stay local to one symbol/kind
        return [], {"symbol": symbol, "kind": kind, "reason": "provider_error", "message": str(exc)}

    if not items:
        return [], {"symbol": symbol, "kind": kind, "reason": "empty", "message": "近期没有可显示记录"}
    return items, None


def collect(symbols: list[str], kinds: list[str], limit_per_symbol: int = 5) -> dict:
    normalized = list(dict.fromkeys(str(symbol).strip().upper() for symbol in symbols if str(symbol).strip()))
    normalized = normalized[:_MAX_SYMBOLS]
    requested_kinds = [kind for kind in dict.fromkeys(kinds) if kind in _KINDS]
    limit = max(1, min(int(limit_per_symbol or 5), _MAX_ITEMS))
    jobs = [(symbol, kind) for symbol in normalized for kind in requested_kinds]
    items: list[dict] = []
    gaps: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(8, max(1, len(jobs)))) as executor:
        futures = {executor.submit(_fetch_one, symbol, kind, limit): (symbol, kind) for symbol, kind in jobs}
        for future in as_completed(futures):
            rows, gap = future.result()
            items.extend(rows)
            if gap:
                gaps.append(gap)
    items.sort(key=lambda row: str(row.get("published_at") or ""), reverse=True)
    return {
        "symbols": normalized,
        "kinds": requested_kinds,
        "items": items,
        "gaps": gaps,
        "fetched_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
