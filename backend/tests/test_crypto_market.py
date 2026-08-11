from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from market_data.coinbase import CoinbaseProvider, _CACHE
from market_data.crypto import CryptoMarketDataService, resolve_crypto_symbol
from market_data.models import UnsupportedSymbolError
from market_data import crypto_overview
import research


def test_crypto_symbol_resolution_is_explicit_and_canonical():
    assert resolve_crypto_symbol("btc") == "BTC-USD"
    assert resolve_crypto_symbol("ETH-USD") == "ETH-USD"
    with pytest.raises(UnsupportedSymbolError):
        resolve_crypto_symbol("BTC/USD")


def test_coinbase_daily_bars_keep_fractional_volume(monkeypatch):
    provider = CoinbaseProvider()
    _CACHE.clear()
    monkeypatch.setattr(provider, "_candle_rows", lambda *_args: [{
        "start": "1704067200", "open": "42000.1", "high": "43000.2", "low": "41000.3",
        "close": "42500.4", "volume": "12.345678",
    }])
    rows = provider.bars("BTC-USD", "1mo", "1d")
    assert rows[0].date == "2024-01-01"
    assert rows[0].volume == 12.345678
    assert rows[0].currency == "USD"


def test_crypto_snapshot_exposes_capabilities(monkeypatch):
    provider = CoinbaseProvider()
    _CACHE.clear()
    monkeypatch.setattr(provider, "_product", lambda _symbol: {"price": "50000", "display_name": "Bitcoin"})
    yesterday = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp())
    monkeypatch.setattr(provider, "_candle_rows", lambda *_args: [{"start": yesterday, "close": "49000", "open": "48000", "high": "50000", "low": "47000"}])
    snapshot = CryptoMarketDataService(provider).snapshot("BTC")
    assert snapshot.instrument.asset_type == "crypto"
    assert snapshot.instrument.provider_symbol == "BTC-USD"
    assert snapshot.instrument.base_asset == "BTC"
    assert "markov" in snapshot.instrument.capabilities


