"""Offline contracts for Yahoo-backed US and European market mood."""

from types import SimpleNamespace

import pytest

import market_data.mood as mood


def _series(closes, volumes=None):
    volumes = volumes or [100] * len(closes)
    bars = [
        SimpleNamespace(
            date=f"2026-01-{index + 1:02d}", close=float(close), high=float(close) + 1,
            low=float(close) - 1, volume=volumes[index],
        )
        for index, close in enumerate(closes)
    ]
    return SimpleNamespace(bars=bars)


@pytest.fixture(autouse=True)
def clear_mood_cache():
    mood._CACHE.clear()
    yield
    mood._CACHE.clear()


def test_market_mood_calculates_breadth_participation_extremes_and_volume(monkeypatch):
    monkeypatch.setitem(mood._UNIVERSES, "US", {
        "label": "Test basket", "benchmark": "Test", "symbols": ("UP", "DOWN", "FLAT"),
    })

    def fake_bars(symbol, range_, interval):
        assert (range_, interval) == ("1y", "1d")
        if symbol == "UP":
            return _series(list(range(1, 21)) + [30], [100] * 20 + [250])
        if symbol == "DOWN":
            return _series(list(range(30, 9, -1)))
        return _series([10] * 21)

    monkeypatch.setattr(mood, "get_bars", fake_bars)
    result = mood.get_market_mood("US")

    assert result["breadth"] == {"total": 3, "available": 3, "up": 1, "down": 1, "flat": 1, "unavailable": 0}
    assert result["participation"]["20"] == {"above": 2, "total": 3, "pct": pytest.approx(66.67)}
    assert result["participation"]["200"]["pct"] is None
    assert result["new_highs"] == 1
    assert result["new_lows"] == 1
    assert result["unusual_volume"] == 1
    assert result["movers"][0]["symbol"] == "UP"


def test_market_mood_cache_avoids_duplicate_history_requests(monkeypatch):
    monkeypatch.setitem(mood._UNIVERSES, "Europe", {
        "label": "Test basket", "benchmark": "Test", "symbols": ("SAP.DE",),
    })
    calls = []

    def fake_bars(symbol, range_, interval):
        calls.append(symbol)
        return _series([10, 11])

    monkeypatch.setattr(mood, "get_bars", fake_bars)
    assert mood.get_market_mood("Europe") == mood.get_market_mood("Europe")
    assert calls == ["SAP.DE"]


def test_market_mood_keeps_partial_failures_explicit(monkeypatch):
    monkeypatch.setitem(mood._UNIVERSES, "Europe", {
        "label": "Test basket", "benchmark": "Test", "symbols": ("SAP.DE", "AIR.PA"),
    })

    def fake_bars(symbol, range_, interval):
        if symbol == "AIR.PA":
            raise RuntimeError("quota")
        return _series([10, 11])

    monkeypatch.setattr(mood, "get_bars", fake_bars)
    result = mood.get_market_mood("Europe")

    assert result["breadth"]["available"] == 1
    assert result["breadth"]["unavailable"] == 1
    assert result["gaps"] == [{"symbol": "AIR.PA", "message": "quota"}]


def test_euro_stoxx_universe_has_50_unique_current_symbols():
    symbols = mood._UNIVERSES["Europe"]["symbols"]
    assert len(symbols) == len(set(symbols)) == 50
    assert {"AD.AS", "BN.PA", "DB1.DE", "SGO.PA", "VOW.DE", "WKL.AS"}.issubset(symbols)
    assert {"FLTR.IR", "KER.PA", "VNA.DE", "RI.PA", "VOW3.DE"}.isdisjoint(symbols)
