# Europe and UK Market Data — Slice 1 Implementation Plan

## Implementation status — 4 August 2026

Slice 1 is implemented. The delivered code follows the rollback boundary in this plan:

- Added `backend/market_data` with normalized models, an explicit five-exchange resolver, a small service boundary, and a Yahoo chart adapter.
- Added authenticated `/api/market-data/snapshot` and `/api/market-data/bars` routes without changing existing endpoint contracts.
- Added the explicit European-symbol branch, typed API client, normalized quote view, and ECharts daily price/volume chart to the existing stock-data page.
- Added offline coverage for exchange mapping, canonical identity, `GBp` conversion, missing values, symbol mismatch, error mapping, API envelopes, authentication, frontend routing, and currency formatting.
- Verified live data for `VOD.L`, `SAP.DE`, `ASML.AS`, `MC.PA`, and `NESN.SW` on 4 August 2026.
- Regression-smoked the unchanged `600519`, `AAPL`, `00700`, and `005930.KS` paths on the same date.

Verification at delivery: 106 backend offline tests passed, 20 frontend tests passed, and the production frontend build passed. The build retains the repository's existing ECharts chunk-size warning; this slice adds no dependency and does not make that warning a release blocker.

## Objective

Add a small, maintainable European and UK market-data path that allows the stock-data page to open the following native listings:

- `VOD.L` — Vodafone, London
- `SAP.DE` — SAP, Xetra/Germany
- `ASML.AS` — ASML, Amsterdam
- `MC.PA` — LVMH, Paris
- `NESN.SW` — Nestlé, Switzerland

For each instrument, the first slice will provide:

- Normalized instrument identity
- Company name and local symbol
- Exchange and MIC
- Country
- Trading currency and price unit
- Current/delayed quote metadata available from the provider
- Historical daily OHLCV bars
- Provider and observation timestamps
- A stock-data page view consistent with the existing visual design

The implementation must preserve all existing A-share, US, Hong Kong, and Korean behaviour.

## Design principles

1. **Do not rewrite working integrations.** Existing A-share and `gstock.py` paths remain in place.
2. **Activate the new path only for explicit supported European suffixes.** Existing market-detection behaviour remains the fallback.
3. **Add only the provider boundary needed by this slice.** Do not build a general market-data platform prematurely.
4. **Keep provider identifiers out of frontend state where practical.** Return a canonical exchange-qualified identity from the backend.
5. **Treat missing data honestly.** Optional fields remain `null`; the application must not manufacture estimates.
6. **Preserve source attribution.** Every quote and bar response identifies its provider and timestamps.
7. **Keep Bloomberg possible without designing Bloomberg now.** The contract must permit a future provider mapping, but no Bloomberg dependency or field catalogue belongs in this slice.
8. **Personal-use boundary.** Yahoo-derived data is for the personal deployment profile and is not assumed suitable for workplace use.

## Explicit non-goals

The first slice will not add:

- Bloomberg integration
- OpenFIGI integration
- General company-name autocomplete
- Full European fundamentals
- European filings or news
- Analyst estimates
- Corporate actions or adjusted-return calculations beyond what the selected chart response supplies
- Intraday bars
- European watchlist support
- European portfolio support
- European bull/bear debate
- European daily-review indices
- Automatic provider failover
- A database or persistent market-data cache
- Changes to the existing A-share endpoints
- Changes to the existing US/HK/KR endpoint contract

These are follow-on slices after the first contract and UI path are proven.

## Existing behaviour that must remain unchanged

The following flows are regression boundaries:

- Six-digit stock-data input continues to use the existing A-share endpoints.
- `AAPL`, `BABA`, `00700`, and `005930.KS` continue to use `/api/global/stock` and `gstock.py`.
- `/api/global/indices` remains unchanged.
- The A-share portfolio, watchlist, debate, reports, news, market overview, and AI tools remain unchanged.
- Existing frontend tests and production build continue to pass.
- Existing API paths remain available with the same response shapes.
- The pre-existing `frontend/package-lock.json` modification is not overwritten or normalized as part of this work.

