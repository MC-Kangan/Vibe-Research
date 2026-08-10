# Vibe-Research Extension Feasibility and Implementation Options

## Purpose

This document consolidates the architecture review and implementation options for extending Vibe-Research for personal use. It covers:

- English and Chinese UI support
- European and UK market support
- Replaceable market-data providers and a future Bloomberg adapter
- European news sources
- AI operation with API keys, local CLI subscriptions, and Claude Code on AWS Bedrock
- Secure deployment of the frontend and backend on a UGREEN DXP4800 Plus NAS
- Remote access with user authentication
- New technical-analysis and portfolio-construction pages

The immediate objective is a safe, maintainable personal-use version. Workplace use, Bloomberg integration, and investment-bank security requirements are later phases with a separate approval and security bar.

## Executive conclusion

All requested changes are technically feasible without rewriting the application.

The frontend is already modular and easy to expand. The principal constraint is not React or FastAPI; it is that Chinese A-share identifiers, payloads, market conventions, and data-provider assumptions appear in multiple backend and frontend areas. European support should therefore begin with a small normalized instrument and market-data layer rather than adding more conditions to the existing A-share modules.

The recommended architectural direction is:

1. Preserve the current React, FastAPI, visual component, and page structure.
2. Introduce canonical instrument identifiers and normalized data contracts.
3. Put existing and future data sources behind provider adapters.
4. Add internationalization without rewriting whole pages.
5. Package the application as production containers for the NAS.
6. Put remote access behind an identity-aware private gateway.
7. Build technical analysis and portfolio analytics on the normalized historical-data layer.

This approach adds clean boundaries around the existing code instead of replacing it.

## Current-state findings

### Application structure

The application consists of:

- A React 19 and TypeScript frontend built with Vite.
- React Router for page routing.
- Tailwind CSS and reusable visual components such as `PageHeader` and `GlassCard`.
- ECharts as the charting library.
- A FastAPI backend exposing endpoints under `/api`.
- Local JSON/file persistence for portfolio holdings and uploaded research reports.
- Data-source modules focused mainly on Chinese, US, Hong Kong, and limited Korean instruments.
- AI paths supporting OpenAI-compatible APIs and selected local command-line clients.

The frontend route table is centralized in `frontend/src/router.tsx`, and sidebar links are a simple array in `frontend/src/components/layout/Layout.tsx`. This makes adding page shells straightforward.

### Existing verification results

At the time of the review:

- All 16 frontend tests passed.
- The frontend production build completed successfully.
- The build emitted a non-blocking large-JavaScript-bundle warning.
- Backend tests could not be run because `pytest` was not installed in the existing `backend/.venv`.
- `frontend/package-lock.json` had a pre-existing local modification. Future work should preserve it until its origin is established.

### Security-review status

A dedicated repository-wide security scan was opened but deliberately deferred because the immediate objective changed to personal-use architecture planning. No completed security assurance should be inferred from this review.

Static inspection found some existing protective measures, including optional API authentication, SSRF-related restrictions in public mode, local storage of portfolio/report data, and explicit handling of CLI subprocesses. These reduce particular risks but do not prove the absence of malicious behaviour, data leakage, dependency risk, or deployment vulnerabilities.

A focused security review remains required before internet-facing or workplace deployment.

## Requirement 1: English and Chinese UI

### Feasibility

High. No framework replacement is required.

The English README does not translate the application itself. UI labels, validation messages, descriptions, AI prompts, formatting locales, and some domain terminology are hard-coded in Chinese across frontend and backend files.

### Recommended implementation

Add a lightweight internationalization layer to the existing React application:

- Introduce a translation library such as `i18next` with `react-i18next`, or a small typed translation module if dependency minimization is preferred.
- Create `en` and `zh-CN` resource files organized by feature rather than one very large file.
- Add a language selector to the application layout or settings page.
- Persist the selected locale locally.
- Replace visible strings incrementally, page by page.
- Move number, currency, percentage, and date formatting behind locale-aware helpers.
- Localize backend error codes in the frontend instead of depending permanently on Chinese backend prose.
- Separate prompts intended for an AI model from text displayed to the user.

English-first bilingual support is practical, but literal translation alone is insufficient. Financial terminology, currency conventions, colour conventions, and market naming should be localized deliberately.

### Minimal-change boundary

Keep page components and layouts. Replace inline text with translation keys and shared formatting helpers. Avoid duplicating entire English and Chinese page trees.

## Requirement 2: European and UK instruments

### Feasibility

High, with moderate-to-substantial data-layer work.

European support is not blocked by the frontend. It is constrained by assumptions distributed through:

