"""Coinbase Advanced Trade public spot-market adapter with stale-safe caching."""

from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from .models import (
    HistoricalBar,
    InstrumentIdentity,
    InstrumentNotFoundError,
    InstrumentSnapshot,
    NormalizedQuote,
    ProviderError,
    ProviderTimeoutError,
)

_BASE_URL = "https://api.coinbase.com/api/v3/brokerage/market"
_TIMEOUT = 12
_LOCK = threading.Lock()
_CACHE: dict[tuple[Any, ...], tuple[float, Any]] = {}
_STALE: set[tuple[Any, ...]] = set()


def _number(value: Any) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        response = requests.get(f"{_BASE_URL}{path}", params=params, timeout=_TIMEOUT)
    except requests.Timeout as exc:
        raise ProviderTimeoutError("Coinbase market data request timed out") from exc
    except requests.RequestException as exc:
        raise ProviderError("Coinbase market data is unavailable") from exc
    if response.status_code == 404:
        raise InstrumentNotFoundError("Coinbase 上未找到该 USD 现货交易对")
    if response.status_code >= 400:
        raise ProviderError(f"Coinbase market data returned HTTP {response.status_code}")
    try:
        payload = response.json()
    except ValueError as exc:
        raise ProviderError("Coinbase returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise ProviderError("Coinbase returned an unexpected payload")
    return payload


def _cached(key: tuple[Any, ...], ttl: int, loader):
    now = time.time()
    with _LOCK:
        hit = _CACHE.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    try:
        value = loader()
    except (ProviderError, ProviderTimeoutError):
        if hit:
            _STALE.add(key)
            return hit[1]
        raise
    with _LOCK:
        _CACHE[key] = (now, value)
        _STALE.discard(key)
    return value


class CoinbaseProvider:
    source = "coinbase"

    def _product(self, product_id: str) -> dict[str, Any]:
        return _cached(("product", product_id), 30, lambda: _get(f"/products/{product_id}"))

    def _candle_rows(self, product_id: str, start: datetime, end: datetime) -> list[dict[str, Any]]:
        payload = _get(
            f"/products/{product_id}/candles",
            {
                "start": str(int(start.timestamp())),
                "end": str(int(end.timestamp())),
                "granularity": "ONE_DAY",
                "limit": 350,
            },
        )
        rows = payload.get("candles", [])
        return rows if isinstance(rows, list) else []

    def bars(self, product_id: str, range_: str, interval: str) -> list[HistoricalBar]:
        days = {"1mo": 31, "3mo": 93, "6mo": 186, "1y": 366, "2y": 731}[range_]
        cache_key = ("bars", product_id, range_, interval)

        def load() -> list[HistoricalBar]:
            end = datetime.now(timezone.utc)
            start = end - timedelta(days=days)
            rows: list[dict[str, Any]] = []
            cursor = start
            while cursor < end:
                chunk_end = min(cursor + timedelta(days=300), end)
                rows.extend(self._candle_rows(product_id, cursor, chunk_end))
                cursor = chunk_end
            by_start = {str(row.get("start")): row for row in rows if isinstance(row, dict) and row.get("start")}
            bars = [
                HistoricalBar(
                    date=datetime.fromtimestamp(int(row["start"]), timezone.utc).date().isoformat(),
                    open=_number(row.get("open")),
                    high=_number(row.get("high")),
                    low=_number(row.get("low")),
                    close=_number(row.get("close")),
                    adjusted_close=_number(row.get("close")),
                    volume=_number(row.get("volume")),
                    currency=product_id.rsplit("-", 1)[1],
                )
                for row in by_start.values()
            ]
            if not bars:
                raise InstrumentNotFoundError("该加密货币没有可用的 Coinbase 日线")
            return sorted(bars, key=lambda bar: bar.date)

        return _cached(cache_key, 900, load)

    def snapshot(self, product_id: str) -> InstrumentSnapshot:
        product = self._product(product_id)
        base, quote = product_id.rsplit("-", 1)
        price = _number(product.get("price"))
        if price is None:
            raise InstrumentNotFoundError("Coinbase 上未找到该 USD 现货价格")
        now = datetime.now(timezone.utc)
        recent = _cached(
            ("recent", product_id), 30,
            lambda: self._candle_rows(product_id, now - timedelta(days=4), now),
        )
        utc_day_start = int(now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
        completed = sorted(
            (row for row in recent if isinstance(row, dict) and int(row.get("start", 0)) < utc_day_start),
            key=lambda row: int(row.get("start", 0)),
        )
        current = sorted(
            (row for row in recent if isinstance(row, dict) and int(row.get("start", 0)) >= utc_day_start),
            key=lambda row: int(row.get("start", 0)),
        )
        current_candle = current[-1] if current else None
        previous = _number(completed[-1].get("close")) if completed else None
        change_pct = (price - previous) / previous * 100 if previous not in (None, 0) else None
        fetched_at = now.isoformat().replace("+00:00", "Z")
        identity = InstrumentIdentity(
            instrument_id=f"crypto:coinbase:{base}:{quote}",
            asset_type="crypto",
            symbol=base,
            provider_symbol=product_id,
            name=str(product.get("base_name") or product.get("display_name") or base),
            exchange="Coinbase",
            mic="COINBASE",
            country="",
            currency=quote,
            timezone="UTC",
            base_asset=base,
            quote_asset=quote,
            capabilities=("quote", "history", "technical", "markov", "debate"),
        )
        quote_data = NormalizedQuote(
            price=price,
            open=_number(current_candle.get("open")) if current_candle else None,
            high=_number(current_candle.get("high")) if current_candle else None,
            low=_number(current_candle.get("low")) if current_candle else None,
            previous_close=previous,
            change_pct=change_pct,
            currency=quote,
            source_price=price,
            source_price_unit=quote,
            price_scale=1.0,
            market_state="REGULAR",
            observed_at=fetched_at,
            fetched_at=fetched_at,
            delay_seconds=None,
            source=self.source,
            is_stale=("product", product_id) in _STALE or ("recent", product_id) in _STALE,
        )
        return InstrumentSnapshot(identity, quote_data)