## Narrow architecture

Add one new backend package:

```text
backend/market_data/
  __init__.py
  models.py
  service.py
  yahoo.py
```

Responsibilities:

- `models.py`: normalized response models and supported exchange metadata.
- `yahoo.py`: Yahoo chart request and response parsing only.
- `service.py`: explicit supported-symbol resolution and calls into the provider.
- `__init__.py`: small public exports.

Do not add a separate registry, dependency-injection framework, plugin loader, provider configuration language, or persistence layer in this slice.

`service.py` should expose a deliberately small internal interface that a future Bloomberg implementation can also satisfy:

```python
class MarketDataProvider(Protocol):
    def snapshot(self, provider_symbol: str) -> InstrumentSnapshot: ...
    def bars(self, provider_symbol: str, range_: str, interval: str) -> list[HistoricalBar]: ...
```

Only `YahooProvider` will implement it initially. The protocol exists to prevent route and UI code from importing Yahoo parsing details directly.

## Supported exchange map

Use an explicit allowlist:

| Input suffix | Exchange | MIC | Country | Expected currency |
|---|---|---|---|---|
| `.L` | London Stock Exchange | `XLON` | GB | GBP/GBp |
| `.DE` | Xetra/Germany | `XETR` | DE | EUR |
| `.AS` | Euronext Amsterdam | `XAMS` | NL | EUR |
| `.PA` | Euronext Paris | `XPAR` | FR | EUR |
| `.SW` | SIX Swiss Exchange | `XSWX` | CH | CHF |

The table is intentionally small. Add another exchange only with a fixture and a verified example.

The resolver must:

- Trim whitespace.
- Convert the input to uppercase.
- Require a supported suffix.
- Reject malformed symbols.
- Preserve hyphens used by valid local symbols when support is later added.
- Produce a canonical ID such as `equity:XLON:VOD`.

Bare symbols such as `VOD` must not be silently interpreted as London listings because the same ticker may identify a US ADR or a different instrument.

## Normalized models

### Instrument identity

```json
{
  "instrument_id": "equity:XLON:VOD",
  "asset_type": "equity",
  "symbol": "VOD",
  "provider_symbol": "VOD.L",
  "name": "Vodafone Group Plc",
  "exchange": "London Stock Exchange",
  "mic": "XLON",
  "country": "GB",
  "currency": "GBP",
  "timezone": "Europe/London"
}
```

The initial `instrument_id` is deterministic and human-readable. A future FIGI, ISIN, or Bloomberg security string can be added as an identifier mapping without changing this ID format during the first slice.

### Quote

```json
{
  "price": 1.1725,
  "open": 1.1785,
  "high": 1.1965,
  "low": 1.1725,
  "previous_close": 1.1785,
  "change_pct": -0.51,
  "currency": "GBP",
  "source_price": 117.25,
  "source_price_unit": "GBp",
  "price_scale": 0.01,
  "market_state": null,
  "observed_at": "ISO-8601 timestamp or null",
  "fetched_at": "ISO-8601 timestamp",
  "delay_seconds": null,
  "source": "yahoo"
}
```

Rules:

- Normalize Yahoo `GBp` to `GBP` using a `0.01` scale.
- Preserve the provider-native price and unit for auditability.
- Do not infer whether a quote is live when the provider does not state it reliably.
- Calculate `change_pct` only when current and previous-close values are present and previous close is non-zero.
- Keep unavailable values as `null`.

### Historical bars

```json
{
  "date": "2026-08-03",
  "open": 1.15,
  "high": 1.18,
  "low": 1.14,
  "close": 1.17,
  "adjusted_close": 1.17,
  "volume": 123456,
  "currency": "GBP"
}
```

Apply the same UK pence-to-pound scale to every price field. Preserve date order ascending. Drop provider rows without a timestamp; retain rows with partial OHLC values by using `null` fields rather than zero.

## Backend API

Add two endpoints without changing existing routes:

```text
GET /api/market-data/snapshot?symbol=VOD.L
GET /api/market-data/bars?symbol=VOD.L&range=1y&interval=1d
```

