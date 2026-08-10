"""Optional CoinGecko market-wide metadata adapter."""

from __future__ import annotations

import os
import threading
import time
from typing import Any

import requests

from .models import ProviderConfigurationError, ProviderError, ProviderTimeoutError

_LOCK = threading.Lock()
_CACHE: dict[str, tuple[float, Any]] = {}
_STALE: set[str] = set()
_TIMEOUT = 12


def configured() -> bool:
    return bool(os.environ.get("VR_COINGECKO_API_KEY", "").strip())


def _request(path: str, params: dict[str, Any] | None = None) -> Any:
    key = os.environ.get("VR_COINGECKO_API_KEY", "").strip()
    if not key:
        raise ProviderConfigurationError("CoinGecko API key is not configured")
    tier = os.environ.get("VR_COINGECKO_API_TIER", "demo").strip().lower()
    pro = tier == "pro"
    root = "https://pro-api.coingecko.com/api/v3" if pro else "https://api.coingecko.com/api/v3"
    headers = {"x-cg-pro-api-key" if pro else "x-cg-demo-api-key": key}
    try:
        response = requests.get(f"{root}{path}", params=params, headers=headers, timeout=_TIMEOUT)
    except requests.Timeout as exc:
        raise ProviderTimeoutError("CoinGecko request timed out") from exc
    except requests.RequestException as exc:
        raise ProviderError("CoinGecko is unavailable") from exc
    if response.status_code >= 400:
        raise ProviderError(f"CoinGecko returned HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise ProviderError("CoinGecko returned invalid JSON") from exc


def _cached(key: str, ttl: int, loader):
    now = time.time()
    with _LOCK:
        hit = _CACHE.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    try:
        value = loader()
    except (ProviderError, ProviderTimeoutError, ProviderConfigurationError):
        if hit:
            _STALE.add(key)
            return hit[1]
        raise
    with _LOCK:
        _CACHE[key] = (now, value)
        _STALE.discard(key)
    return value


def stale() -> bool:
    return bool(_STALE.intersection({"global", "top-markets"}))


def global_market() -> dict[str, Any]:
    payload = _cached("global", 900, lambda: _request("/global"))
    data = payload.get("data", {}) if isinstance(payload, dict) else {}
    return data if isinstance(data, dict) else {}


def top_markets() -> list[dict[str, Any]]:
    payload = _cached(
        "top-markets",
        900,
        lambda: _request(
            "/coins/markets",
            {
                "vs_currency": "usd",
                "order": "market_cap_desc",
                "per_page": 100,
                "page": 1,
                "sparkline": "false",
                "price_change_percentage": "24h",
            },
        ),
    )
    return [row for row in payload if isinstance(row, dict)] if isinstance(payload, list) else []
