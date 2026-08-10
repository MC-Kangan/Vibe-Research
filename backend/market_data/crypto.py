"""Canonical crypto symbol resolution and normalized service boundary."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from .coinbase import CoinbaseProvider
from .models import HistoricalSeries, InstrumentSnapshot, UnsupportedSymbolError

_CRYPTO_RE = re.compile(r"^[A-Z0-9]{2,12}$")
_RANGES = {"1mo", "3mo", "6mo", "1y", "2y"}


def resolve_crypto_symbol(symbol: str) -> str:
    value = (symbol or "").strip().upper()
    if value.endswith("-USD"):
        value = value[:-4]
    if not _CRYPTO_RE.fullmatch(value):
        raise UnsupportedSymbolError("请输入加密货币代码，如 BTC、ETH、SOL 或 BTC-USD")
    return f"{value}-USD"


class CryptoMarketDataService:
    def __init__(self, provider: CoinbaseProvider | None = None):
        self.provider = provider or CoinbaseProvider()

    def snapshot(self, symbol: str) -> InstrumentSnapshot:
        return self.provider.snapshot(resolve_crypto_symbol(symbol))

    def bars(self, symbol: str, range_: str = "1y", interval: str = "1d") -> HistoricalSeries:
        if range_ not in _RANGES:
            raise UnsupportedSymbolError("range 仅支持 1mo、3mo、6mo、1y、2y")
        if interval != "1d":
            raise UnsupportedSymbolError("interval 目前仅支持 1d")
        product_id = resolve_crypto_symbol(symbol)
        rows = self.provider.bars(product_id, range_, interval)
        return HistoricalSeries(
            provider_symbol=product_id,
            range=range_,
            interval=interval,
            source=self.provider.source,
            fetched_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            bars=rows,
        )


service = CryptoMarketDataService()
