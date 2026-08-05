"""Offline contracts for the US/Europe-first landing data flows."""

from __future__ import annotations

from types import SimpleNamespace

import market_data.benchmarks as benchmarks
import market_intelligence


def test_benchmark_grid_preserves_product_order_and_partial_gaps(monkeypatch):
    benchmarks._CACHE = None

    def fake_snapshot(symbol):
        if symbol == "^STOXX":
            raise RuntimeError("provider unavailable")
        return SimpleNamespace(quote=SimpleNamespace(
            price=100.0, previous_close=99.0, change_pct=1.01, currency="USD",
            observed_at="2026-08-05T00:00:00Z", delay_seconds=0, source="yahoo",
        ))

    monkeypatch.setattr(benchmarks.YahooProvider, "snapshot", lambda self, symbol: fake_snapshot(symbol))
    result = benchmarks.get_benchmarks()
    assert [item["key"] for item in result["items"]] == [item["key"] for item in benchmarks.BENCHMARKS]
    assert result["items"][0]["available"] is True
    assert result["items"][3]["available"] is False
    assert result["gaps"][0]["key"] == "stoxx600"


def test_intelligence_dispatches_us_and_europe_without_cross_market_fallback(monkeypatch):
    monkeypatch.setattr(market_intelligence.market_data, "get_company_news", lambda symbol, days, limit: {
        "items": [{"headline": f"{symbol} news", "published_at": "2026-08-05", "source": "trial", "url": None, "summary": None, "category": "company"}],
    })
    monkeypatch.setattr(market_intelligence.market_data, "get_earnings", lambda symbol, limit: {
        "items": [{"period": "2026-06-30", "quarter": 2, "year": 2026, "actual": 1.0, "estimate": 0.9, "surprise": 0.1, "surprise_pct": 11.1}],
    })
    result = market_intelligence.collect(["AAPL", "SAP.DE"], ["news", "earnings", "filings"], 2)
    assert {item["market"] for item in result["items"]} == {"US", "EU"}
    assert any(item["symbol"] == "AAPL" and item["kind"] == "earnings" for item in result["items"])
    assert any(gap["symbol"] == "SAP.DE" and gap["reason"] == "unsupported" for gap in result["gaps"])


def test_intelligence_preserves_a_share_feed_and_reports_unsupported_earnings(monkeypatch):
    monkeypatch.setattr(market_intelligence.astock, "announcements", lambda symbol: [
        {"title": "公告", "date": "2026-08-05", "type": "临时公告", "url": "https://example.test"},
    ])
    result = market_intelligence.collect(["600519"], ["filings", "earnings"], 5)
    assert result["items"][0]["market"] == "CN"
    assert result["items"][0]["kind"] == "filings"
    assert result["gaps"][0]["reason"] == "unsupported"


def test_intelligence_normalizes_epoch_timestamps_before_cross_source_sort(monkeypatch):
    monkeypatch.setattr(market_intelligence.market_data, "get_company_news", lambda symbol, days, limit: {
        "items": [{"headline": "newer news", "published_at": 1785945600, "source": "trial", "url": None, "summary": None, "category": "company"}],
    })
    monkeypatch.setattr(market_intelligence.market_data, "get_filings", lambda symbol, limit: {
        "items": [{"primaryDocDescription": "older filing", "filingDate": "2026-08-04", "url": None, "form": "8-K", "reportDate": "2026-08-04"}],
    })

    result = market_intelligence.collect(["AAPL"], ["news", "filings"], 2)

    assert result["items"][0]["title"] == "newer news"
    assert result["items"][0]["published_at"].startswith("2026-08-05T")
