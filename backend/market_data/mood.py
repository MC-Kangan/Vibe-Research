"""Cached, Yahoo-backed market mood for a transparent US or European basket."""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from .models import MarketDataError
from .service import get_bars


_UNIVERSES = {
    "US": {
        "label": "美国大盘股代表篮子（50只）",
        "benchmark": "S&P 500 / Nasdaq-100",
        "symbols": (
            "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "BRK-B", "AVGO", "TSLA", "JPM",
            "V", "MA", "WMT", "LLY", "XOM", "UNH", "COST", "ORCL", "HD", "PG",
            "JNJ", "ABBV", "BAC", "NFLX", "KO", "CRM", "CVX", "MRK", "CSCO", "AMD",
            "PEP", "TMO", "MCD", "IBM", "GE", "CAT", "GS", "AXP", "RTX", "ISRG",
            "AMGN", "NEE", "LIN", "DIS", "PM", "T", "VZ", "SPGI", "BLK", "QCOM",
        ),
    },
    "Europe": {
        "label": "EURO STOXX 50 成分篮子",
        "benchmark": "EURO STOXX 50",
        "symbols": (
            "ADS.DE", "ADYEN.AS", "AD.AS", "AI.PA", "AIR.PA", "ALV.DE", "ARGX.BR", "ASML.AS", "ABI.BR", "BAS.DE",
            "BAYN.DE", "BBVA.MC", "BMW.DE", "BNP.PA", "BN.PA", "DBK.DE", "DB1.DE", "DHL.DE", "DTE.DE", "ENEL.MI",
            "ENI.MI", "EL.PA", "RACE.MI", "RMS.PA", "IBE.MC", "ITX.MC", "IFX.DE", "INGA.AS", "ISP.MI", "OR.PA",
            "MBG.DE", "MUV2.DE", "NDA-FI.HE", "PRX.AS", "RHM.DE", "SAF.PA", "SAN.MC", "SAN.PA", "SAP.DE", "SU.PA",
            "SIE.DE", "ENR.DE", "TTE.PA", "UCG.MI", "DG.PA", "SGO.PA", "VOW.DE", "WKL.AS", "CS.PA", "MC.PA",
        ),
    },
}

_CACHE_TTL = 900.0
_CACHE: dict[str, tuple[float, dict]] = {}
_CACHE_LOCK = threading.Lock()


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _analyse(symbol: str) -> tuple[dict | None, dict | None]:
    try:
        series = get_bars(symbol, "1y", "1d")
        rows = [bar for bar in series.bars if bar.close is not None]
        if len(rows) < 2:
            return None, {"symbol": symbol, "message": "历史行情不足"}

        latest = rows[-1]
        prior = rows[-2]
        close = float(latest.close)
        prior_close = float(prior.close)
        change_pct = (close - prior_close) / prior_close * 100 if prior_close else None
        closes = [float(row.close) for row in rows]

        ma: dict[str, bool | None] = {}
        for window in (20, 50, 200):
            average = _mean(closes[-window:]) if len(closes) >= window else None
            ma[str(window)] = close >= average if average is not None else None

        lookback = rows[-252:]
        prior_rows = lookback[:-1]
        prior_highs = [float(row.high) for row in prior_rows if row.high is not None]
        prior_lows = [float(row.low) for row in prior_rows if row.low is not None]
        latest_high = float(latest.high) if latest.high is not None else close
        latest_low = float(latest.low) if latest.low is not None else close

        prior_volumes = [float(row.volume) for row in rows[-21:-1] if row.volume is not None and row.volume > 0]
        average_volume = _mean(prior_volumes)
        volume_ratio = float(latest.volume) / average_volume if latest.volume and average_volume else None
        return {
            "symbol": symbol,
            "date": latest.date,
            "close": close,
            "change_pct": change_pct,
            "above_ma": ma,
            "new_52w_high": bool(prior_highs) and latest_high > max(prior_highs),
            "new_52w_low": bool(prior_lows) and latest_low < min(prior_lows),
            "volume_ratio": volume_ratio,
            "unusual_volume": volume_ratio is not None and volume_ratio >= 2.0,
        }, None
    except MarketDataError as exc:
        return None, {"symbol": symbol, "message": str(exc)}
    except Exception as exc:  # noqa: BLE001 - one constituent must not break the basket
        return None, {"symbol": symbol, "message": str(exc)}


def _mood_label(up: int, down: int, above_50_pct: float | None) -> str:
    available = up + down
    up_ratio = up / available if available else 0.5
    trend = above_50_pct if above_50_pct is not None else 50.0
    if up_ratio >= 0.65 and trend >= 60:
        return "偏强"
    if up_ratio <= 0.35 and trend <= 40:
        return "偏弱"
    return "中性"


def _build_market_mood(market: str) -> dict:
    universe = _UNIVERSES[market]
    symbols = universe["symbols"]
    items: list[dict] = []
    gaps: list[dict] = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(_analyse, symbol): symbol for symbol in symbols}
        for future in as_completed(futures):
            item, gap = future.result()
            if item:
                items.append(item)
            if gap:
                gaps.append(gap)

    order = {symbol: index for index, symbol in enumerate(symbols)}
    items.sort(key=lambda item: order[item["symbol"]])
    gaps.sort(key=lambda item: order[item["symbol"]])
    changes = [item for item in items if item["change_pct"] is not None]
    up = sum(item["change_pct"] > 0 for item in changes)
    down = sum(item["change_pct"] < 0 for item in changes)
    flat = len(changes) - up - down

    participation = {}
    for window in (20, 50, 200):
        eligible = [item for item in items if item["above_ma"][str(window)] is not None]
        above = sum(bool(item["above_ma"][str(window)]) for item in eligible)
        participation[str(window)] = {
            "above": above,
            "total": len(eligible),
            "pct": round(above / len(eligible) * 100, 2) if eligible else None,
        }

    movers = sorted(changes, key=lambda item: abs(item["change_pct"]), reverse=True)[:8]
    return {
        "market": market,
        "universe": {"label": universe["label"], "benchmark": universe["benchmark"], "size": len(symbols)},
        "mood": _mood_label(up, down, participation["50"]["pct"]),
        "breadth": {
            "total": len(symbols), "available": len(items), "up": up, "down": down,
            "flat": flat, "unavailable": len(symbols) - len(items),
        },
        "participation": participation,
        "new_highs": sum(item["new_52w_high"] for item in items),
        "new_lows": sum(item["new_52w_low"] for item in items),
        "unusual_volume": sum(item["unusual_volume"] for item in items),
        "movers": movers,
        "gaps": gaps,
        "as_of": max((item["date"] for item in items), default=None),
        "fetched_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "Yahoo Finance daily history",
        "notes": [
            "美国数据来自50只大盘股代表篮子，并非全市场宽度。" if market == "US" else "欧洲数据来自EURO STOXX 50成分篮子。",
            "新高/新低按当前日高低价是否突破过去一年历史区间计算；异常成交量为20日均量的2倍或以上。",
            "该模块为日线客观统计，不含付费实时逐笔、期权情绪或涨跌停连板数据。",
        ],
    }


def get_market_mood(market: str) -> dict:
    if market not in _UNIVERSES:
        raise ValueError("market 仅支持 US 或 Europe")
    now = time.monotonic()
    with _CACHE_LOCK:
        cached = _CACHE.get(market)
        if cached and now - cached[0] < _CACHE_TTL:
            return cached[1]
    value = _build_market_mood(market)
    with _CACHE_LOCK:
        _CACHE[market] = (time.monotonic(), value)
    return value
