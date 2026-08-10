"""Cached reporting-currency conversion backed by the existing Yahoo adapter."""

from __future__ import annotations

import time

from market_data.yahoo import YahooProvider

_CACHE: dict[tuple[str, str], tuple[float, float]] = {}


def get_rate(source: str, target: str) -> float | None:
    source, target = source.upper(), target.upper()
    if source == target:
        return 1.0
    key = (source, target)
    hit = _CACHE.get(key)
    if hit and time.time() - hit[0] < 900:
        return hit[1]
    provider = YahooProvider()
    try:
        price = provider.snapshot(f"{source}{target}=X").quote.price
    except Exception:
        try:
            inverse = provider.snapshot(f"{target}{source}=X").quote.price
            price = 1 / inverse if inverse else None
        except Exception:
            price = None
    if price:
        _CACHE[key] = (time.time(), price)
    return price
