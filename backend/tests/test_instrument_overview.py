from types import SimpleNamespace

import instrument_overview


def test_market_overview_resolves_symbol_and_keeps_partial_data(monkeypatch):
    resolved = SimpleNamespace(provider_symbol="AAPL", exchange=SimpleNamespace(country="US"))
    monkeypatch.setattr(instrument_overview.market_data, "resolve_symbol", lambda _symbol: resolved)
    monkeypatch.setattr(instrument_overview.market_data, "get_snapshot", lambda _symbol: {"quote": 200})
    monkeypatch.setattr(
        instrument_overview.market_data,
        "get_bars",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("history unavailable")),
    )
    monkeypatch.setattr(instrument_overview.gstock, "us_hk_stock", lambda _symbol: {"metrics": []})

    result = instrument_overview.get_overview("aapl")

    assert result["route"] == "market"
    assert result["status"] == "partial"
    assert result["data"]["market_snapshot"] == {"quote": 200}
    assert result["gaps"] == [{"section": "market_history", "detail": "history unavailable"}]


def test_a_share_overview_exposes_specialized_capabilities(monkeypatch):
    monkeypatch.setattr(instrument_overview.astock, "full_valuation", lambda _symbol: {"quote": {}})
    monkeypatch.setattr(instrument_overview, "_a_share_reports", lambda _symbol: [{"title": "report"}])
    monkeypatch.setattr(instrument_overview.astock, "valuation_percentile", lambda _symbol: {"pe": 50})
    monkeypatch.setattr(instrument_overview.astock, "financials", lambda _symbol: {"revenue": 1})
    monkeypatch.setattr(instrument_overview.astock, "announcements", lambda _symbol: [{"title": "notice"}])
    monkeypatch.setattr(instrument_overview.astock, "kline", lambda *_args, **_kwargs: [{"date": "2026-01-01"}])

    result = instrument_overview.get_overview("600519")

    assert result["route"] == "a-share"
    assert result["status"] == "available"
    assert "fund-flow" in result["capabilities"]
    assert result["data"]["a_share_history"][0]["date"] == "2026-01-01"