First-slice parameter limits:

- `symbol`: 1–24 characters
- `range`: `1mo`, `3mo`, `6mo`, `1y`, `2y`, default `1y`
- `interval`: `1d` only

Error behaviour:

- `400`: malformed or unsupported exchange suffix
- `404`: provider reports no instrument/data
- `502`: provider failure or invalid upstream response
- `504`: provider timeout, if distinguished cleanly by the HTTP client

Do not expose upstream exception text or URLs to the frontend.

The response should use the application's existing `{ "data": ... }` envelope.

## Yahoo provider implementation

Use the chart endpoint already documented in the bundled `global-stock-data` toolkit:

```text
https://query1.finance.yahoo.com/v8/finance/chart/{symbol}
```

Implementation constraints:

- Use the existing `requests` dependency.
- Set a normal browser-like user agent.
- Use a finite timeout.
- Use one small request helper shared by snapshot and bars.
- Parse only fields required by the normalized models.
- Validate that returned metadata identifies the requested symbol.
- Do not add cookie/crumb management in this slice.
- Do not use `quoteSummary` in this slice.
- Do not retry indefinitely.
- Do not log full upstream payloads.

One chart request can supply both metadata, latest quote information, and historical bars. The service may reuse one parsed response within a request, but a cross-request caching framework is not required yet.

## Frontend changes

### Market routing

Preserve the current decision order in `StockData.tsx`:

1. Six digits: existing A-share path.
2. Explicit supported European suffix: new market-data path.
3. Everything else: existing US/HK/KR global path.

Extract the supported-suffix check to a small pure helper under `frontend/src/lib` so it can be unit tested and does not grow into another inline regex.

### API types

Add typed models to `frontend/src/lib/api.ts` for:

- European instrument identity
- Normalized quote
- Historical bar
- Snapshot and bar responses

Add:

```text
api.marketSnapshot(symbol)
api.marketBars(symbol, range, interval)
```

Do not alter `GlobalStock` or existing API methods in this slice.

### Stock-data page

Add one European view that reuses:

- `PageHeader`
- `GlassCard`
- Existing colour and typography tokens
- Existing loading and error patterns
- Existing request race guard
- Existing `AskAiButton` only if its context can be populated without changing AI tools

Display:

- Company name
- Local symbol
- Exchange/MIC
- Country
- Price and percentage change
- Open, high, low, previous close
- Currency
- Source and observation/fetch timestamp
- A daily price/volume chart

Avoid duplicating an entire page. Add a focused component such as:

```text
frontend/src/components/market/EuropeanStockView.tsx
frontend/src/components/market/PriceHistoryChart.tsx
```

`StockData.tsx` remains responsible for search state and choosing the appropriate view.

### Chart implementation

Use the existing ECharts dependency.

The first chart should contain:

- Daily candlesticks
- Volume
- Responsive resize handling
- Loading, empty, and error states
- No technical indicators yet
- No new charting dependency

Dispose of the ECharts instance on unmount and update it when instrument data changes.

### AI context

If enabled in this slice, pass only available normalized facts:

- Instrument identity
- Quote and currency
- Selected-period price return
- Period high/low
- Data source and timestamp

Do not tell the model that European fundamentals, filings, or news were checked when they were not.

Do not add a new AI tool in this slice. Provider-aware AI tool calls belong in a later migration.

## Tests

### Backend unit tests

Use saved minimal fixtures or monkeypatched HTTP responses. Tests must not require live internet access.

Cover:

1. `VOD.L` resolves to `equity:XLON:VOD`.
2. Each supported suffix maps to the correct MIC, country, and expected currency.
3. Bare `VOD` is rejected by the European resolver.
4. Unsupported suffixes are rejected.
5. Yahoo symbol mismatch is rejected.
6. `GBp` quote fields are scaled to `GBP` exactly once.
7. `GBp` historical OHLC and adjusted close are scaled consistently.
8. EUR, CHF, and other unit prices are not scaled.
9. Missing quote fields remain `null`, not zero.
10. Missing timestamps or empty results produce the correct application error.
11. Bars are returned in ascending order.
12. Provider timeout/failure becomes a controlled API error.