- Six-digit A-share validation
- Exchange and market inference
- Watchlists and portfolios
- Trading hours and daily-review logic
- Quote and financial payload shapes
- Debate dossier construction
- Currency and number formatting
- Page-level labels and feature expectations

Trying to extend `gstock.py` or add ticker-regex exceptions in every endpoint would create fragile coupling.

### Recommended market model

Introduce a canonical instrument identifier that is independent of any single provider. For example:

```text
CN:XSHG:600519
US:XNAS:AAPL
GB:XLON:VOD
DE:XETR:SAP
FR:XPAR:MC
```

The exact syntax can be finalized during design, but it should encode at least:

- Region or country
- Exchange/MIC
- Local symbol
- Instrument type when ambiguity exists
- Trading currency

Provider-specific symbols such as Yahoo suffixes or Bloomberg yellow keys should be mappings, not primary database identifiers.

### Normalized contracts

Add provider-neutral models for:

- Instrument search and metadata
- Real-time/delayed quote
- Historical OHLCV bars
- Corporate actions
- Fundamental metrics and reporting periods
- News and announcements
- Market calendars and sessions
- FX rates

Each response should include source, timestamp, currency, exchange, delayed/live status, and unavailable fields explicitly.

### Provider adapters

Define a narrow adapter interface and wrap existing sources rather than rewriting them immediately. A router can choose providers by market and capability:

```text
MarketDataService
  -> AShareProvider
  -> ExistingGlobalProvider
  -> EuropeProvider
  -> BloombergProvider (future)
```

A free personal-use European source can be the first adapter, but its licensing, redistribution limits, latency, coverage, and reliability must be recorded. No free source should be assumed suitable for workplace deployment.

### Feature parity

European instruments can be added to:

- Daily review
- Stock data
- Watchlist
- Portfolio
- Bull/bear debate
- Technical analysis

Not every A-share-specific dataset has a meaningful European equivalent. The UI should display supported capability sections rather than empty or misleading approximations. For example, an instrument may have price history, fundamentals, filings, and news but no equivalent of an A-share dragon-tiger list.

## Requirement 3: Replaceable data sources and future Bloomberg integration

### Feasibility

High if the normalized service and adapter boundary are introduced first. Low if Bloomberg logic is added directly to the current endpoints.

### Recommended implementation

Create:

- A provider interface for each capability.
- A capability registry so the application knows which provider supports which market and dataset.
- Symbol-mapping tables between canonical identifiers and provider identifiers.
- Provider configuration through environment variables or a protected admin configuration file.
- Deterministic routing and fallback rules.
- Source attribution and freshness metadata in every response.
- Provider-specific caching and rate limiting.
- Contract tests using saved fixtures.

The frontend should consume normalized API responses and should not know whether data came from Eastmoney, Yahoo, another European provider, or Bloomberg.

### Workplace boundary

Bloomberg integration should be a separate adapter package or deployment profile. It may require:

- Bloomberg Desktop or Server API access
- An entitled user/session and approved machine
- Internal network routing
- Instrument and field mapping
- Entitlement-aware error handling
- Restrictions on storage, display, redistribution, and derived data
- Employer security and open-source approval

Do not begin Bloomberg integration until the personal-use provider interface is stable and the employer has approved the architecture and data handling.

## Requirement 4: European news sources

### Current approach

The current backend uses a combination of configured news sources and provider-specific fetching. `backend/news_sources.json` holds source configuration used by the news-radar path, while stock-specific news is also obtained through existing market-data modules.

### Feasibility

High. Adding feeds is relatively easy; normalizing, deduplicating, classifying, licensing, and handling unreliable sources are the more important tasks.

### Recommended implementation

Define a normalized news item with:

- Stable source ID
- Publisher
- Headline and optional summary
- Published and fetched timestamps
- URL
- Language
- Region and exchange relevance
- Canonical instrument IDs
- Topic tags
- Source licence/usage note

Then add European sources as explicit adapters or configured feeds. Prioritize official and reusable sources such as exchange announcements, company investor-relations feeds, regulators, central banks, and official statistics. Commercial publishers may prohibit scraping or redistribution even when their pages are publicly readable.

Add URL canonicalization, content-hash deduplication, retry/backoff, source health status, and visible source timestamps.

## Requirement 5: AI functionality and operating modes

### Current behaviour

Without an AI configuration, objective market-data, portfolio, news, reports, and other non-AI features can still operate. AI-dependent features require either:

- An OpenAI-compatible API configuration supplied by the frontend, or
- A supported local CLI provider detected by the backend

