"""Company-news provider chain with explicit degradation and stale-cache fallback."""

from __future__ import annotations

import os
import threading
import time
from datetime import UTC, datetime
from collections.abc import Callable
from typing import Protocol

from .finnhub import FinnhubProvider
from .models import CompanyNewsFeed, MarketDataError, ProviderError
from .service import resolve_symbol
from .yahoo_news import YahooNewsProvider


class CompanyNewsProvider(Protocol):
    def company_news(self, symbol: str, days: int = 30, limit: int = 20) -> CompanyNewsFeed: ...


class CompanyNewsService:
    cache_seconds = 5 * 60
    max_cache_entries = 256

    def __init__(
        self,
        primary: CompanyNewsProvider | None = None,
        fallback: CompanyNewsProvider | None = None,
        primary_configured: Callable[[], bool] | None = None,
    ):
        self.primary = primary or FinnhubProvider()
        self.fallback = fallback or YahooNewsProvider()
        self.primary_configured = primary_configured or (
            lambda: bool(os.environ.get("VR_FINNHUB_API_KEY", "").strip())
        )
        self._cache: dict[
            tuple[str, int, int],
            tuple[float, CompanyNewsFeed, tuple[dict[str, str], ...], str],
        ] = {}
        self._cache_lock = threading.Lock()

    @staticmethod
    def _serialize(
        feed: CompanyNewsFeed,
        *,
        fetched_at: str,
        is_stale: bool,
        gaps: list[dict[str, str]],
    ) -> dict:
        return {
            "symbol": feed.symbol,
            "source": feed.source,
            "items": [
                {
                    "headline": item.headline,
                    "summary": item.summary,
                    "source": item.publisher,
                    "published_at": item.published_at,
                    "url": item.url,
                    "category": item.category,
                }
                for item in feed.items
            ],
            "fetched_at": fetched_at,
            "is_stale": is_stale,
            "gaps": gaps,
        }

    def company_news(self, symbol: str, days: int = 30, limit: int = 20) -> dict:
        provider_symbol = resolve_symbol(symbol).provider_symbol
        days = max(1, min(days, 365))
        limit = max(1, min(limit, 50))
        key = (provider_symbol, days, limit)
        now = time.monotonic()
        with self._cache_lock:
            cached = self._cache.get(key)
        if cached and now - cached[0] < self.cache_seconds:
            return self._serialize(
                cached[1],
                fetched_at=cached[3],
                is_stale=False,
                gaps=list(cached[2]),
            )

        gaps: list[dict[str, str]] = []
        loaders: list[tuple[str, CompanyNewsProvider]] = []
        if self.primary is not None and self.primary_configured():
            loaders.append(("finnhub", self.primary))
        if self.fallback is not None:
            loaders.append(("yahoo-search", self.fallback))

        last_error: MarketDataError | None = None
        for provider_name, provider in loaders:
            try:
                payload = provider.company_news(provider_symbol, days, limit)
            except MarketDataError as exc:
                last_error = exc
                gaps.append({"provider": provider_name, "detail": str(exc)})
                continue
            if not payload.items:
                gaps.append({"provider": provider_name, "detail": "No company news returned"})
                continue
            fetched_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
            with self._cache_lock:
                if len(self._cache) >= self.max_cache_entries and key not in self._cache:
                    oldest_key = min(self._cache, key=lambda item: self._cache[item][0])
                    self._cache.pop(oldest_key)
                self._cache[key] = (now, payload, tuple(gaps), fetched_at)
            return self._serialize(
                payload, fetched_at=fetched_at, is_stale=False, gaps=gaps
            )

        if cached:
            return self._serialize(
                cached[1],
                fetched_at=cached[3],
                is_stale=True,
                gaps=[*cached[2], *gaps],
            )
        if last_error is not None:
            raise last_error
        raise ProviderError("No company-news provider returned data")


service = CompanyNewsService()


def get_company_news(symbol: str, days: int = 30, limit: int = 20) -> dict:
    return service.company_news(symbol, days, limit)
