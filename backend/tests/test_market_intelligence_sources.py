"""Offline contracts for SEC EDGAR and optional Finnhub sources."""

from __future__ import annotations

import pytest

from market_data.finnhub import FinnhubProvider
from market_data.models import ProviderConfigurationError, UnsupportedSymbolError
from market_data.sec import SecEdgarProvider


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self.payload = payload
        self.status_code = status_code

    def json(self):
        return self.payload


class RoutedHttp:
    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return FakeResponse(next(payload for marker, payload in self.routes if marker in url))


@pytest.fixture(autouse=True)
def clear_sec_ticker_cache():
    SecEdgarProvider._ticker_cache = None
    yield
    SecEdgarProvider._ticker_cache = None


def test_finnhub_requires_server_side_key():
    with pytest.raises(ProviderConfigurationError):
        FinnhubProvider(api_key="").company_news("AAPL")


def test_finnhub_news_normalizes_and_sends_token():
    http = RoutedHttp([("company-news", [{
        "headline": "Apple update", "summary": "Summary", "source": "Wire",
        "datetime": 1785772800, "url": "https://example.test/news", "category": "company",
    }])])
    result = FinnhubProvider(http=http, api_key="trial-key").company_news("aapl", limit=1)
    assert result["symbol"] == "AAPL"
    assert result["items"][0]["headline"] == "Apple update"
    assert http.calls[0][1]["params"]["token"] == "trial-key"


def test_finnhub_earnings_preserves_actual_estimate_and_surprise():
    http = RoutedHttp([("stock/earnings", [{
        "period": "2026-06-30", "quarter": 3, "year": 2026,
        "actual": 1.4, "estimate": 1.35, "surprise": 0.05, "surprisePercent": 3.7,
    }])])
    item = FinnhubProvider(http=http, api_key="trial-key").earnings("AAPL")["items"][0]
    assert item == {
        "period": "2026-06-30", "quarter": 3, "year": 2026,
        "actual": 1.4, "estimate": 1.35, "surprise": 0.05, "surprise_pct": 3.7,
    }


def test_sec_filings_resolve_cik_and_build_authoritative_document_url():
    http = RoutedHttp([
        ("company_tickers", {"0": {"ticker": "AAPL", "cik_str": 320193, "title": "Apple Inc."}}),
        ("submissions", {"name": "Apple Inc.", "filings": {"recent": {
            "accessionNumber": ["0000320193-26-000001"], "filingDate": ["2026-08-01"],
            "reportDate": ["2026-06-30"], "acceptanceDateTime": ["20260801120000"],
            "form": ["10-Q"], "primaryDocument": ["aapl-20260630.htm"],
            "primaryDocDescription": ["Quarterly report"],
        }}}),
    ])
    result = SecEdgarProvider(http=http, user_agent="Test test@example.com").filings("AAPL")
    filing = result["items"][0]
    assert result["cik"] == "0000320193"
    assert filing["form"] == "10-Q"
    assert filing["url"] == "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-20260630.htm"
    assert http.calls[0][1]["headers"]["User-Agent"] == "Test test@example.com"


def test_sec_companyfacts_selects_latest_observation():
    http = RoutedHttp([
        ("company_tickers", {"0": {"ticker": "AAPL", "cik_str": 320193}}),
        ("companyfacts", {"entityName": "Apple Inc.", "facts": {"us-gaap": {
            "NetIncomeLoss": {"label": "Net income", "units": {"USD": [
                {"end": "2025-09-30", "filed": "2025-11-01", "form": "10-K", "val": 90},
                {"end": "2026-06-30", "filed": "2026-08-01", "form": "10-Q", "val": 25},
            ]}},
        }}}),
    ])
    result = SecEdgarProvider(http=http, user_agent="Test test@example.com").company_facts("AAPL")
    assert result["facts"]["net_income"]["val"] == 25
    assert result["facts"]["net_income"]["unit"] == "USD"


def test_sec_rejects_european_symbol_before_filing_lookup():
    provider = SecEdgarProvider(http=RoutedHttp([]))
    with pytest.raises(UnsupportedSymbolError):
        provider.filings("SAP.DE")


def test_sec_requires_contact_user_agent_before_network_request():
    with pytest.raises(ProviderConfigurationError):
        SecEdgarProvider(http=RoutedHttp([]), user_agent="").filings("AAPL")