AI is used mainly for conversational analysis, page-aware “Ask AI” interactions, bull/bear debate, and reflection/review functions. The user's model configuration is sent with the request; API credentials are not persisted by the backend.

### No-key operation

The application should explicitly label three capability states:

1. Core data mode: no AI configuration required.
2. API mode: model endpoint, model name, and API key supplied by the user.
3. Local/subscription CLI mode: the backend invokes an installed and authenticated CLI.

Pages should degrade gracefully when AI is unavailable and should not make core navigation dependent on an AI key.

### Claude Code through AWS Bedrock

Claude Code can use AWS Bedrock credentials rather than an Anthropic API key when the local Claude environment is configured for Bedrock. The application already has a CLI execution path, so this may be possible through the Claude CLI's headless mode.

However, this should be treated as an execution-provider integration, not assumed to work simply because `claude -p` works interactively. Verify:

- The exact environment variables and AWS credential source
- Region and model configuration
- Whether credentials are available to the backend process/container
- Headless output and streaming behaviour
- Timeout and cancellation handling
- Tool permissions and disabled dangerous tools
- Concurrency limits
- Prompt and data leakage boundaries

For NAS deployment, API mode is simpler. CLI mode introduces subprocess and credential-management risk and should be disabled initially or explicitly allowlisted.

## Requirement 6: UGREEN DXP4800 Plus NAS deployment

**Status (4 August 2026):** The production Docker/Compose topology has been implemented and verified locally, including same-origin proxying, non-root containers, health checks, persistent data across container recreation, and loopback-only publication. See [NAS Deployment Proof](nas-deployment-proof.md). Installation on the physical NAS and authenticated remote access remain pending.

### Feasibility

High.

The DXP4800 Plus supports Docker through UGOS Pro and offers sufficient CPU and memory for the current Vite static frontend, FastAPI backend, scheduled refreshes, and normal personal-use data fetching. The application currently has no production Docker, Compose, Nginx, or Caddy configuration, so deployment packaging must be added.

### Recommended production topology

```text
Authenticated remote device
  -> private identity-aware gateway
  -> HTTPS web service
       -> React static files
       -> /api reverse proxy
            -> FastAPI on private container network
                 -> persistent NAS data volume
                 -> permitted external data/AI services
```

Use a single public-facing application origin. The browser should request both the frontend and `/api` from the same HTTPS hostname. The backend port must not be published directly.

### Deployment artifacts to add

- Backend production Dockerfile
- Frontend multi-stage Dockerfile
- Nginx or Caddy production configuration
- Docker Compose configuration
- Health checks
- Non-root container users
- Persistent data-volume configuration
- Environment variable template for production
- Secret-management guidance
- Backup and restore procedure
- Upgrade and rollback procedure
- Log rotation and resource-limit configuration

The frontend web server must include a React Router fallback to `index.html` for direct navigation to nested routes.

### Persistent data

Set `VR_DATA_DIR` and report storage to explicit mounted NAS paths. Back up these paths independently of source-code and container upgrades.

Do not copy API keys, AWS credentials, uploaded reports, portfolios, or Tailscale authentication material into container images or the Git repository.

## Requirement 7: Remote access and authentication

### Current authentication boundary

The application now has a single-user browser login backed by SQLite. Passwords use
Argon2id, browser sessions are opaque and stored only as hashes, and logout or an
administrative password reset revokes sessions immediately. Secure deployments use a
`__Host-` HttpOnly, Secure, SameSite=Strict cookie. `VR_API_KEY` remains available for
scripts and service-to-service calls and is not the primary browser mechanism.

### Recommended option: Tailscale Serve

For a single personal user, use Tailscale on the NAS, phone, and laptops:

- Keep the application unavailable on the public internet.
- Permit only the owner's Tailscale identity to reach the application.
- Use Tailscale Serve for HTTPS and reverse proxying.
- Keep the independent Vibe Research password screen as a second access gate.
- Keep the origin bound to loopback and publish only the frontend proxy.
- Use an explicit Tailscale Grant for the owner's identity and the NAS HTTPS service.

For this single-user deployment, the backend does not need to trust forwarded Tailscale
identity headers. That integration can be reconsidered if the application becomes
multi-user and needs identity-specific authorization.

Do not use Tailscale Funnel for this private application.

### Clientless alternative: Cloudflare Tunnel and Access

If browser-only access without a Tailscale client is important:

- Run a Cloudflare Tunnel connector on the NAS.
- Protect the entire application hostname with Cloudflare Access.
- Restrict access to the owner's email or identity-provider account.
- Require MFA where available.
- Validate Access identity/JWT information at the origin or use a tightly controlled trusted proxy.
- Keep router ports closed and block direct origin access.

