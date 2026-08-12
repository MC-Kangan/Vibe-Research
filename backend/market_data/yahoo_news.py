"""No-key Yahoo Search adapter for best-effort company-news fallback."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import requests

from .models import CompanyNewsFeed, CompanyNewsItem, ProviderError, ProviderTimeoutError
from .service import resolve_symbol

_SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search"


def _safe_url(value: object) -> str | None:
    url = str(value or "").strip()
    return url if urlparse(url).scheme in {"http", "https"} else None


class YahooNewsProvider:
    source = "yahoo-search"

    def __init__(self, http=None):
        self.http = http or requests.Session()

    def company_news(self, symbol: str, days: int = 30, limit: int = 20) -> CompanyNewsFeed:
        provider_symbol = resolve_symbol(symbol).provider_symbol
        count = max(1, min(limit, 50))
        try:
            response = self.http.get(
                _SEARCH_URL,
                params={
                    "q": provider_symbol,
                    "quotesCount": 0,
                    "newsCount": min(50, max(count * 2, 10)),
                    "enableFuzzyQuery": "false",
                    "region": "US",
                    "lang": "en-US",
                },
                headers={"User-Agent": "Mozilla/5.0 VibeResearch/0.3"},
                timeout=12,
            )
        except requests.Timeout as exc:
            raise ProviderTimeoutError("Yahoo company news timed out") from exc
        except requests.RequestException as exc:
            raise ProviderError("Yahoo company news is unavailable") from exc
        if response.status_code >= 400:
            raise ProviderError(f"Yahoo company news returned HTTP {response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise ProviderError("Yahoo company news returned invalid JSON") from exc

        cutoff = datetime.now(UTC) - timedelta(days=max(1, min(days, 365)))
        items: list[CompanyNewsItem] = []
        for row in payload.get("news", []) if isinstance(payload, dict) else []:
            if not isinstance(row, dict) or not str(row.get("title") or "").strip():
                continue
            related = row.get("relatedTickers")
            if isinstance(related, list) and related and provider_symbol not in related:
                continue
            try:
                published = datetime.fromtimestamp(float(row["providerPublishTime"]), UTC)
            except (KeyError, TypeError, ValueError, OverflowError):
                published = None
            if published is not None and published < cutoff:
                continue
            items.append(CompanyNewsItem(
                headline=str(row["title"]).strip(),
                summary=None,
                publisher=str(row.get("publisher") or "Yahoo Finance"),
                published_at=published.isoformat().replace("+00:00", "Z") if published else None,
                url=_safe_url(row.get("link")),
                category="company",
            ))
            if len(items) >= count:
                break
        return CompanyNewsFeed(symbol=provider_symbol, source=self.source, items=tuple(items))