def test_crypto_snapshot_uses_current_utc_candle_ohlc_and_previous_close(monkeypatch):
    provider = CoinbaseProvider()
    _CACHE.clear()
    monkeypatch.setattr(provider, "_product", lambda _symbol: {"price": "105", "display_name": "Bitcoin"})
    day_start = int(datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
    monkeypatch.setattr(provider, "_candle_rows", lambda *_args: [
        {"start": day_start - 86400, "close": "100", "open": "90", "high": "101", "low": "89"},
        {"start": day_start, "close": "104", "open": "102", "high": "106", "low": "101"},
    ])
    quote = provider.snapshot("BTC-USD").quote
    assert (quote.open, quote.high, quote.low) == (102, 106, 101)
    assert quote.previous_close == 100
    assert quote.change_pct == 5


def test_crypto_asset_context_prices_only_the_requested_asset(monkeypatch):
    rows = [
        {"id": "bitcoin", "symbol": "btc", "name": "Bitcoin"},
        {"id": "solana", "symbol": "sol", "name": "Solana"},
    ]
    monkeypatch.setattr(crypto_overview.coingecko, "top_markets", lambda: rows)
    monkeypatch.setattr(crypto_overview.coingecko, "global_market", lambda: {})
    seen = []
    monkeypatch.setattr(
        crypto_overview.crypto_service,
        "snapshot",
        lambda symbol: seen.append(symbol) or SimpleNamespace(quote=SimpleNamespace(price=150, source="coinbase")),
    )
    context = crypto_overview.get_crypto_asset_context("SOL-USD")
    assert context["market"]["symbol"] == "SOL"
    assert seen == ["SOL"]


def test_research_crypto_uses_crypto_market_and_default_benchmarks(monkeypatch):
    seen = []
    monkeypatch.setattr(research, "_load_series", lambda symbol, market: seen.append((symbol, market)) or {
        "instrument": {"symbol": symbol, "market": market}, "source": "test", "bars": [{"observed_at": "2024-01-01T00:00:00Z", "close": 1}],
    })
    payload = research.build_run_inputs("SOL", ["worth-buy-stocks"], {}, "crypto")
    assert payload["symbol"] == "SOL-USD"
    assert payload["market"] == "CRYPTO"
    assert payload["asset_type"] == "crypto"
    assert {symbol for symbol, market in seen if market == "CRYPTO"} == {"SOL-USD", "BTC-USD", "ETH-USD"}


def test_research_undeclared_skill_support_uses_safe_defaults(monkeypatch):
    class Response:
        status_code = 200

        @staticmethod
        def json():
            return [{"name": "worth-buy-stocks"}, {"name": "markov-method"}]

    monkeypatch.setattr(research, "configured", lambda: True)
    monkeypatch.setattr(research.requests, "get", lambda *_args, **_kwargs: Response())
    skills = {item["name"]: item["supported_asset_types"] for item in research.list_skills()}
    assert skills["worth-buy-stocks"] == ["equity"]
    assert skills["markov-method"] == ["equity", "crypto"]
    with pytest.raises(research.ResearchClientError, match="do not support crypto"):
        research.validate_skill_support(["worth-buy-stocks"], "crypto", [
            {"name": "worth-buy-stocks", "supported_asset_types": ["equity"]},
        ])


def test_research_preserves_explicit_empty_asset_support(monkeypatch):
    class Response:
        status_code = 200

        @staticmethod
        def json():
            return [{"name": "markov-method", "supported_asset_types": []}]

    monkeypatch.setattr(research, "configured", lambda: True)
    monkeypatch.setattr(research.requests, "get", lambda *_args, **_kwargs: Response())
    assert research.list_skills()[0]["supported_asset_types"] == []


def test_research_exposes_new_price_series_skills_for_both_assets(monkeypatch):
    class Response:
        status_code = 200

        @staticmethod
        def json():
            return [
                {"name": "technical-basic"},
                {"name": "risk-analysis"},
                {"name": "volatility-regime"},
            ]

    monkeypatch.setattr(research, "configured", lambda: True)
    monkeypatch.setattr(research.requests, "get", lambda *_args, **_kwargs: Response())
    skills = {item["name"]: item["supported_asset_types"] for item in research.list_skills()}
    assert skills == {
        "technical-basic": ["equity", "crypto"],
        "risk-analysis": ["equity", "crypto"],
        "volatility-regime": ["equity", "crypto"],
    }


def test_tradeagent_request_uses_its_strict_instrument_contract(monkeypatch):
    captured = {}

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {"results": []}

    def post(*_args, **kwargs):
        captured.update(kwargs["json"])
        return Response()

    monkeypatch.setattr(research.requests, "post", post)
    research.run_skill(
        skill="risk-analysis",
        symbol="BTC-USD",
        market="CRYPTO",
        asset_type="crypto",
        skill_parameters={},
        price_series=[{
            "instrument": {"symbol": "BTC-USD", "market": "CRYPTO"},
            "source": "coinbase",
            "bars": [{"observed_at": "2025-01-01T00:00:00Z", "close": 100}],
        }],
    )
    assert captured["instrument"] == {"symbol": "BTC-USD", "market": "CRYPTO"}


def test_loaded_crypto_series_uses_tradeagent_instrument_shape(monkeypatch):
    bar = SimpleNamespace(
        date="2025-01-01", open=99, high=101, low=98, close=100, volume=1.25,
    )
    monkeypatch.setattr(
        research.market_data,
        "get_bars",
        lambda *_args: SimpleNamespace(bars=[bar], source="coinbase"),
    )
    payload = research._load_series("BTC-USD", "CRYPTO")
    assert payload["instrument"] == {"symbol": "BTC-USD", "market": "CRYPTO"}
