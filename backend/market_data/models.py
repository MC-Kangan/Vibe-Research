"""Provider-neutral models for US and European market data."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class Exchange:
    suffix: str
    name: str
    mic: str
    country: str
    expected_currency: str


EXCHANGES: dict[str, Exchange] = {
    ".L": Exchange(".L", "London Stock Exchange", "XLON", "GB", "GBP"),
    ".DE": Exchange(".DE", "Xetra", "XETR", "DE", "EUR"),
    ".F": Exchange(".F", "Frankfurt Stock Exchange", "XFRA", "DE", "EUR"),
    ".AS": Exchange(".AS", "Euronext Amsterdam", "XAMS", "NL", "EUR"),
    ".PA": Exchange(".PA", "Euronext Paris", "XPAR", "FR", "EUR"),
    ".BR": Exchange(".BR", "Euronext Brussels", "XBRU", "BE", "EUR"),
    ".MI": Exchange(".MI", "Borsa Italiana", "XMIL", "IT", "EUR"),
    ".MC": Exchange(".MC", "Bolsa de Madrid", "XMAD", "ES", "EUR"),
    ".LS": Exchange(".LS", "Euronext Lisbon", "XLIS", "PT", "EUR"),
    ".SW": Exchange(".SW", "SIX Swiss Exchange", "XSWX", "CH", "CHF"),
    ".ST": Exchange(".ST", "Nasdaq Stockholm", "XSTO", "SE", "SEK"),
    ".CO": Exchange(".CO", "Nasdaq Copenhagen", "XCSE", "DK", "DKK"),
    ".OL": Exchange(".OL", "Oslo Bors", "XOSL", "NO", "NOK"),
    ".HE": Exchange(".HE", "Nasdaq Helsinki", "XHEL", "FI", "EUR"),
    ".VI": Exchange(".VI", "Vienna Stock Exchange", "XWBO", "AT", "EUR"),
    ".IR": Exchange(".IR", "Euronext Dublin", "XDUB", "IE", "EUR"),
    ".WA": Exchange(".WA", "Warsaw Stock Exchange", "XWAR", "PL", "PLN"),
    ".PR": Exchange(".PR", "Prague Stock Exchange", "XPRA", "CZ", "CZK"),
    ".BD": Exchange(".BD", "Budapest Stock Exchange", "XBUD", "HU", "HUF"),
    ".IS": Exchange(".IS", "Borsa Istanbul", "XIST", "TR", "TRY"),
}

US_EXCHANGE = Exchange("", "US market", "US", "US", "USD")


@dataclass(frozen=True, slots=True)
class ResolvedSymbol:
    local_symbol: str
    provider_symbol: str
    exchange: Exchange


@dataclass(frozen=True, slots=True)
class InstrumentIdentity:
    instrument_id: str
    asset_type: str
    symbol: str
    provider_symbol: str
    name: str
    exchange: str
    mic: str
    country: str
    currency: str
    timezone: str | None
    base_asset: str | None = None
    quote_asset: str | None = None
    capabilities: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class NormalizedQuote:
    price: float | None
    open: float | None
    high: float | None
    low: float | None
    previous_close: float | None
    change_pct: float | None
    currency: str
    source_price: float | None
    source_price_unit: str
    price_scale: float
    market_state: str | None
    observed_at: str | None
    fetched_at: str
    delay_seconds: int | None
    source: str
    is_stale: bool = False


@dataclass(frozen=True, slots=True)
class InstrumentSnapshot:
    instrument: InstrumentIdentity
    quote: NormalizedQuote


@dataclass(frozen=True, slots=True)
class HistoricalBar:
    date: str
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    adjusted_close: float | None
    volume: float | int | None
    currency: str


@dataclass(frozen=True, slots=True)
class HistoricalSeries:
    provider_symbol: str
    range: str
    interval: str
    source: str
    fetched_at: str
    bars: list[HistoricalBar]


class MarketDataProvider(Protocol):
    def snapshot(self, provider_symbol: str) -> InstrumentSnapshot: ...

    def bars(self, provider_symbol: str, range_: str, interval: str) -> list[HistoricalBar]: ...


class MarketDataError(Exception):
    """Base class for errors safe to map to an HTTP status."""


class UnsupportedSymbolError(MarketDataError):
    pass


class InstrumentNotFoundError(MarketDataError):
    pass


class ProviderError(MarketDataError):
    pass


class ProviderTimeoutError(ProviderError):
    pass


class ProviderConfigurationError(ProviderError):
    """An optional provider is available but has not been configured."""
