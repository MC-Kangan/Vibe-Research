"""Optional Finnhub trial adapter for company news and earnings."""

from __future__ import annotations

import os
from datetime import UTC, date, datetime, timedelta
from urllib.parse import urlparse

import requests

from .models import (
    CompanyNewsFeed,
    CompanyNewsItem,
    ProviderConfigurationError,
    ProviderError,
    ProviderTimeoutError,
)
from .service import resolve_symbol

_BASE_URL = "https://finnhub.io/api/v1"


class FinnhubProvider:
    source = "finnhub"

    def __init__(self, http=None, api_key: str | None = None):
        self.http = http or requests.Session()
        self.api_key = (api_key if api_key is not None else os.environ.get("VR_FINNHUB_API_KEY", "")).strip()

    def _get(self, path: str, params: dict) -> object:
        if not self.api_key:
            raise ProviderConfigurationError("Finnhub 未配置：请设置 VR_FINNHUB_API_KEY（可使用 free trial key）")
        try:
            response = self.http.get(
                f"{_BASE_URL}{path}",
                params={**params, "token": self.api_key},
                headers={"User-Agent": "VibeResearch/0.3"},
                timeout=12,
            )
        except requests.Timeout as exc:
            raise ProviderTimeoutError("Finnhub 请求超时") from exc
        except requests.RequestException as exc:
            raise ProviderError("Finnhub 当前不可达") from exc
        if response.status_code in {401, 403}:
            raise ProviderConfigurationError("Finnhub API key 无效或当前套餐无权访问该端点")
        if response.status_code >= 400:
            raise ProviderError(f"Finnhub 返回 HTTP {response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise ProviderError("Finnhub 返回了无法解析的响应") from exc
        if isinstance(payload, dict) and payload.get("error"):
            raise ProviderError(f"Finnhub: {payload['error']}")
        return payload

    def company_news(self, symbol: str, days: int = 30, limit: int = 20) -> CompanyNewsFeed:
        provider_symbol = resolve_symbol(symbol).provider_symbol
        end = date.today()
        start = end - timedelta(days=max(1, min(days, 365)))
        payload = self._get("/company-news", {
            "symbol": provider_symbol,
            "from": start.isoformat(),
            "to": end.isoformat(),
        })
        rows = payload if isinstance(payload, list) else []
        items: list[CompanyNewsItem] = []
        for row in rows[:max(1, min(limit, 50))]:
            if not isinstance(row, dict) or not str(row.get("headline") or "").strip():
                continue
            published_at = None
            try:
                published_at = datetime.fromtimestamp(float(row["datetime"]), UTC).isoformat().replace("+00:00", "Z")
            except (KeyError, TypeError, ValueError, OverflowError):
                pass
            raw_url = str(row.get("url") or "").strip()
            items.append(CompanyNewsItem(
                headline=str(row["headline"]).strip(),
                summary=str(row["summary"]).strip() if row.get("summary") else None,
                publisher=str(row["source"]).strip() if row.get("source") else None,
                published_at=published_at,
                url=raw_url if urlparse(raw_url).scheme in {"http", "https"} else None,
                category=str(row["category"]).strip() if row.get("category") else None,
            ))
        return CompanyNewsFeed(symbol=provider_symbol, source=self.source, items=tuple(items))

    def earnings(self, symbol: str, limit: int = 12) -> dict:
        provider_symbol = resolve_symbol(symbol).provider_symbol
        payload = self._get("/stock/earnings", {"symbol": provider_symbol})
        rows = payload if isinstance(payload, list) else []
        items = [{
            "period": row.get("period"),
            "quarter": row.get("quarter"),
            "year": row.get("year"),
            "actual": row.get("actual"),
            "estimate": row.get("estimate"),
            "surprise": row.get("surprise"),
            "surprise_pct": row.get("surprisePercent"),
        } for row in rows[:max(1, min(limit, 30))] if isinstance(row, dict)]
        return {"symbol": provider_symbol, "source": self.source, "items": items}


def get_earnings(symbol: str, limit: int = 12) -> dict:
    return FinnhubProvider().earnings(symbol, limit)