This is convenient but adds an external identity and proxy dependency.

### Additional security controls

Whichever gateway is chosen:

- Replace wildcard CORS with the exact application origin.
- Add trusted-host validation.
- Add security headers and HTTPS-only cookies where cookies are used.
- Add request body and upload-size limits.
- Rate-limit authentication-sensitive and expensive AI endpoints.
- Add CSRF protection or strict origin checks for state-changing requests if cookie authentication is introduced.
- Record authentication failures and important mutations without logging secrets or report contents.
- Disable FastAPI API documentation in production or protect it with the same identity layer.
- Make the health endpoint internal or return only minimal status.
- Keep NAS administration and application access on separate routes/ports and policies.

## Requirement 8: Additional frontend analysis pages

### General frontend extensibility

Feasibility is very high.

A page can be added by:

1. Creating a React component under `frontend/src/pages`.
2. Adding a route in `frontend/src/router.tsx`.
3. Adding a navigation entry in `frontend/src/components/layout/Layout.tsx`.
4. Adding typed API methods in `frontend/src/lib/api.ts`.
5. Reusing the existing visual components and Tailwind tokens.

The visual system can be preserved. The limiting factor for new analysis is usually the availability and consistency of the underlying data, not the frontend framework.

### Navigation scalability and mobile layout

The current sidebar will become crowded as pages are added. Group navigation into sections such as Market, Securities, Portfolio, Research, and Settings.

The existing fixed sidebar also consumes too much width on a phone. Before remote mobile use, implement:

- A mobile drawer or bottom navigation
- A compact top bar
- Responsive page actions
- Touch-sized controls
- Scrollable tables and chart containers
- Mobile testing for the authentication flow and streaming AI responses

## Proposed technical-analysis page

### Feasibility

High, with moderate backend work.

ECharts is already installed, and the frontend already uses the same card and page patterns needed for a charting page. The current A-share `/api/kline` endpoint is not a suitable cross-market foundation because it validates six-digit codes and uses a market-specific provider.

### Initial feature set

- Canonical instrument search
- Daily, weekly, monthly, and supported intraday intervals
- Candlestick chart
- Volume panel
- SMA and EMA
- RSI
- MACD
- Bollinger bands
- ATR
- Relative performance versus a selected index
- Adjustable date range and indicator parameters
- Visible provider, timestamp, currency, and delayed/live status
- Optional AI analysis using calculated values as structured context

### Backend implementation

Add a normalized endpoint such as:

```text
GET /api/market-data/bars
    ?instrument_id=GB:XLON:VOD
    &interval=1d
    &start=YYYY-MM-DD
    &end=YYYY-MM-DD
```

Keep indicator calculations deterministic and testable. They can be performed in a backend analytics module so results are consistent across the UI, AI context, and future reports.

The page should describe observed indicators and regimes rather than produce automatic buy/sell recommendations.

## Proposed portfolio-analysis and construction pages

### Feasibility

The frontend is easy to build; reliable portfolio analytics requires a more capable data and persistence model.

The current portfolio stores code, shares, and average cost in JSON and overlays current A-share quotes. It is suitable for simple bookkeeping but not for multi-market portfolio construction.

### Recommended separation

- `/portfolio`: positions, transactions, cash and P&L
- `/portfolio-analysis`: historical performance, exposures and risk
- `/portfolio-construction`: proposed target allocations and scenario comparison

### Data-model upgrades

Add at least:

- Canonical instrument ID
- Exchange and currency
- Quantity
- Transaction date and price
- Buy/sell direction
- Fees and taxes
- Cash movements
- Portfolio base currency
- FX conversion rate/source
- Benchmark identifier
- Optional account or portfolio name

Move from one JSON file to SQLite before adding transactions, historical snapshots, scenarios, and optimization. SQLite remains simple to self-host and back up on the NAS while providing transactions, migrations, indexing, and queryable history.

### Initial portfolio analytics

- Current weights and concentration
- Country, exchange, currency, sector, and asset-class exposure
- Base-currency market value and P&L
- Historical return series
- Benchmark-relative performance
- Volatility
- Maximum drawdown
- Correlation matrix
- Position contribution to return and risk
- Rebalancing calculator from current to target weights
- Before/after scenario comparison

### Later optimization features

- Minimum variance
- Risk parity
- Maximum diversification
- Efficient frontier
- User-defined minimum/maximum weights
- Turnover and transaction-cost constraints
- Currency and regional constraints

