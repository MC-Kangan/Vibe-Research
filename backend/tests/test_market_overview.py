"""Offline contracts for the cross-market landing overview."""

from types import SimpleNamespace

import pytest

import market_data.overview as overview


def _snapshot(symbol: str, name: str, country: str, change_pct: float):
    return SimpleNamespace(
        instrument=SimpleNamespace(name=name, country=country),
        quote=SimpleNamespace(
            price=100.0, change_pct=change_pct, currency="USD" if country == "US" else "EUR",
            source="yahoo",
        ),
    )


@pytest.fixture(autouse=True)
def clear_sector_cache():
    overview._SECTOR_CACHE = None
    yield
    overview._SECTOR_CACHE = None


def test_overview_combines_watchlist_breadth_movers_and_sector_groups(monkeypatch):
    monkeypatch.setattr(
        overview,
        "resolve_symbol",
        lambda symbol: SimpleNamespace(exchange=SimpleNamespace(country="US" if symbol == "AAPL" else "DE")),
    )
    monkeypatch.setattr(overview.astock, "tencent_quote", lambda codes: {
        "600519": {"name": "贵州茅台", "price": 1500.0, "change_pct": 0.0},
    })

    changes = {"AAPL": 2.5, "SAP.DE": -1.25}

    def fake_snapshot(symbol):
        if symbol in changes:
            return _snapshot(symbol, "Apple Inc." if symbol == "AAPL" else "SAP SE", "US" if symbol == "AAPL" else "DE", changes[symbol])
        return _snapshot(symbol, symbol, "US", 0.5)

    monkeypatch.setattr(overview, "get_snapshot", fake_snapshot)
    monkeypatch.setattr(overview, "get_benchmarks", lambda: {"items": [], "gaps": [], "fetched_at": "now"})

    result = overview.get_market_overview(["600519", "AAPL", "SAP.DE"])

    assert result["watchlist"]["breadth"] == {"total": 3, "up": 1, "down": 1, "flat": 1, "unavailable": 0}
    assert [item["symbol"] for item in result["watchlist"]["quotes"]] == ["600519", "AAPL", "SAP.DE"]
    assert result["watchlist"]["movers"][0]["symbol"] == "AAPL"
    assert len(result["sectors"]["US"]) == 6
    assert len(result["sectors"]["Europe"]) == 6
    assert result["notes"]


def test_overview_keeps_partial_sector_gaps_explicit(monkeypatch):
    monkeypatch.setattr(overview, "get_benchmarks", lambda: {"items": [], "gaps": [], "fetched_at": "now"})
    monkeypatch.setattr(overview, "_sectors", lambda: ({"US": [], "Europe": []}, [{"symbol": "XLK", "message": "quota"}]))

    result = overview.get_market_overview([])

    assert result["watchlist"]["breadth"]["total"] == 0
    assert result["gaps"] == [{"symbol": "XLK", "message": "quota", "scope": "sector"}]


def test_sector_proxy_snapshots_are_cached(monkeypatch):
    calls = []

    def fake_snapshot(symbol):
        calls.append(symbol)
        return _snapshot(symbol, symbol, "US", 0.5)

    monkeypatch.setattr(overview, "get_snapshot", fake_snapshot)

    first = overview._sectors()
    second = overview._sectors()

    assert first == second
    assert len(calls) == 12
