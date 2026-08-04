"""Yahoo chart adapter used by the personal-use US/Europe data path."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

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

_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart"
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; VibeResearch/0.3; personal-use market data)"}


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _integer(value: Any) -> int | None:
    number = _number(value)
    return int(number) if number is not None else None


def _price_unit(currency: Any) -> tuple[str, str, float]:
    source_unit = str(currency or "").strip() or "UNKNOWN"
    if source_unit in {"GBp", "GBX"}:
        # Yahoo uses GBp (lower-case p) for London prices quoted in pence.
        return "GBP", source_unit, 0.01
    return source_unit.upper(), source_unit, 1.0


def _scaled(value: Any, scale: float) -> float | None:
    number = _number(value)
    return number * scale if number is not None else None


def _iso_utc(value: Any) -> str | None:
    timestamp = _number(value)
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")


def _latest(values: Any) -> Any:
    if not isinstance(values, list):
        return None
    return next((value for value in reversed(values) if value is not None), None)


class YahooProvider:
    source = "yahoo"

    def __init__(self, http: Any = requests, timeout: float = 10.0):
        self._http = http
        self._timeout = timeout

    def _chart(self, provider_symbol: str, range_: str, interval: str) -> tuple[dict[str, Any], str]:
        url = f"{_BASE_URL}/{quote(provider_symbol, safe='')}"
        try:
            response = self._http.get(
                url,
                params={"range": range_, "interval": interval, "events": "div,splits"},
                headers=_HEADERS,
                timeout=self._timeout,
            )
        except requests.Timeout as exc:
            raise ProviderTimeoutError("行情数据源响应超时") from exc
        except requests.RequestException as exc:
            raise ProviderError("行情数据源连接失败") from exc

        if response.status_code == 404:
            raise InstrumentNotFoundError("未找到该股票")
        if response.status_code != 200:
            raise ProviderError("行情数据源暂时不可用")
        try:
            payload = response.json()
        except (TypeError, ValueError) as exc:
            raise ProviderError("行情数据源返回了无效响应") from exc

        chart = payload.get("chart") if isinstance(payload, dict) else None
        result = chart.get("result") if isinstance(chart, dict) else None
        if not result:
            error = chart.get("error") if isinstance(chart, dict) else None
            if error:
                raise InstrumentNotFoundError("未找到该股票")
            raise ProviderError("行情数据源未返回数据")
        item = result[0]
        if not isinstance(item, dict) or not isinstance(item.get("meta"), dict):
            raise ProviderError("行情数据源返回了无效响应")
        returned_symbol = str(item["meta"].get("symbol") or "").upper()
        if returned_symbol != provider_symbol.upper():
            raise ProviderError("行情数据源返回了不匹配的股票")
        fetched_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        return item, fetched_at

    @staticmethod
    def _identity(provider_symbol: str, meta: dict[str, Any]) -> InstrumentIdentity:
        currency, _, _ = _price_unit(meta.get("currency"))
        local_symbol = provider_symbol.rsplit(".", 1)[0]
        local_name = str(meta.get("longName") or meta.get("shortName") or local_symbol)
        return InstrumentIdentity(
            # The service replaces provider-local identifiers and exchange data
            # with the canonical values from its explicit allowlist.
            instrument_id=f"provider:yahoo:{provider_symbol}",
            asset_type="equity",
            symbol=local_symbol,
            provider_symbol=provider_symbol,
            name=local_name,
            exchange=str(meta.get("fullExchangeName") or meta.get("exchangeName") or ""),
            mic="",
            country="",
            currency=currency,
            timezone=str(meta.get("exchangeTimezoneName") or meta.get("timezone") or "") or None,
        )

    def snapshot(self, provider_symbol: str) -> InstrumentSnapshot:
        item, fetched_at = self._chart(provider_symbol, "5d", "1d")
        meta = item["meta"]
        quote_rows = item.get("indicators", {}).get("quote") or [{}]
        row = quote_rows[0] if isinstance(quote_rows[0], dict) else {}
        currency, source_unit, scale = _price_unit(meta.get("currency"))

        source_price = _number(meta.get("regularMarketPrice"))
        closes = row.get("close")
        present_closes = [value for value in closes if value is not None] if isinstance(closes, list) else []
        # For multi-day ranges chartPreviousClose can describe the start of the
        # requested window. The penultimate daily close is the actual prior close.
        previous_close = present_closes[-2] if len(present_closes) >= 2 else None
        if previous_close is None:
            previous_close = meta.get("previousClose", meta.get("chartPreviousClose"))
        current = _scaled(source_price, scale)
        previous = _scaled(previous_close, scale)
        delay_minutes = _integer(meta.get("exchangeDataDelayedBy"))
        change_pct = None
        if current is not None and previous not in (None, 0):
            change_pct = (current - previous) / previous * 100

        normalized = NormalizedQuote(
            price=current,
            open=_scaled(meta.get("regularMarketOpen", _latest(row.get("open"))), scale),
            high=_scaled(meta.get("regularMarketDayHigh", _latest(row.get("high"))), scale),
            low=_scaled(meta.get("regularMarketDayLow", _latest(row.get("low"))), scale),
            previous_close=previous,
            change_pct=change_pct,
            currency=currency,
            source_price=source_price,
            source_price_unit=source_unit,
            price_scale=scale,
            market_state=str(meta.get("marketState") or "") or None,
            observed_at=_iso_utc(meta.get("regularMarketTime")),
            fetched_at=fetched_at,
            delay_seconds=delay_minutes * 60 if delay_minutes is not None else None,
            source=self.source,
        )
        return InstrumentSnapshot(self._identity(provider_symbol, meta), normalized)

    def bars(self, provider_symbol: str, range_: str, interval: str) -> list[HistoricalBar]:
        item, _ = self._chart(provider_symbol, range_, interval)
        meta = item["meta"]
        currency, _, scale = _price_unit(meta.get("currency"))
        timestamps = item.get("timestamp")
        indicators = item.get("indicators") or {}
        quote_rows = indicators.get("quote") or [{}]
        row = quote_rows[0] if isinstance(quote_rows[0], dict) else {}
        adj_rows = indicators.get("adjclose") or [{}]
        adjusted = adj_rows[0].get("adjclose", []) if isinstance(adj_rows[0], dict) else []
        if not isinstance(timestamps, list) or not timestamps:
            raise InstrumentNotFoundError("该股票没有历史行情数据")

        try:
            local_tz = ZoneInfo(str(meta.get("exchangeTimezoneName") or "UTC"))
        except ZoneInfoNotFoundError:
            local_tz = timezone.utc

        def at(values: Any, index: int) -> Any:
            return values[index] if isinstance(values, list) and index < len(values) else None

        bars: list[HistoricalBar] = []
        for index, raw_timestamp in enumerate(timestamps):
            timestamp = _number(raw_timestamp)
            if timestamp is None:
                continue
            bars.append(HistoricalBar(
                date=datetime.fromtimestamp(timestamp, local_tz).date().isoformat(),
                open=_scaled(at(row.get("open"), index), scale),
                high=_scaled(at(row.get("high"), index), scale),
                low=_scaled(at(row.get("low"), index), scale),
                close=_scaled(at(row.get("close"), index), scale),
                adjusted_close=_scaled(at(adjusted, index), scale),
                volume=_integer(at(row.get("volume"), index)),
                currency=currency,
            ))
        if not bars:
            raise InstrumentNotFoundError("该股票没有历史行情数据")
        return sorted(bars, key=lambda bar: bar.date)
