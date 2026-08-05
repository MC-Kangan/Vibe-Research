# Market Data Source Registry

Last updated: 2026-08-04

This is the living registry for VibeResearch market-data providers. Update the status, coverage notes, and change log whenever a source is added, replaced, or removed. A provider being listed here does not mean every endpoint is licensed or enabled.

## Status Labels

- **Active**: connected in the application and used in normal flows.
- **Trial**: connected behind optional configuration while coverage, quotas, and quality are evaluated.
- **Candidate**: researched but not connected.
- **Gap**: no acceptable provider has been selected yet.

## Current Coverage

| Information | A-share | US stocks | European stocks |
|---|---|---|---|
| Quote and price history | Active: Tencent, Eastmoney, mootdx fallbacks | Active: Yahoo chart | Active: Yahoo chart |
| Fundamentals | Active: Eastmoney and existing A-share feeds | Active: Eastmoney US F10; Active: SEC selected XBRL facts | Gap; Finnhub/FMP/EODHD coverage to be tested |
| Company news | Active: Eastmoney/Baidu-backed application feeds | Trial: Finnhub company news | Trial: Finnhub company news; exchange-by-exchange coverage unverified |
| Earnings actual vs estimate | Active through existing valuation/financial feeds where available | Trial: Finnhub stock earnings | Trial: Finnhub stock earnings; symbol and plan coverage unverified |
| Regulatory filings | Active: Eastmoney announcements | Active: SEC EDGAR submissions and filing links | Gap; filings.xbrl.org is the preferred first candidate |
| Analyst estimates | Active: existing Eastmoney consensus fields and reports | Partial: current Eastmoney US F10 metrics; long-range consensus remains a gap | Gap; evaluate Finnhub or FMP trial coverage |
| Debate dossier | Active | Yahoo + Eastmoney US F10 + SEC + optional Finnhub | Yahoo + optional Finnhub; fundamentals and filings remain explicit gaps |

## Connected Providers

### Yahoo Finance Chart

- Status: **Active** for US and European quotes and daily OHLCV.
- Application module: `backend/market_data/yahoo.py`.
- Authentication: none.
- Notes: personal research use; preserve source attribution and do not treat the unofficial chart endpoint as a contractual production SLA.

### Eastmoney

- Status: **Active** for A-share data and US F10 key metrics.
- US fundamentals dataset currently used: `RPT_USF10_FN_GMAININDICATOR` in `backend/gstock.py`.
- Authentication: none for the currently connected endpoints.
- Notes: US coverage is useful but is not the authoritative US regulatory source.

### SEC EDGAR

- Status: **Active** for US filings and selected XBRL company facts.
- Official developer resources: <https://www.sec.gov/about/developer-resources>
- Connected endpoints:
  - Company ticker-to-CIK map: `https://www.sec.gov/files/company_tickers.json`
  - Submissions: `https://data.sec.gov/submissions/CIK##########.json`
  - Company facts: `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`
- Application module: `backend/market_data/sec.py`.
- Authentication: no API key.
- Configuration: set a descriptive contact value in `VR_SEC_USER_AGENT`, for example `VibeResearch/0.3 your-email@example.com`.
- Notes: SEC data is authoritative for US filings, but XBRL tags and units vary by issuer. The application exposes selected latest facts and keeps Eastmoney metrics as a separate source rather than pretending they are identical.

### Finnhub

- Status: **Trial** for company news and historical earnings/estimate surprises.
- Documentation: <https://finnhub.io/docs/api/quote>
- Connected endpoints: `/company-news` and `/stock/earnings`.
- Application module: `backend/market_data/finnhub.py`.
- Authentication: set `VR_FINNHUB_API_KEY` on the backend. Never place this key in frontend browser storage.
- Notes: free/trial plan access, quotas, history depth, European ticker syntax, and exchange coverage must be validated. Missing or unauthorized data is surfaced as a provider gap and does not block Yahoo prices.

## Evaluated Candidates