Optimization should follow, not precede, reliable instrument history, FX data, corporate-action handling, and portfolio transactions. Outputs should be presented as mathematical scenarios rather than financial advice.

## Cross-cutting implementation components

Several requested features share the same foundations:

| Foundation | Downstream consumers |
|---|---|
| Canonical instrument IDs | Europe support, Bloomberg, watchlist, portfolio, debate, technical analysis |
| Normalized historical bars | Technical analysis, portfolio risk, benchmarks, AI context |
| Currency and FX model | European quotes, portfolio valuation, performance attribution |
| Provider capability registry | Graceful market-specific UI, source routing, fallback behaviour |
| Internationalization | All existing and future pages |
| Identity-aware gateway | NAS deployment, personal data, reports, portfolio, AI usage |
| SQLite persistence | Transactions, scenarios, cached data, audit metadata |
| Mobile navigation | Secure remote use from phone |

These shared dependencies should guide prioritization so later work does not have to be rebuilt.

## Candidate implementation phases

These phases describe dependencies rather than a final chosen priority.

### Phase A: Engineering baseline

- Install and run backend tests.
- Resolve or document the existing `package-lock.json` modification.
- Add environment and deployment documentation.
- Establish typed normalized contracts and fixture-based tests.
- Decide the canonical instrument-ID format.

### Phase B: International and provider foundation

- Add the provider interface and capability registry.
- Wrap current market sources behind adapters.
- Add European/UK search, quote, and historical-bar support.
- Add currencies, exchanges, calendars, and FX rates.
- Update watchlist and stock pages to consume canonical instruments.

### Phase C: Bilingual frontend

- Add translation infrastructure.
- Convert layout, settings, shared components, and error handling.
- Convert pages feature by feature.
- Add locale-aware formatting and terminology review.

This phase can run incrementally alongside backend foundation work, but page migrations should avoid duplicating market-specific strings that will soon change.

### Phase D: NAS and secure remote access

- Add production containers and Compose.
- Add persistent volumes and backup instructions.
- Add the identity-aware gateway.
- Replace browser static-key authentication with trusted user identity.
- Lock down backend exposure and CORS.
- Add mobile navigation and responsive validation.
- Perform a deployment-focused security review.

### Phase E: Technical analysis

- Add normalized historical-bars endpoint.
- Add deterministic indicator module and tests.
- Build the technical-analysis page and charts.
- Add benchmark comparison and optional AI context.

### Phase F: Portfolio foundation and analytics

- Design transactions and portfolio schema.
- Migrate existing JSON holdings into SQLite.
- Add multi-currency valuation and FX handling.
- Build exposure, performance, risk, and rebalance analytics.
- Add portfolio-analysis page.

### Phase G: Portfolio construction

- Add scenario storage and target portfolios.
- Add constraints and transaction-cost assumptions.
- Add optimization methods only after data quality is validated.
- Build comparisons and explainability around optimized results.

### Phase H: Workplace/Bloomberg readiness

- Complete a deeper security and dependency assessment.
- Define data-flow and threat models.
- Obtain employer approval for code, AI, storage, network access, and market-data use.
- Implement the Bloomberg adapter as a separate deployment profile.
- Add entitlement, audit, retention, and operational controls.

## Prioritization questions for the next step

To choose the first implementation slice, decide:

1. Is the most immediate outcome remote access to the existing application, or new European-market functionality?
2. Is phone access needed before the bilingual UI is complete?
3. Should the first European release support quotes and charts only, or full stock-page and debate parity?
4. Is technical analysis more valuable initially than portfolio analytics?
5. Should the portfolio remain simple positions for now, or should transaction history and multi-currency performance be introduced early?
6. Is installing Tailscale on each personal device acceptable, or is clientless browser access required?
7. Should AI CLI integrations be excluded from the first NAS deployment?

## Recommended decision principle

Prefer the smallest vertical slice that proves the shared architecture:

- One European or UK instrument
- One normalized quote and historical-bars provider
- One bilingual page
- One securely authenticated NAS deployment
- One new analysis page consuming the normalized data

That slice will test the highest-risk boundaries—instrument identity, provider normalization, localization, deployment, authentication, and charting—before expanding breadth.

## Explicit non-goals for the personal-use first release

- Claiming that the repository is proven safe
- Direct public exposure of FastAPI or NAS administration
- Bloomberg or employer data access
- Storing employer confidential information
- Replicating every A-share-specific dataset for Europe
- Automatic investment recommendations
- Advanced optimization before reliable historical and FX data exist
- Multi-user role management unless the personal-use scope changes