### Backend API tests

Monkeypatch the service and verify:

- Successful snapshot envelope
- Successful bars envelope
- `400`, `404`, and upstream failure mapping
- Existing `/api/global/stock` test behaviour remains unchanged
- Existing `VR_API_KEY` middleware still protects the new `/api/market-data/*` routes

### Frontend tests

Add pure tests for:

- European suffix detection
- Routing precedence: six-digit A-share before other paths
- Currency and unit formatting
- `GBp` is never displayed as a separate portfolio currency after backend normalization

Retain all existing frontend tests.

### Verification commands

Run:

```bash
cd backend
.venv/bin/python -m pytest -m "not live"

cd ../frontend
npm test
npm run build
```

If `pytest` is still missing, install the repository's development requirements in the existing virtual environment before implementation verification. Do not silently skip backend tests.

After offline tests pass, perform an explicit live smoke test for the five agreed symbols. Live tests must remain separate from the default suite.

## Implementation sequence

### Task 1: Lock the contract with tests

- Add normalized model tests.
- Add exchange/suffix mapping tests.
- Add `GBp` normalization tests.
- Add mocked Yahoo response fixtures.
- Confirm tests fail before implementation.

### Task 2: Implement the narrow backend provider path

- Add `backend/market_data` package.
- Implement explicit resolver.
- Implement Yahoo chart parsing.
- Implement normalized snapshot and bars.
- Keep all existing global and A-share modules unchanged.

### Task 3: Add isolated API routes

- Add the two `/api/market-data/*` endpoints.
- Add API error mapping.
- Add API tests, including authentication coverage.

### Task 4: Add frontend types and market detection

- Add pure supported-suffix helper.
- Add API response types and client methods.
- Preserve the current A-share and global branches.

### Task 5: Add the European stock view

- Add quote/identity card.
- Add source/timestamp presentation.
- Add historical price and volume chart.
- Reuse existing styling and loading/error patterns.

### Task 6: Regression and live verification

- Run backend offline tests.
- Run frontend tests and production build.
- Smoke-test the five European symbols.
- Smoke-test `600519`, `AAPL`, `00700`, and `005930.KS`.
- Confirm no existing API response shape changed.

### Task 7: Documentation

- Document supported suffixes and example inputs.
- Label the source and personal-use boundary.
- Document known missing capabilities.
- Record the next suggested slice without implementing it.

## Acceptance criteria

The slice is complete only when:

- All five agreed symbols open successfully in the stock-data page.
- Each shows the correct native exchange, currency, timezone, and normalized identity.
- `VOD.L` prices are displayed in GBP with correct pence conversion.
- Daily history renders without zero-filled missing values.
- Source and timestamp are visible.
- Invalid and unsupported symbols fail clearly.
- Existing A-share, US, HK, and KR stock-data queries still work.
- Existing global-index behaviour remains unchanged.
- Existing portfolio, watchlist, debate, news, reports, and AI behaviour remains unchanged.
- Backend offline tests pass.
- Frontend tests pass.
- Frontend production build passes.
- No new production dependency is added unless implementation proves it unavoidable.
- No credentials, fetched data, or local user data are committed.

## Rollback boundary

The new functionality is isolated behind:

- New `backend/market_data` files
- New `/api/market-data/*` routes
- A new explicit-suffix frontend branch
- New European display components

If rollback is required, removing that branch, the new routes, and the new package restores the previous behaviour without changing existing A-share or global integrations.

## Review checkpoint after Slice 1

Before expanding scope, review:

1. Reliability of Yahoo access from the intended NAS/network.
2. Accuracy of UK price-unit normalization.
3. Whether explicit ticker suffixes are sufficient or autocomplete is now necessary.
4. Whether the next priority is European daily-review indices, watchlists, fundamentals, or debate.
5. Whether the normalized contract is adequate for a future Bloomberg adapter without adding Bloomberg-specific fields to the common model.