| Provider | Potential use | Cost/access posture | Current decision |
|---|---|---|---|
| Financial Modeling Prep | Fundamentals, estimates, earnings, news, SEC filings | API key; free/trial limits vary | Candidate for broader US and European normalized fundamentals after Finnhub trial results. [Quickstart](https://site.financialmodelingprep.com/developer/docs/quickstart), [estimates API](https://intelligence.financialmodelingprep.com/developer/docs/stable/financial-estimates), [GitHub examples](https://github.com/FinancialModelingPrepAPI/Financial-Modeling-Prep-API/blob/master/README.md) |
| EODHD | Global fundamentals, news, exchange reference data | API key; trial/paid | Candidate if European breadth is stronger than Finnhub/FMP. [OpenAPI repository](https://github.com/EodHistoricalData/eodhd-openapi) |
| filings.xbrl.org | European ESEF and UKSEF filings/facts | Free public API | Preferred first candidate for normalized European regulatory filings. [API documentation](https://filings.xbrl.org/docs/api) |
| FCA National Storage Mechanism | UK regulated disclosures and filed documents | Public search/download | Candidate UK primary-source supplement; likely requires issuer mapping and document parsing. [FCA NSM](https://www.fca.org.uk/markets/primary-markets/regulatory-disclosures/national-storage-mechanism) |
| Marketaux | Market and company news | API key; free/trial tier | Candidate news fallback if Finnhub European relevance is weak. [Documentation](https://www.marketaux.com/documentation) |
| Alpha Vantage | Fundamentals, earnings, news sentiment, prices | API key; free tier with tight quotas | Candidate fallback, not preferred as the primary cross-market source. [Documentation](https://www.alphavantage.co/documentation/) |
| Twelve Data | Global symbols, prices, fundamentals depending on plan | API key; free/trial limits | Candidate mainly for symbol/reference and quote coverage. [Documentation](https://twelvedata.com/docs/advanced) |
| OpenFIGI | FIGI/ISIN/ticker identifier mapping | API key optional with lower anonymous limits | Candidate identifier layer for cross-provider mapping. [Documentation](https://www.openfigi.com/api/documentation) |

## Open-source Building Blocks

- [sec-edgar-downloader](https://github.com/jadchaar/sec-edgar-downloader): optional bulk/download workflow for EDGAR documents; not needed for the current JSON endpoints.
- [Arelle](https://github.com/Arelle/Arelle): mature XBRL processor; preferred parser if raw ESEF/UKSEF documents need local validation or extraction.
- [OpenBB](https://github.com/OpenBB-finance/OpenBB): useful reference for provider normalization and adapters; currently too broad to add as a runtime dependency for this focused slice.

## Trial Validation Checklist

Test at least 10 liquid and 5 smaller issuers per exchange before promoting a trial source to Active.

| Check | Pass condition |
|---|---|
| Symbol mapping | Provider symbol resolves to the intended legal issuer and primary listing |
| News relevance | At least 80% of sampled articles concern the issuer, not ticker collisions or generic market news |
| News freshness | Material issuer events appear within an acceptable delay |
| Earnings coverage | Actual, estimate, period, and currency/units are interpretable and consistent |
| Filing completeness | Latest annual, interim/quarterly, and material-event filings are discoverable |
| Rate limits | Daily review plus debate usage fits the trial quota with caching headroom |
| Terms and attribution | Personal/self-hosted use is permitted and required attribution is displayed |
| Failure behavior | Missing key, quota exhaustion, and upstream errors appear as explicit data gaps |

## Configuration

```dotenv
# Optional Finnhub trial key for US/European news and earnings.
VR_FINNHUB_API_KEY=

# Recommended contact identity for SEC fair-access requests.
VR_SEC_USER_AGENT=VibeResearch/0.3 your-email@example.com
```

For Docker/NAS deployments, set these variables in the Compose `.env`; `compose.yaml` passes them only to the backend container.

For local development, export them before starting Uvicorn:

```bash
export VR_FINNHUB_API_KEY="your-trial-key"
export VR_SEC_USER_AGENT="VibeResearch/0.3 your-email@example.com"
cd backend && .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8900
```

## Known Gaps and Next Steps

1. Measure Finnhub news and earnings coverage across LSE, Xetra, Euronext, SIX, and Nordic listings.
2. Prototype `filings.xbrl.org` issuer mapping and fact normalization for Europe, using Arelle only when document-level parsing is required.
3. Trial FMP and EODHD on the same issuer basket for European fundamentals and analyst estimates.
4. Add a canonical identifier table (ticker, MIC, ISIN, CIK, LEI) before combining facts from multiple vendors.
5. Add caching and quota telemetry before enabling trial feeds in scheduled bulk refreshes.

## Change Log

- **2026-08-04**: Created registry. Connected SEC EDGAR filings/companyfacts and optional Finnhub trial news/earnings. Retained Yahoo for US/European prices and Eastmoney US F10 for existing key metrics.
- **2026-08-05**: Added Yahoo-backed US/European headline benchmarks, normalized cross-market watchlist intelligence, and moved A-share market tools below the primary global review.
