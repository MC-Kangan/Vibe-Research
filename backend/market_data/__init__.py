"""Public entry points for normalized Europe/UK market data."""

from .models import (
    InstrumentNotFoundError,
    MarketDataError,
    ProviderError,
    ProviderConfigurationError,
    ProviderTimeoutError,
    UnsupportedSymbolError,
)
from .finnhub import get_company_news, get_earnings
from .benchmarks import get_benchmarks
from .sec import get_company_facts, get_filings
from .service import get_bars, get_snapshot, resolve_symbol

__all__ = [
    "InstrumentNotFoundError",
    "MarketDataError",
    "ProviderError",
    "ProviderConfigurationError",
    "ProviderTimeoutError",
    "UnsupportedSymbolError",
    "get_bars",
    "get_benchmarks",
    "get_company_facts",
    "get_company_news",
    "get_earnings",
    "get_filings",
    "get_snapshot",
    "resolve_symbol",
]
