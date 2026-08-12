"""持仓数据层 —— 用户自己录入的持仓 + 实时行情叠加浮动盈亏。

合规：持仓是用户主动录入的自己的标的（存本地 SQLite，
不上传、不进仓库），不预置任何标的、不含 _SEED 兜底、不做推荐。
盈亏红涨绿跌（A股口径）。行情在读取或手动刷新时获取。

存储位置：默认用户目录 ~/.vibe-research/（可用 VR_DATA_DIR 覆盖）——
放仓库外，重新下载/覆盖项目文件夹不会丢数据（issue #12）。
现有 portfolio.json 会在首次读取时一次性导入共享 SQLite 数据库。
"""

from __future__ import annotations

import os
import threading
from datetime import datetime, timezone, timedelta

import astock
import market_data
import position_store

CACHE_DIR = os.environ.get("VR_DATA_DIR") or os.path.join(os.path.expanduser("~"), ".vibe-research")
PF_FILE = os.path.join(CACHE_DIR, "portfolio.json")
BEIJING = timezone(timedelta(hours=8))
_LOCK = threading.Lock()


def _now() -> str:
    return datetime.now(BEIJING).strftime("%Y-%m-%d %H:%M")


def _load() -> dict:
    payload = position_store.load("manual-stock-portfolio", PF_FILE)
    return payload if isinstance(payload, dict) else {"holdings": [], "last_refresh": None}


def _save(d: dict) -> None:
    position_store.save("manual-stock-portfolio", d, PF_FILE)


def _quote_for_symbol(symbol: str) -> dict:
    """Normalize one A-share or Yahoo-backed US/European quote for portfolio math."""
    if symbol.isdigit() and len(symbol) == 6:
        quote = astock.tencent_quote([symbol]).get(symbol, {})
        return {"name": quote.get("name", symbol), "price": quote.get("price", 0.0), "currency": "CNY"}
    snapshot = market_data.get_snapshot(symbol)
    return {
        "name": snapshot.instrument.name or symbol,
        "price": snapshot.quote.price,
        "currency": snapshot.quote.currency or snapshot.instrument.currency or "UNKNOWN",
    }


def _symbol_currency(symbol: str) -> str:
    if symbol.isdigit() and len(symbol) == 6:
        return "CNY"
    try:
        return market_data.resolve_symbol(symbol).exchange.expected_currency
    except market_data.MarketDataError:
        return "UNKNOWN"


def add_holding(code: str, shares: float, cost: float, include_in_total: bool = False) -> dict:
    """加一笔持仓；同代码则按加权平均成本合并（加仓）。"""
    with _LOCK:
        d = _load()
        for h in d["holdings"]:
            if h["code"] == code:
                total = h["shares"] + shares
                # 4 位小数：ETF/基金成本常见 3-4 位（issue #13），2-3 位会让市值/盈亏对不上账
                h["cost"] = round((h["shares"] * h["cost"] + shares * cost) / total, 4) if total else cost
                h["shares"] = total
                h.setdefault("include_in_total", include_in_total)
                break
        else:
            d["holdings"].append({"code": code, "shares": shares, "cost": cost, "include_in_total": include_in_total})
        _save(d)
    return get_portfolio()


def remove_holding(code: str) -> dict:
    with _LOCK:
        d = _load()
        d["holdings"] = [h for h in d["holdings"] if h["code"] != code]
        _save(d)
    return get_portfolio()


def set_holding_in_total(code: str, include_in_total: bool) -> dict:
    with _LOCK:
        d = _load()
        found = False
        for holding in d.get("holdings", []):
            if holding.get("code") == code:
                holding["include_in_total"] = bool(include_in_total)
                found = True
                break
        if not found:
            raise KeyError(code)
        _save(d)
    return get_portfolio()


def close_position(code: str, date: str, price: float, shares: float, cost: float) -> dict:
    """记一笔已清仓：算已实现盈亏，存入 closed 列表。"""
    pnl = (price - cost) * shares
    with _LOCK:
        d = _load()
        d.setdefault("closed", [])
        try:
            quote = _quote_for_symbol(code)
        except Exception:
            quote = {"name": code, "currency": _symbol_currency(code)}
        d["closed"].append({
            "code": code, "name": quote["name"], "currency": quote["currency"], "date": date, "price": price,
            "shares": shares, "cost": cost, "pnl": round(pnl, 2),
            "pnl_pct": round((price - cost) / cost * 100, 2) if cost else 0.0,
        })
        _save(d)
    return get_portfolio()


def remove_closed(index: int) -> dict:
    with _LOCK:
        d = _load()
        cl = d.get("closed", [])
        if 0 <= index < len(cl):
            cl.pop(index)
            _save(d)
    return get_portfolio()


def get_portfolio() -> dict:
    """读持仓 + 实时行情，算每笔与汇总的市值/浮动盈亏。"""
    with _LOCK:
        d = _load()
    hs = d.get("holdings", [])
    rows = []
    totals_by_currency: dict[str, dict[str, float]] = {}
    if hs:
        for h in hs:
            try:
                q = _quote_for_symbol(h["code"])
            except Exception:
                q = {"name": h["code"], "price": None, "currency": _symbol_currency(h["code"])}
            price = q.get("price")
            currency = q.get("currency") or _symbol_currency(h["code"])
            cv = h["cost"] * h["shares"]
            mv = price * h["shares"] if price is not None else None
            pnl = mv - cv if mv is not None else None
            rows.append({
                "code": h["code"], "name": q.get("name", h["code"]),
                "currency": currency,
                "price": price, "shares": h["shares"], "cost": h["cost"],
                "include_in_total": bool(h.get("include_in_total", False)),
                "market_value": round(mv, 2) if mv is not None else None,
                "pnl": round(pnl, 2) if pnl is not None else None,
                "pnl_pct": round(pnl / cv * 100, 2) if pnl is not None and cv else None,
                "quote_available": price is not None,
            })
            if mv is None:
                continue
            bucket = totals_by_currency.setdefault(currency, {"market_value": 0.0, "cost": 0.0})
            bucket["market_value"] += mv
            bucket["cost"] += cv
    for currency, bucket in totals_by_currency.items():
        total_pnl = bucket["market_value"] - bucket["cost"]
        bucket.update({
            "currency": currency,
            "market_value": round(bucket["market_value"], 2),
            "cost": round(bucket["cost"], 2),
            "pnl": round(total_pnl, 2),
            "pnl_pct": round(total_pnl / bucket["cost"] * 100, 2) if bucket["cost"] else 0.0,
        })
    only_total = next(iter(totals_by_currency.values()), None) if len(totals_by_currency) == 1 else None
    legacy_total = only_total or {"market_value": 0.0, "cost": 0.0, "pnl": 0.0, "pnl_pct": 0.0}
    closed = d.get("closed", [])
    realized_by_currency: dict[str, float] = {}
    for item in closed:
        currency = item.get("currency") or _symbol_currency(item.get("code", ""))
        item.setdefault("currency", currency)
        realized_by_currency[currency] = realized_by_currency.get(currency, 0.0) + item.get("pnl", 0.0)
    return {
        "holdings": rows,
        "totals": legacy_total,
        "totals_by_currency": totals_by_currency,
        "mixed_currency": len(totals_by_currency) > 1,
        "closed": closed,
        "realized_pnl": round(sum(c.get("pnl", 0) for c in closed), 2),
        "realized_pnl_by_currency": {k: round(v, 2) for k, v in realized_by_currency.items()},
        "updated": _now(),
        "last_refresh": d.get("last_refresh"),
    }
