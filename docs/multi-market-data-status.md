# Multi-market stock support

## Crypto support

- Inputs use an explicit crypto asset mode and accept `BTC`, `ETH`, `SOL`, or canonical Coinbase products such as `BTC-USD`.
- Coinbase public USD spot products provide normalized quotes and UTC daily OHLCV. CoinGecko optionally supplies global market cap, volume, dominance, rankings, supply and ATH context.
- The daily review tracks BTC plus 20 dynamically ranked non-stablecoin altcoins. Assets without Coinbase USD pairs remain visible as coverage gaps.
- Crypto supports shared price charts, technical/Markov skills and bull/bear debate. Traditional company fundamentals, filings and earnings are marked not applicable; on-chain flows and token unlocks remain explicit gaps.
- Coinbase balances use a backend-only View key. Manual wallet rows and CSV imports are stored locally; P&L is shown only when cost basis is supplied.

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
| Landing market overview | Existing full-market breadth, short-term emotion, and sector flows | 50-stock representative basket mood plus Yahoo sector ETF proxies | EURO STOXX 50 basket mood plus Yahoo sector ETF proxies |

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

The landing page uses one market selector, defaulting to the US. It loads the A-share-specific endpoints only after the user selects A-shares. Headline benchmark snapshots and sector ETF proxies come from Yahoo.

## US/European Market Mood

The A-share `市场情绪` and `短线情绪` modules should be translated to international market structure rather than copied literally. Consecutive limit-up boards, seal rates, and failed limit-up rates are specific to the A-share trading regime.

| International measure | Can start with current sources? | Additional source needed for robust coverage? |
|---|---|---|
| Headline index and sector direction | Yes: current Yahoo benchmarks and ETF proxies | No |
| User-watchlist breadth and largest movers | Yes: current normalized quote endpoint | No |
| Representative US / EURO STOXX 50 advance-decline breadth | Yes: cached Yahoo history over transparent 50-stock baskets | Yes for reliable intraday or full-market breadth |
| New 52-week highs/lows and percentage above moving averages | Yes: cached constituent history | Prefer a bulk historical/analytics source at larger scale |
| Top gainers, losers, and most active stocks | US end-of-day candidate: Alpha Vantage; international candidate: Twelve Data | Yes for timely US and European coverage |
| Gap moves, unusual volume, and volatility regime | Partial calculation from OHLCV; index-volatility proxies can be added | Intraday/bulk quotes improve quality materially |
| Trading halts and exchange-status events | No | Yes: exchange or licensed market-status feed |

The implemented first version reports advance/decline breadth, 52-week highs/lows, percentage above 20/50/200-day averages, large movers, and unusual volume. The US view uses a transparent 50-stock large-cap representative basket, not the complete S&P 500. Europe uses a maintained EURO STOXX 50 basket. Results are cached for 15 minutes and are explicitly labelled as daily, sample-based statistics; a bulk provider should replace the per-symbol fetch path before treating them as reliable intraday breadth.

## Future Debate Context

Add an optional user-context area to `多空辩论` with both pasted text and local file upload. User material should enter the dossier as a separately labelled `用户补充材料` section with filename/source, extraction status, and explicit wording that it is user-supplied rather than verified market data. Reuse the existing local-only report storage and document extraction path where practical; set file-size and accepted-format limits before implementation.

## Intelligence Radar Event Probability

`事件概率` is currently a placeholder and contains no A-share, US, or European data. Its intended scope is public probability signals for macro and market events, potentially combining prediction-market probabilities with a macro event calendar. Until a provider and event-to-market mapping are selected, the UI must present it as planned rather than integrated.
