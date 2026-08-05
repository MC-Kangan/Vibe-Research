"""Provider-neutral headline benchmark snapshots for the landing page."""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from .yahoo import YahooProvider

_CACHE_TTL = 300.0
_CACHE: tuple[float, dict] | None = None
_LOCK = threading.Lock()

# Display names are product-facing. Symbols are Yahoo chart identifiers and are
# intentionally separate from the equity resolver's stock-symbol allowlist.
BENCHMARKS = (
    {"key": "sp500", "symbol": "^GSPC", "name": "S&P 500", "region": "US"},
    {"key": "nasdaq100", "symbol": "^NDX", "name": "Nasdaq-100", "region": "US"},
    {"key": "eurostoxx50", "symbol": "^STOXX50E", "name": "EURO STOXX 50", "region": "Europe"},
    {"key": "stoxx600", "symbol": "^STOXX", "name": "STOXX Europe 600", "region": "Europe"},
    {"key": "dax", "symbol": "^GDAXI", "name": "DAX", "region": "Europe"},
    {"key": "smi", "symbol": "^SSMI", "name": "SMI", "region": "Europe"},
)


def _snapshot(item: dict) -> dict:
    try:
        snapshot = YahooProvider().snapshot(item["symbol"])
        quote = snapshot.quote
        return {
            **item,
            "price": quote.price,
            "previous_close": quote.previous_close,
            "change_pct": quote.change_pct,
            "currency": quote.currency,
            "observed_at": quote.observed_at,
            "delay_seconds": quote.delay_seconds,
            "source": quote.source,
            "available": quote.price is not None,
        }, None
    except Exception as exc:  # noqa: BLE001 — one benchmark must not break the grid
        return {**item, "price": None, "previous_close": None, "change_pct": None,
                "currency": None, "observed_at": None, "delay_seconds": None,
                "source": "yahoo", "available": False}, str(exc)


def _build() -> dict:
    results: dict[str, dict] = {}
    gaps: list[dict] = []
    with ThreadPoolExecutor(max_workers=len(BENCHMARKS)) as executor:
        futures = {executor.submit(_snapshot, item): item for item in BENCHMARKS}
        for future in as_completed(futures):
            item, error = future.result()
            results[item["key"]] = item
            if error:
                gaps.append({"key": item["key"], "symbol": item["symbol"], "message": error})
    return {
        "items": [results[item["key"]] for item in BENCHMARKS],
        "gaps": gaps,
        "fetched_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def get_benchmarks() -> dict:
    global _CACHE
    now = time.monotonic()
    with _LOCK:
        if _CACHE and now - _CACHE[0] < _CACHE_TTL:
            return _CACHE[1]
    value = _build()
    with _LOCK:
        _CACHE = (now, value)
    return value
