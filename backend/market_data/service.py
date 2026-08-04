"""Symbol resolution and the Yahoo-backed US/Europe service boundary."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from .models import (
    EXCHANGES,
    HistoricalSeries,
    InstrumentIdentity,
    InstrumentSnapshot,
    MarketDataProvider,
    ResolvedSymbol,
    UnsupportedSymbolError,
    US_EXCHANGE,
)
from .yahoo import YahooProvider

_EU_SUFFIX_PATTERN = "|".join(re.escape(suffix[1:]) for suffix in sorted(EXCHANGES, key=len, reverse=True))
_EU_SYMBOL_RE = re.compile(rf"^[A-Z0-9][A-Z0-9-]{{0,18}}(\.(?:{_EU_SUFFIX_PATTERN}))$")
_US_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9-]{0,9}$")
_US_CLASS_SYMBOL_RE = re.compile(r"^([A-Z][A-Z0-9]{0,8})\.([A-Z])$")
_RANGES = {"1mo", "3mo", "6mo", "1y", "2y"}


def resolve_symbol(symbol: str) -> ResolvedSymbol:
    normalized = (symbol or "").strip().upper()
    match = _EU_SYMBOL_RE.fullmatch(normalized)
    if match:
        suffix = match.group(1)
        return ResolvedSymbol(normalized.removesuffix(suffix), normalized, EXCHANGES[suffix])

    class_match = _US_CLASS_SYMBOL_RE.fullmatch(normalized)
    if class_match:
        normalized = f"{class_match.group(1)}-{class_match.group(2)}"
    if _US_SYMBOL_RE.fullmatch(normalized):
        return ResolvedSymbol(normalized, normalized, US_EXCHANGE)

    raise UnsupportedSymbolError(
        "请输入美股代码（如 AAPL、BRK-B）或带交易所后缀的欧洲代码（如 VOD.L、SAP.DE、ASML.AS）"
    )


def _identity_for(resolved: ResolvedSymbol, snapshot: InstrumentSnapshot) -> InstrumentIdentity:
    """Use snapshot metadata while keeping exchange identity owned by our allowlist."""
    item = snapshot.instrument
    return InstrumentIdentity(
        instrument_id=f"equity:{resolved.exchange.mic}:{resolved.local_symbol}",
        asset_type="equity",
        symbol=resolved.local_symbol,
        provider_symbol=resolved.provider_symbol,
        name=item.name,
        exchange=item.exchange if resolved.exchange.country == "US" and item.exchange else resolved.exchange.name,
        mic=resolved.exchange.mic,
        country=resolved.exchange.country,
        currency=item.currency,
        timezone=item.timezone,
    )


class MarketDataService:
    def __init__(self, provider: MarketDataProvider | None = None):
        self.provider = provider or YahooProvider()

    def snapshot(self, symbol: str) -> InstrumentSnapshot:
        resolved = resolve_symbol(symbol)
        snapshot = self.provider.snapshot(resolved.provider_symbol)
        return InstrumentSnapshot(_identity_for(resolved, snapshot), snapshot.quote)

    def bars(self, symbol: str, range_: str = "1y", interval: str = "1d") -> HistoricalSeries:
        resolved = resolve_symbol(symbol)
        if range_ not in _RANGES:
            raise UnsupportedSymbolError("range 仅支持 1mo、3mo、6mo、1y、2y")
        if interval != "1d":
            raise UnsupportedSymbolError("interval 目前仅支持 1d")
        bars = self.provider.bars(resolved.provider_symbol, range_, interval)
        return HistoricalSeries(
            provider_symbol=resolved.provider_symbol,
            range=range_,
            interval=interval,
            source=getattr(self.provider, "source", "unknown"),
            fetched_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            bars=bars,
        )


service = MarketDataService()


def get_snapshot(symbol: str) -> InstrumentSnapshot:
    return service.snapshot(symbol)


def get_bars(symbol: str, range_: str = "1y", interval: str = "1d") -> HistoricalSeries:
    return service.bars(symbol, range_, interval)
