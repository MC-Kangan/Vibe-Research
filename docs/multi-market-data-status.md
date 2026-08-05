# Multi-market stock support

## Supported inputs

- A-shares: six-digit codes such as `600519`.
- US stocks: bare Yahoo tickers such as `AAPL`, `MSFT`, and `BRK-B`; `BRK.B` is normalized to `BRK-B`.
- European stocks: explicit Yahoo exchange suffixes are required, for example `VOD.L`, `SAP.DE`, `ASML.AS`, `MC.PA`, and `NESN.SW`.

European suffixes currently enabled: `.L`, `.DE`, `.F`, `.AS`, `.PA`, `.BR`, `.MI`, `.MC`, `.LS`, `.SW`, `.ST`, `.CO`, `.OL`, `.HE`, `.VI`, `.IR`, `.WA`, `.PR`, `.BD`, and `.IS`.

## Available now

| Feature | A-shares | US | Europe |
|---|---|---|---|
| Stock lookup | Existing full data path | Yahoo quote/history plus existing overseas fundamentals when available | Yahoo quote/history |
| Watchlist and daily-review watched stocks | Yes | Yes | Yes |
| Portfolio and closed positions | Yes, CNY | Yes, USD | Yes, native currency |
| Bull/bear debate | Full A-share dossier | Yahoo + Eastmoney metrics + SEC facts/filings + optional Finnhub events | Yahoo + optional Finnhub events, with fundamentals/filings gaps |
| AI page context | Existing full data | Market-aware context with explicit gaps | Market-aware context with explicit gaps |
| Watchlist filings/news/earnings feed | Yes | SEC/Finnhub normalized feed | Finnhub trial feed; filings gap |
| Landing benchmark priority | Secondary | Primary: S&P 500 and Nasdaq-100 | Primary: EURO STOXX 50, STOXX Europe 600, DAX, SMI |

Portfolio totals are grouped by currency. The app does not add CNY, USD, EUR, GBP, CHF, or other currencies together without an FX source.

## Data sources and gaps

Yahoo chart currently supplies quote metadata and daily OHLCV history for US and European stocks. The pre-existing Eastmoney global-stock adapter may supply key US financial metrics, but it is not treated as guaranteed coverage.

The following sources are still needed for comparable overseas dossiers:

1. Regulatory filings and company announcements: SEC EDGAR is now connected for US stocks; exchange or national regulator feeds are still needed for Europe.
2. Company news: Finnhub trial is now connected for US/Europe; coverage, quotas, and licensing still need validation.
3. Fundamentals: normalized income statement, balance sheet, cash flow, margins, leverage, and per-share history, especially for Europe.
4. Earnings calendar and reported-versus-consensus results.
5. Analyst consensus, forward estimates, valuation history, and peer comparisons.
6. Corporate actions: dividends, splits, buybacks, and material capital events.
7. FX rates if a base-currency portfolio total is desired.

Until these are connected, debate and AI prompts list the missing sections explicitly and must not infer them.
