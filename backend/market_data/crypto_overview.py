"""Crypto daily-review overview composed from CoinGecko and Coinbase."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

from . import coingecko
from .crypto import service as crypto_service
from .models import MarketDataError

_STABLE_IDS = {
    "tether", "usd-coin", "dai", "first-digital-usd", "paypal-usd", "usds",
    "true-usd", "frax", "usdd", "ethena-usde", "usdb", "gusd",
}
_WRAPPED_MARKERS = ("wrapped ", "bridged ", "staked ", "liquid staked")


def _eligible(row: dict[str, Any]) -> bool:
    coin_id = str(row.get("id") or "").lower()
    name = str(row.get("name") or "").lower()
    symbol = str(row.get("symbol") or "").lower()
    if coin_id in _STABLE_IDS or symbol in {"usdt", "usdc", "dai", "usde", "usds", "fdusd", "tusd"}:
        return False
    return not any(marker in name for marker in _WRAPPED_MARKERS)


def _universe(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bitcoin = next((row for row in rows if row.get("id") == "bitcoin"), None)
    alts = [row for row in rows if row.get("id") != "bitcoin" and _eligible(row)][:20]
    return ([bitcoin] if bitcoin else []) + alts


def _priced(row: dict[str, Any]) -> dict[str, Any]:
    symbol = str(row.get("symbol") or "").upper()
    item = {
        "id": row.get("id"), "symbol": symbol, "name": row.get("name"),
        "rank": row.get("market_cap_rank"), "market_cap": row.get("market_cap"),
        "volume_24h": row.get("total_volume"), "change_24h_pct": row.get("price_change_percentage_24h"),
        "circulating_supply": row.get("circulating_supply"), "ath": row.get("ath"),
        "coinbase_available": False, "price": None, "price_currency": "USD", "price_source": None,
    }
    try:
        snapshot = crypto_service.snapshot(symbol)
        item.update({"coinbase_available": True, "price": snapshot.quote.price, "price_source": snapshot.quote.source})
    except MarketDataError:
        pass
    return item


def get_crypto_overview() -> dict[str, Any]:
    fetched_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    gaps: list[str] = []
    try:
        rows = coingecko.top_markets()
        global_data = coingecko.global_market()
    except MarketDataError as exc:
        rows, global_data = [], {}
        gaps.append(str(exc))

    selected = _universe(rows)
    leaders: list[dict[str, Any]] = []
    if selected:
        with ThreadPoolExecutor(max_workers=6) as executor:
            futures = [executor.submit(_priced, row) for row in selected]
            for future in as_completed(futures):
                leaders.append(future.result())
        leaders.sort(key=lambda row: row.get("rank") or 9999)
    else:
        for symbol in ("BTC", "ETH"):
            try:
                snapshot = crypto_service.snapshot(symbol)
                leaders.append({
                    "id": symbol.lower(), "symbol": symbol, "name": snapshot.instrument.name,
                    "rank": None, "market_cap": None, "volume_24h": None, "change_24h_pct": None,
                    "circulating_supply": None, "ath": None, "coinbase_available": True,
                    "price": snapshot.quote.price, "price_currency": "USD", "price_source": "coinbase",
                })
            except MarketDataError as exc:
                gaps.append(f"{symbol}: {exc}")

    changes = [row["change_24h_pct"] for row in leaders if isinstance(row.get("change_24h_pct"), (int, float))]
    market_caps = global_data.get("total_market_cap", {}) if isinstance(global_data.get("total_market_cap"), dict) else {}
    volumes = global_data.get("total_volume", {}) if isinstance(global_data.get("total_volume"), dict) else {}
    dominance = global_data.get("market_cap_percentage", {}) if isinstance(global_data.get("market_cap_percentage"), dict) else {}
    return {
        "fetched_at": fetched_at,
        "sources": {"prices": "coinbase", "market_metadata": "coingecko" if rows else None, "market_metadata_stale": coingecko.stale()},
        "global": {
            "total_market_cap_usd": market_caps.get("usd"),
            "total_volume_24h_usd": volumes.get("usd"),
            "market_cap_change_24h_pct": global_data.get("market_cap_change_percentage_24h_usd"),
            "btc_dominance_pct": dominance.get("btc"),
            "eth_dominance_pct": dominance.get("eth"),
        },
        "breadth": {
            "total": len(changes),
            "up": sum(value > 0 for value in changes),
            "down": sum(value < 0 for value in changes),
            "flat": sum(value == 0 for value in changes),
        },
        "assets": leaders,
        "gaps": list(dict.fromkeys(gaps)),
    }


def get_crypto_asset_context(symbol: str) -> dict[str, Any]:
    target = symbol.strip().upper().removesuffix("-USD")
    gaps: list[str] = []
    try:
        rows = coingecko.top_markets()
        global_data = coingecko.global_market()
    except MarketDataError as exc:
        rows, global_data = [], {}
        gaps.append(str(exc))
    source_row = next((row for row in rows if str(row.get("symbol") or "").upper() == target), None)
    item = _priced(source_row) if source_row else None
    market_caps = global_data.get("total_market_cap", {}) if isinstance(global_data.get("total_market_cap"), dict) else {}
    volumes = global_data.get("total_volume", {}) if isinstance(global_data.get("total_volume"), dict) else {}
    dominance = global_data.get("market_cap_percentage", {}) if isinstance(global_data.get("market_cap_percentage"), dict) else {}
    return {
        "symbol": target,
        "source": "coingecko" if rows else None,
        "market": item,
        "global": {
            "total_market_cap_usd": market_caps.get("usd"),
            "total_volume_24h_usd": volumes.get("usd"),
            "market_cap_change_24h_pct": global_data.get("market_cap_change_percentage_24h_usd"),
            "btc_dominance_pct": dominance.get("btc"),
            "eth_dominance_pct": dominance.get("eth"),
        },
        "gaps": gaps,
    }
