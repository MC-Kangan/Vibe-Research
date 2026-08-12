import market_data
from api.errors import ApiProblem


def validate_stock_symbol(symbol: str) -> str:
    """Return the canonical A-share, US, or explicit European symbol."""
    value = (symbol or "").strip().upper()
    if value.isdigit() and len(value) == 6:
        return value
    try:
        return market_data.resolve_symbol(value).provider_symbol
    except market_data.UnsupportedSymbolError as exc:
        raise ApiProblem(
            400,
            "invalid_stock_symbol",
            "Enter a six-digit A-share symbol, a US ticker, or an exchange-qualified European ticker.",
        ) from exc
