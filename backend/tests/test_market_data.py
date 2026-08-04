"""Offline contract tests for US/European Yahoo market data."""

from __future__ import annotations

import pytest
import requests

from market_data.models import (
    HistoricalBar,
    InstrumentIdentity,
    InstrumentNotFoundError,
    InstrumentSnapshot,
    NormalizedQuote,
    ProviderError,
    ProviderTimeoutError,
    UnsupportedSymbolError,
)
from market_data.service import MarketDataService, resolve_symbol
from market_data.yahoo import YahooProvider


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


class FakeHttp:
    def __init__(self, payload=None, error=None, status_code=200):
        self.payload = payload
        self.error = error
        self.status_code = status_code

    def get(self, *args, **kwargs):
        if self.error:
            raise self.error
        return FakeResponse(self.payload, self.status_code)


def chart_payload(symbol="VOD.L", currency="GBp"):
    return {
        "chart": {
            "error": None,
            "result": [{
                "meta": {
                    "symbol": symbol,
                    "currency": currency,
                    "longName": "Vodafone Group Plc",
                    "regularMarketPrice": 117.25,
                    "chartPreviousClose": 118.5,
                    "regularMarketOpen": 118.0,
                    "regularMarketDayHigh": 119.5,
                    "regularMarketDayLow": 116.8,
                    "regularMarketTime": 1785772800,
                    "exchangeDataDelayedBy": 20,
                    "marketState": "CLOSED",
                    "exchangeTimezoneName": "Europe/London",
                },
                "timestamp": [1785686400, None, 1785772800],
                "indicators": {
                    "quote": [{
                        "open": [115.0, 999.0, None],
                        "high": [118.0, 999.0, 119.5],
                        "low": [114.0, 999.0, 116.8],
                        "close": [118.5, None, 117.25],
                        "volume": [123456, 999, None],
                    }],
                    "adjclose": [{"adjclose": [116.5, 999.0, 117.25]}],
                },
            }],
        },
    }


@pytest.mark.parametrize("symbol,mic,country,currency", [
    ("VOD.L", "XLON", "GB", "GBP"),
    ("SAP.DE", "XETR", "DE", "EUR"),
    ("ASML.AS", "XAMS", "NL", "EUR"),
    ("MC.PA", "XPAR", "FR", "EUR"),
    ("NESN.SW", "XSWX", "CH", "CHF"),
])
def test_supported_symbol_resolution(symbol, mic, country, currency):
    resolved = resolve_symbol(f"  {symbol.lower()}  ")
    assert resolved.provider_symbol == symbol
    assert resolved.exchange.mic == mic
    assert resolved.exchange.country == country
    assert resolved.exchange.expected_currency == currency


def test_vod_canonical_identity():
    resolved = resolve_symbol("VOD.L")
    assert f"equity:{resolved.exchange.mic}:{resolved.local_symbol}" == "equity:XLON:VOD"


@pytest.mark.parametrize("raw,provider", [("aapl", "AAPL"), ("BRK.B", "BRK-B"), ("brk-b", "BRK-B")])
def test_us_symbol_resolution(raw, provider):
    resolved = resolve_symbol(raw)
    assert resolved.provider_symbol == provider
    assert resolved.exchange.country == "US"
    assert resolved.exchange.expected_currency == "USD"


@pytest.mark.parametrize("symbol", ["ABC.US", ".L", "BAD SYMBOL.L", "1234", "AAPL!"])
def test_unsupported_or_malformed_symbol_rejected(symbol):
    with pytest.raises(UnsupportedSymbolError):
        resolve_symbol(symbol)


def test_yahoo_snapshot_scales_pence_once_and_preserves_source_value():
    snapshot = YahooProvider(FakeHttp(chart_payload())).snapshot("VOD.L")
    assert snapshot.instrument.currency == "GBP"
    assert snapshot.quote.price == pytest.approx(1.1725)
    assert snapshot.quote.previous_close == pytest.approx(1.185)
    assert snapshot.quote.source_price == 117.25
    assert snapshot.quote.source_price_unit == "GBp"
    assert snapshot.quote.price_scale == 0.01
    assert snapshot.quote.delay_seconds == 1200
    assert snapshot.quote.market_state == "CLOSED"
    assert snapshot.quote.change_pct == pytest.approx((1.1725 - 1.185) / 1.185 * 100)


