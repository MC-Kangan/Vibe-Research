from __future__ import annotations

from datetime import UTC, datetime

import requests

from market_data.models import CompanyNewsFeed, CompanyNewsItem, ProviderError
from market_data.news import CompanyNewsService
from market_data.yahoo_news import YahooNewsProvider


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


class FakeHttp:
    def __init__(self, payload=None, error=None):
        self.payload = payload
        self.error = error
        self.params = None

    def get(self, _url, **kwargs):
        self.params = kwargs.get("params")
        if self.error:
            raise self.error
        return FakeResponse(self.payload)


def test_yahoo_news_normalizes_and_filters_related_tickers():
    published = int(datetime.now(UTC).timestamp())
    http = FakeHttp(
        {
            "news": [
                {
                    "title": "Apple launches product",
                    "publisher": "Example Wire",
                    "link": "https://example.test/apple",
                    "providerPublishTime": published,
                    "relatedTickers": ["AAPL"],
                },
                {
                    "title": "Unrelated item",
                    "publisher": "Example Wire",
                    "link": "https://example.test/other",
                    "providerPublishTime": published,
                    "relatedTickers": ["MSFT"],
                },
            ]
        }
    )

    result = YahooNewsProvider(http).company_news("AAPL", days=30, limit=10)

    assert result.source == "yahoo-search"
    assert [item.headline for item in result.items] == ["Apple launches product"]
    assert result.items[0].published_at.endswith("Z")
    assert http.params["q"] == "AAPL"


def test_company_news_uses_no_key_fallback_and_reports_primary_gap():
    class Primary:
        def company_news(self, *_args, **_kwargs):
            raise ProviderError("primary unavailable")

    class Fallback:
        def company_news(self, symbol, *_args, **_kwargs):
            return CompanyNewsFeed(symbol, "fallback", (CompanyNewsItem("news", None, None, None, None, None),))

    service = CompanyNewsService(primary=Primary(), fallback=Fallback(), primary_configured=lambda: True)
    result = service.company_news("AAPL", 30, 10)

    assert result["source"] == "fallback"
    assert result["gaps"] == [{"provider": "finnhub", "detail": "primary unavailable"}]
    assert result["is_stale"] is False


def test_company_news_keeps_last_valid_response_on_refresh_failure(monkeypatch):
    class FailingAfterFirst:
        calls = 0

        def company_news(self, symbol, *_args, **_kwargs):
            self.calls += 1
            if self.calls > 1:
                raise ProviderError("refresh failed")
            return CompanyNewsFeed(symbol, "fallback", (CompanyNewsItem("cached", None, None, None, None, None),))

    fallback = FailingAfterFirst()
    service = CompanyNewsService(primary=None, fallback=fallback, primary_configured=lambda: False)
    first = service.company_news("AAPL", 30, 10)
    key = ("AAPL", 30, 10)
    timestamp, cached, gaps, fetched_at = service._cache[key]
    service._cache[key] = (
        timestamp - service.cache_seconds - 1,
        cached,
        gaps,
        fetched_at,
    )

    second = service.company_news("AAPL", 30, 10)

    assert first["items"] == second["items"]
    assert first["fetched_at"] == second["fetched_at"]
    assert second["is_stale"] is True
    assert second["gaps"][-1]["provider"] == "yahoo-search"


def test_yahoo_news_maps_timeout_to_provider_error():
    provider = YahooNewsProvider(FakeHttp(error=requests.Timeout()))

    try:
        provider.company_news("AAPL")
    except ProviderError as exc:
        assert "timed out" in str(exc).lower()
    else:
        raise AssertionError("expected ProviderError")