def test_yahoo_bars_scale_prices_skip_missing_timestamp_and_sort():
    bars = YahooProvider(FakeHttp(chart_payload())).bars("VOD.L", "1y", "1d")
    assert [bar.date for bar in bars] == sorted(bar.date for bar in bars)
    assert len(bars) == 2
    assert bars[0].open == pytest.approx(1.15)
    assert bars[0].adjusted_close == pytest.approx(1.165)
    assert bars[-1].open is None
    assert bars[-1].volume is None
    assert bars[-1].currency == "GBP"


def test_major_currency_prices_are_not_scaled():
    payload = chart_payload("SAP.DE", "EUR")
    snapshot = YahooProvider(FakeHttp(payload)).snapshot("SAP.DE")
    assert snapshot.quote.price == 117.25
    assert snapshot.quote.price_scale == 1.0
    assert snapshot.quote.source_price_unit == "EUR"


def test_uppercase_gbp_is_already_pounds_and_not_scaled():
    snapshot = YahooProvider(FakeHttp(chart_payload(currency="GBP"))).snapshot("VOD.L")
    assert snapshot.quote.price == 117.25
    assert snapshot.quote.price_scale == 1.0


def test_missing_quote_values_remain_none():
    payload = chart_payload()
    meta = payload["chart"]["result"][0]["meta"]
    for key in ("regularMarketPrice", "chartPreviousClose", "regularMarketOpen", "regularMarketDayHigh", "regularMarketDayLow"):
        meta.pop(key)
    row = payload["chart"]["result"][0]["indicators"]["quote"][0]
    row.update({"open": [], "high": [], "low": [], "close": []})
    quote = YahooProvider(FakeHttp(payload)).snapshot("VOD.L").quote
    assert quote.price is None
    assert quote.previous_close is None
    assert quote.open is None
    assert quote.change_pct is None


def test_yahoo_rejects_symbol_mismatch():
    with pytest.raises(ProviderError):
        YahooProvider(FakeHttp(chart_payload("VOD"))).snapshot("VOD.L")


def test_empty_chart_is_not_found():
    payload = {"chart": {"result": None, "error": {"code": "Not Found"}}}
    with pytest.raises(InstrumentNotFoundError):
        YahooProvider(FakeHttp(payload)).snapshot("VOD.L")


def test_timeout_is_controlled():
    with pytest.raises(ProviderTimeoutError):
        YahooProvider(FakeHttp(error=requests.Timeout())).snapshot("VOD.L")


class StubProvider:
    source = "stub"

    def __init__(self):
        self.identity = InstrumentIdentity(
            "wrong", "equity", "wrong", "wrong", "Vodafone", "wrong", "wrong", "wrong", "GBP", "Europe/London",
        )
        self.quote = NormalizedQuote(
            1.0, None, None, None, None, None, "GBP", 100.0, "GBp", 0.01,
            None, None, "2026-08-04T00:00:00Z", None, "stub",
        )

    def snapshot(self, provider_symbol):
        return InstrumentSnapshot(self.identity, self.quote)

    def bars(self, provider_symbol, range_, interval):
        return [HistoricalBar("2026-08-04", 1.0, 1.0, 1.0, 1.0, 1.0, 10, "GBP")]


def test_service_owns_canonical_exchange_identity():
    snapshot = MarketDataService(StubProvider()).snapshot("VOD.L")
    assert snapshot.instrument.instrument_id == "equity:XLON:VOD"
    assert snapshot.instrument.exchange == "London Stock Exchange"


def test_service_rejects_unsupported_range_and_interval():
    service = MarketDataService(StubProvider())
    with pytest.raises(UnsupportedSymbolError):
        service.bars("VOD.L", "max", "1d")
    with pytest.raises(UnsupportedSymbolError):
        service.bars("VOD.L", "1y", "1h")
