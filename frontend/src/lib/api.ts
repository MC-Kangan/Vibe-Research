// Vibe-Research 后端 API 客户端。/api → vite 代理到本地 FastAPI（默认 8900）。
// 后端未启动或数据源异常时抛 ApiError，页面据此优雅降级。

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// 后端访问密钥（对应后端部署时的 VR_API_KEY，公网部署防蹭用）。只存本地浏览器。
const ACCESS_KEY = "vr-access-key";

export function loadAccessKey(): string {
  try {
    return localStorage.getItem(ACCESS_KEY) || "";
  } catch {
    return "";
  }
}

export function saveAccessKey(key: string) {
  try {
    if (key) localStorage.setItem(ACCESS_KEY, key);
    else localStorage.removeItem(ACCESS_KEY);
  } catch {
    /* 隐私模式等场景 localStorage 不可用 */
  }
}

export function authHeaders(): Record<string, string> {
  const k = loadAccessKey();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

export interface MyReport {
  id: string; name: string; industry: string; size: number; ext: string; ts: number;
}

export interface ResearchSkill {
  name: string;
  description: string;
  immutable?: boolean;
  parameters?: {
    properties?: Record<string, {
      type?: string; default?: string | number | boolean; minimum?: number; maximum?: number;
    }>;
  } | null;
}
export interface ResearchSkillsResponse {
  configured: boolean;
  status: "available" | "disabled" | "unavailable";
  detail?: string;
  skills: ResearchSkill[];
}
export interface ResearchRunResult {
  skill: string;
  status: "complete" | "failed";
  detail?: string;
  report?: Record<string, unknown>;
}
export interface ResearchRunResponse {
  symbol: string;
  market: string;
  results: ResearchRunResult[];
}

export interface AuthSession {
  enabled: boolean;
  authenticated: boolean;
  username: string | null;
}

export interface RealPosition {
  account_ref: string;
  account_label: string;
  symbol: string;
  name: string;
  asset_class: string;
  currency: string;
  venue: string | null;
  quantity: number | null;
  average_cost: number | null;
  latest_price: number | null;
  market_value: number | null;
  reporting_market_value: number | null;
  unrealized_pnl: number | null;
  fx_rate: number | null;
  reporting_currency: string | null;
  cost_status: string;
  pnl_status: string;
  observed_at: string | null;
}

export interface PositionPreferences {
  items: string[];
  updated_at: string | null;
}

export interface RealPositionSnapshot {
  status: "available" | "empty" | "not_configured" | "error";
  source: "ibkr-flex";
  fetched_at: string | null;
  refreshed_at: string | null;
  report_date: string | null;
  summary: { reporting_currency: string | null; nav: number | null; reporting_coverage: number | null };
  positions: RealPosition[];
  warnings: string[];
}

export interface IbkrAllocation {
  symbol: string; name: string; asset_class: string; side: "Long" | "Short";
  market_value: number; weight: number; currency: string | null;
}
export interface IbkrDailyPnl {
  calendar_date: string; ending_nav: number; pnl_amount: number; pnl_percent: number | null;
  comparison_date: string | null; reporting_currency: string;
}
export interface IbkrContributor {
  account_ref: string; report_date: string; symbol: string; asset_class: string;
  previous_close_quantity: number; previous_close_price: number; close_quantity: number;
  close_price: number; transaction_mtm: number; prior_open_mtm: number; commissions: number; total: number;
  is_total: number;
}
export interface IbkrAnalytics {
  range: string; source: string; current: RealPositionSnapshot; allocation: IbkrAllocation[];
  gross_exposure: number | null; latest_nav: number | null; reporting_currency: string | null;
  daily_pnl: IbkrDailyPnl[]; latest_contributors: IbkrContributor[]; latest_report_date: string | null;
  warnings: string[];
}
export interface IbkrRefreshStatus {
  job_id: string | null; status: "idle" | "queued" | "running" | "complete" | "partial";
  stage: string; started_at?: string; finished_at?: string | null;
  positions_status: string; history_status: string; error_message?: string | null;
  positions_report_date?: string | null; history_report_date?: string | null;
}
export interface IbkrInstrument {
  instrument_key: string; account_ref: string; account_label: string; symbol: string; name: string;
  asset_class: string; currency: string; venue: string | null; status: "open" | "closed";
  quantity: number | null; average_cost: number | null;
  provider_symbol: string | null; price_multiplier: number; mapping_source: string;
}
export interface IbkrExecution {
  trade_key: string; occurred_at: string; side: "BUY" | "SELL"; quantity: number; price: number | null;
  fees: number; net_cash: number | null; external_id: string | null;
}
export interface IbkrChartBar {
  date: string; open: number | null; high: number | null; low: number | null; close: number | null;
  adjusted_close: number | null; volume: number | null; sma20: number | null; currency: string;
}
export interface IbkrPositionChart {
  instrument: IbkrInstrument; provider_symbol: string | null; price_multiplier: number;
  mapping_source: string; provider: string | null; bars: IbkrChartBar[]; executions: IbkrExecution[];
  warnings: string[];
}

// 下载/预览研报：带鉴权头 fetch → blob → 触发浏览器下载（<a download> 无法带 Authorization，故走 blob）。
export async function downloadReport(id: string, name: string): Promise<void> {
  const resp = await fetch(`/api/myreports/file/${id}`, { headers: authHeaders() });
  if (!resp.ok) throw new ApiError(`下载失败 HTTP ${resp.status}`, resp.status);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function request<T>(path: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown): Promise<T> {
  let resp: Response;
  const headers: Record<string, string> = { ...authHeaders() };
  const opts: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  if (Object.keys(headers).length > 0) opts.headers = headers;
  try {
    resp = await fetch(`/api${path}`, opts);
  } catch {
    throw new ApiError("连接不到后端，请先启动 backend（uvicorn app:app --port 8900）", 0);
  }
  let payload: any = null;
  try {
    payload = await resp.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!resp.ok) {
    if (resp.status === 401) {
      throw new ApiError("后端需要登录或访问密钥：请先登录，或在「接入 AI」页填写 VR_API_KEY", 401);
    }
    throw new ApiError(payload?.detail || `HTTP ${resp.status}`, resp.status);
  }
  return (payload?.data ?? payload) as T;
}

const get = <T>(path: string) => request<T>(path, "GET");

export interface Quote {
  name: string; price: number | null; last_close: number | null; change_pct: number | null;
  pe_ttm: number | null; pb: number | null; mcap_yi: number | null; turnover_pct: number | null;
  limit_up: number | null; limit_down: number | null;
  currency?: string; source?: string; market?: "CN" | "US" | "EU";
}

export interface Valuation {
  name: string; code: string; price: number; mcap_yi: number;
  pe_ttm: number; pb: number;
  eps_26e: number | null; eps_27e: number | null; pe_26e: number | null;
  cagr_pct: number | null; peg: number | null; digest_years: number | null;
  analyst_count: number; forecast_note?: string;
}

export interface Report {
  title: string; publishDate: string; orgSName: string;
  emRatingName?: string; indvInduName?: string; pdfUrl?: string | null;
}

export interface ValMetric {
  current: number; percentile: number; min: number; max: number;
  p20: number; p50: number; p80: number; n: number;
}
export interface ValPercentile {
  period: string; metrics: { pe_ttm?: ValMetric; pb?: ValMetric };
}

export interface Announcement {
  date: string; title: string; type: string; url: string;
}

export interface Financials {
  period: string | null;
  revenue: string | null; revenue_yoy: string | null;
  net_profit: string | null; net_profit_yoy: string | null;
  eps: string | null; bvps: string | null; roe: string | null;
  gross_margin: string | null; net_margin: string | null; op_cf_ps: string | null;
}

export interface NewsItem {
  新闻标题?: string; 发布时间?: string; 文章来源?: string; 新闻链接?: string;
}

export interface IndexQuote {
  name: string; price: number; change_pct: number; change_amt: number;
}
export interface BenchmarkSnapshot {
  key: string; symbol: string; name: string; region: "US" | "Europe";
  price: number | null; previous_close: number | null; change_pct: number | null;
  currency: string | null; observed_at: string | null; delay_seconds: number | null;
  source: string; available: boolean;
}
export interface BenchmarkData {
  items: BenchmarkSnapshot[];
  gaps: { key: string; symbol: string; message: string }[];
  fetched_at: string;
}
export interface MarketOverviewQuote {
  symbol: string; name: string; market: "CN" | "US" | "EU";
  price: number | null; change_pct: number | null; currency: string | null; source: string;
}
export interface MarketBreadth { total: number; up: number; down: number; flat: number; unavailable: number }
export interface MarketWatchlistOverview {
  symbols: string[]; quotes: MarketOverviewQuote[]; breadth: MarketBreadth; movers: MarketOverviewQuote[];
}
export interface MarketSectorProxy {
  key: string; name: string; symbol: string; region: "US" | "Europe";
  price: number | null; change_pct: number | null; currency: string | null; source: string;
}
export interface MarketOverviewData {
  benchmarks: BenchmarkData;
  watchlist: MarketWatchlistOverview;
  sectors: { US: MarketSectorProxy[]; Europe: MarketSectorProxy[] };
  gaps: { symbol: string; message: string; scope?: string }[];
  fetched_at: string; notes: string[];
}
export interface MarketMoodMover {
  symbol: string; date: string; close: number; change_pct: number | null;
  above_ma: Record<"20" | "50" | "200", boolean | null>;
  new_52w_high: boolean; new_52w_low: boolean; volume_ratio: number | null; unusual_volume: boolean;
}
export interface MarketMoodData {
  market: "US" | "Europe";
  universe: { label: string; benchmark: string; size: number };
  mood: "偏强" | "中性" | "偏弱";
  breadth: { total: number; available: number; up: number; down: number; flat: number; unavailable: number };
  participation: Record<"20" | "50" | "200", { above: number; total: number; pct: number | null }>;
  new_highs: number; new_lows: number; unusual_volume: number; movers: MarketMoodMover[];
  gaps: { symbol: string; message: string }[]; as_of: string | null; fetched_at: string; source: string; notes: string[];
}
export type IntelligenceKind = "filings" | "news" | "earnings";
export interface IntelligenceItem {
  symbol: string; market: "CN" | "US" | "EU"; kind: IntelligenceKind;
  title: string; summary: string | null; published_at: string; source: string;
  url: string | null; meta: Record<string, string | number | null>;
}
export interface IntelligenceGap {
  symbol: string; kind: IntelligenceKind; reason: string; message: string;
}
export interface IntelligenceFeed {
  symbols: string[]; kinds: IntelligenceKind[]; items: IntelligenceItem[];
  gaps: IntelligenceGap[]; fetched_at: string;
}
export interface DataSourceStatus {
  [key: string]: { configured: boolean; coverage: string };
}

export interface MarketSentiment {
  up: number; down: number; flat: number; zt: number; zt_real: number; dt: number; dt_real: number;
  active: string; breadth: string; speculation: string; date: string;
}
export interface SectorFlow {
  name: string; pct: number; net: number; inflow: number; outflow: number; firms: number;
}
export interface MarketOverview {
  sentiment: MarketSentiment; sectors: SectorFlow[]; updated: string;
}

// 短线情绪：连板梯队 / 最高连板 / 炸板率 / 封板率 / 晋级率 / 涨跌停家数 + 连板股清单（客观公开榜单）
export interface EmotionTier { boards: number; count: number; plus: boolean }
export interface LianbanStock {
  code: string; name: string; boards: number;
  price: number; pct: number; amount: number | null; float_cap: number | null; industry: string;
}
export interface ShortTermEmotion {
  date: string;
  zt_count: number; dt_count: number; zb_count: number;
  max_boards: number; lianban_count: number;
  ladder: EmotionTier[];
  lianban_stocks: LianbanStock[];
  seal_rate: number | null; break_rate: number | null; promotion_rate: number | null;
  yzt_count: number;
}

// 全市场成交额榜（客观公开榜单）
export interface TurnoverStock {
  code: string; name: string;
  price: number | null; pct: number | null;
  amount: number | null; mcap: number | null; float_cap: number | null; industry: string;
}
export interface TurnoverTop { stocks: TurnoverStock[]; updated: string }

export interface RadarItem {
  title: string; url: string; time: string; source: string; summary?: string; zh?: string;
}
export interface Industry {
  key: string; name: string; accent: string; total: number; items: RadarItem[];
}
export interface RadarData {
  generated_at: string | null; recent_days: number; industries: Industry[];
  stats: { industries: number; total_sources: number; failed_sources?: number };
}

export interface Holding {
  code: string; name: string; price: number | null; shares: number; cost: number;
  market_value: number | null; pnl: number | null; pnl_pct: number | null; currency: string;
  quote_available: boolean;
}
export interface ClosedPosition {
  code: string; name: string; date: string; price: number; shares: number; cost: number;
  pnl: number; pnl_pct: number; currency: string;
}
export interface PortfolioTotal { currency?: string; market_value: number; cost: number; pnl: number; pnl_pct: number }
export interface PortfolioData {
  holdings: Holding[];
  totals: PortfolioTotal;
  totals_by_currency: Record<string, PortfolioTotal>;
  mixed_currency: boolean;
  closed: ClosedPosition[];
  realized_pnl: number;
  realized_pnl_by_currency: Record<string, number>;
  updated: string; last_refresh: string | null;
}

// 资金面 / 筹码 / 信号（v3.3 并入，均为「用户查的那只股」的公开数据）
export interface MarginRow { date: string; rzye: number; rzmre: number; rzche: number; rqye: number; rqmcl: number; rzrqye: number }
export interface BlockTradeRow { date: string; price: number; close: number; premium_pct: number; vol: number; amount: number; buyer: string; seller: string }
export interface HolderRow { date: string; holder_num: number; change_ratio: number; avg_shares: number }
export interface DividendRow { date: string; bonus_rmb: number; transfer_ratio: number; bonus_ratio: number | null; plan: string }
export interface FundFlowRow { date: string; main_net: number; small_net: number; mid_net: number; large_net: number; super_net: number }
export interface DtSeat { name: string; buy_amt: number; sell_amt: number; net: number }
export interface DragonTiger {
  records: { date: string; reason: string; net_buy: number; turnover: number }[];
  seats: { buy: DtSeat[]; sell: DtSeat[] };
  institution: { buy_amt: number; sell_amt: number; net_amt: number };
}
export interface LockupRow { date: string; type: string; shares: number; able_shares: number; ratio: number }
export interface Lockup { history: LockupRow[]; upcoming: LockupRow[] }
export interface Board { name: string; code: string; change_pct: number | string; lead_stock: string }
export interface Blocks { total: number; boards: Board[]; concept_tags: string[] }
export interface HotConcept { concept: string; bk: string; hit: number }
export interface QaRow { company: string; question: string; answer: string | null; answerer: string; ask_time: string }
export interface IndustryRow { rank: number; name: string; change_pct: number; code: string; up_count: number; down_count: number }
export interface IndustryData { top: IndustryRow[]; bottom: IndustryRow[]; total: number }

// 全球市场（美股 / 港股，移植自 global-stock-data · 东财域内源）
export interface GlobalIndex {
  key: string; name: string; region: string;
  price: number | null; change_pct: number | null;
}
export interface GlobalQuote {
  code: string; name: string;
  price: number | null; open: number | null; high: number | null; low: number | null;
  prev_close: number | null; amount: number | null; mcap: number | null; change_pct: number | null;
}
export interface GlobalMetrics {
  report_date: string;
  revenue: number | null; revenue_yoy: number | null; net_profit: number | null;
  eps: number | null; roe: number | null; gross_margin: number | null;
  net_margin: number | null; debt_ratio: number | null;
}
export interface GlobalStock {
  code: string; name: string; market: string;
  quote: GlobalQuote; metrics: GlobalMetrics | null;
}
export interface HkCashflowItem { amount: number | null; yoy: number | null }
export interface HkCashflowPeriod {
  report_date: string; report: string | null;
  currency: string | null; account_standard: string | null;
  items: Record<string, HkCashflowItem>;
}
export interface HkCashflow {
  code: string; name: string; market: string;
  currency: string | null; item_order: string[]; periods: HkCashflowPeriod[];
}

// 美股/欧洲原生上市股票（规范化 Yahoo personal-use 行情契约）
export interface MarketInstrument {
  instrument_id: string; asset_type: "equity"; symbol: string; provider_symbol: string;
  name: string; exchange: string; mic: string; country: string;
  currency: string; timezone: string | null;
}
export interface MarketQuote {
  price: number | null; open: number | null; high: number | null; low: number | null;
  previous_close: number | null; change_pct: number | null; currency: string;
  source_price: number | null; source_price_unit: string; price_scale: number;
  market_state: string | null; observed_at: string | null; fetched_at: string;
  delay_seconds: number | null; source: string;
}
export interface MarketSnapshot { instrument: MarketInstrument; quote: MarketQuote }
export interface MarketHistoricalBar {
  date: string; open: number | null; high: number | null; low: number | null;
  close: number | null; adjusted_close: number | null; volume: number | null; currency: string;
}
export interface MarketHistoricalSeries {
  provider_symbol: string; range: string; interval: string; source: string;
  fetched_at: string; bars: MarketHistoricalBar[];
}
export interface AShareHistoricalBar {
  date: string; open: number | null; high: number | null; low: number | null;
  close: number | null; volume: number | null;
}
export interface MarketNewsItem {
  headline: string | null; summary: string | null; source: string | null;
  published_at: number | null; url: string | null; category: string | null;
}
export interface MarketNews { symbol: string; source: string; items: MarketNewsItem[] }
export interface MarketEarningsItem {
  period: string | null; quarter: number | null; year: number | null;
  actual: number | null; estimate: number | null; surprise: number | null; surprise_pct: number | null;
}
export interface MarketEarnings { symbol: string; source: string; items: MarketEarningsItem[] }
export interface SecFiling {
  filingDate: string | null; reportDate: string | null; acceptanceDateTime: string | null;
  form: string | null; primaryDocDescription: string | null; accession_number: string;
  primary_document: string; url: string | null;
}
export interface SecFilings { symbol: string; cik: string; company: string | null; source: string; items: SecFiling[] }
export interface SecFactValue {
  label: string | null; val: number | null; unit: string; fy?: number; fp?: string;
  form?: string; filed?: string; start?: string; end?: string; tag?: string;
  period_type?: "instant" | "quarterly" | "year_to_date" | "annual" | "duration";
  duration_days?: number | null;
}
export interface SecFacts { symbol: string; cik: string; company: string | null; source: string; facts: Record<string, SecFactValue> }

export const api = {
  health: () => get<{ ok: boolean }>("/health"),
  indices: () => get<IndexQuote[]>("/indices"),
  marketOverview: () => get<MarketOverview>("/market/overview"),
  emotion: () => get<ShortTermEmotion>("/market/emotion"),
  turnoverTop: () => get<TurnoverTop>("/market/turnover-top"),
  globalIndices: () => get<GlobalIndex[]>("/global/indices"),
  benchmarks: () => get<BenchmarkData>("/market-data/benchmarks"),
  internationalOverview: (symbols: string[] = []) => get<MarketOverviewData>(
    `/market-data/overview${symbols.length ? `?symbols=${encodeURIComponent(symbols.join(","))}` : ""}`,
  ),
  marketMood: (market: "US" | "Europe") => get<MarketMoodData>(`/market-data/mood?market=${market}`),
  dataSourceStatus: () => get<DataSourceStatus>("/data-sources/status"),
  intelligenceFeed: (symbols: string[], kinds: IntelligenceKind[] = ["filings", "news", "earnings"], limitPerSymbol = 5) =>
    request<IntelligenceFeed>("/intelligence/feed", "POST", { symbols, kinds, limit_per_symbol: limitPerSymbol }),
  globalStock: (symbol: string) => get<GlobalStock>(`/global/stock?symbol=${encodeURIComponent(symbol)}`),
  hkCashflow: (symbol: string) => get<HkCashflow>(`/global/hk/cashflow?symbol=${encodeURIComponent(symbol)}`),
  marketSnapshot: (symbol: string) => get<MarketSnapshot>(`/market-data/snapshot?symbol=${encodeURIComponent(symbol)}`),
  marketBars: (symbol: string, range = "1y", interval = "1d") => get<MarketHistoricalSeries>(
    `/market-data/bars?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`,
  ),
  aShareBars: (code: string, offset = 240) => get<AShareHistoricalBar[]>(`/kline?code=${encodeURIComponent(code)}&category=4&offset=${offset}`),
  marketNews: (symbol: string, days = 30) => get<MarketNews>(
    `/market-data/news?symbol=${encodeURIComponent(symbol)}&days=${days}`,
  ),
  marketEarnings: (symbol: string) => get<MarketEarnings>(`/market-data/earnings?symbol=${encodeURIComponent(symbol)}`),
  marketFilings: (symbol: string) => get<SecFilings>(`/market-data/filings?symbol=${encodeURIComponent(symbol)}`),
  marketSecFacts: (symbol: string) => get<SecFacts>(`/market-data/sec-facts?symbol=${encodeURIComponent(symbol)}`),
  radar: () => get<RadarData>("/radar"),
  radarRefresh: () => request<RadarData>("/radar/refresh", "POST"),
  portfolio: () => get<PortfolioData>("/portfolio"),
  addHolding: (code: string, shares: number, cost: number) => request<PortfolioData>("/portfolio/holding", "POST", { code, shares, cost }),
  removeHolding: (code: string) => request<PortfolioData>(`/portfolio/holding?code=${encodeURIComponent(code)}`, "DELETE"),
  refreshPortfolio: () => request<PortfolioData>("/portfolio/refresh", "POST"),
  authSession: () => get<AuthSession>("/auth/session"),
  authLogin: (username: string, password: string) => request<AuthSession>("/auth/login", "POST", { username, password }),
  authLogout: () => request<{ authenticated: boolean }>("/auth/logout", "POST"),
  realPositions: () => get<RealPositionSnapshot>("/positions/current"),
  positionPreferences: () => get<PositionPreferences>("/positions/preferences"),
  savePositionPreferences: (items: string[]) => request<PositionPreferences>("/positions/preferences", "PUT", { items }),
  refreshRealPositions: (confirmEmpty = false) => request<RealPositionSnapshot>("/positions/refresh", "POST", { confirm_empty: confirmEmpty }),
  refreshAllPositions: () => request<IbkrRefreshStatus>("/positions/refresh-all", "POST"),
  positionRefreshStatus: (jobId?: string) => get<IbkrRefreshStatus>(`/positions/refresh-status${jobId ? `?job_id=${encodeURIComponent(jobId)}` : ""}`),
  positionAnalytics: (range = "3m") => get<IbkrAnalytics>(`/positions/analytics?range=${encodeURIComponent(range)}`),
  positionInstruments: (status: "all" | "open" | "closed" = "all") => get<IbkrInstrument[]>(`/positions/instruments?status=${status}`),
  positionChart: (instrumentKey: string, range = "3m") => get<IbkrPositionChart>(`/positions/chart?instrument_key=${encodeURIComponent(instrumentKey)}&range=${encodeURIComponent(range)}`),
  savePositionMapping: (instrumentKey: string, providerSymbol: string, priceMultiplier = 1) =>
    request<Record<string, unknown>>("/positions/mappings", "POST", { instrument_key: instrumentKey, provider_symbol: providerSymbol, price_multiplier: priceMultiplier }),
  closePosition: (code: string, date: string, price: number, shares: number, cost: number) =>
    request<PortfolioData>("/portfolio/close", "POST", { code, date, price, shares, cost }),
  removeClosed: (index: number) => request<PortfolioData>(`/portfolio/close?index=${index}`, "DELETE"),
  valuation: (code: string) => get<Valuation>(`/valuation?code=${code}`),
  percentile: (code: string) => get<ValPercentile>(`/valuation/percentile?code=${code}`),
  financials: (code: string) => get<Financials>(`/financials?code=${code}`),
  announcements: (code: string) => get<Announcement[]>(`/announcements?code=${code}`),
  quote: (codes: string) => get<Record<string, Quote>>(`/quote?codes=${codes}`),
  quotes: (symbols: string) => get<Record<string, Quote>>(`/quotes?symbols=${encodeURIComponent(symbols)}`),
  reports: (code: string) => get<Report[]>(`/reports?code=${code}`),
  news: (code: string) => get<NewsItem[]>(`/news?code=${code}`),
  margin: (code: string) => get<MarginRow[]>(`/margin?code=${code}`),
  blockTrade: (code: string) => get<BlockTradeRow[]>(`/block-trade?code=${code}`),
  holders: (code: string) => get<HolderRow[]>(`/holders?code=${code}`),
  dividend: (code: string) => get<DividendRow[]>(`/dividend?code=${code}`),
  fundFlow: (code: string) => get<FundFlowRow[]>(`/fund-flow?code=${code}`),
  dragonTiger: (code: string) => get<DragonTiger>(`/dragon-tiger?code=${code}`),
  lockup: (code: string) => get<Lockup>(`/lockup?code=${code}`),
  blocks: (code: string) => get<Blocks>(`/blocks?code=${code}`),
  hotConcepts: (code: string) => get<HotConcept[]>(`/hot-concepts?code=${code}`),
  investorQa: (code: string) => get<QaRow[]>(`/investor-qa?code=${code}`),
  industry: (top = 20) => get<IndustryData>(`/industry?top=${top}`),
  myReports: () => get<MyReport[]>("/myreports"),
  researchSkills: () => get<ResearchSkillsResponse>("/research/skills"),
  runResearch: (symbol: string, skills: string[], skillParameters: Record<string, Record<string, unknown>> = {}) =>
    request<ResearchRunResponse>("/research/run", "POST", { symbol, skills, skill_parameters: skillParameters }),
  uploadReport: (name: string, contentB64: string) =>
    request<MyReport>("/myreports", "POST", { name, content_b64: contentB64 }),
  deleteReport: (id: string) => request<{ ok: boolean }>(`/myreports/${id}`, "DELETE"),
};
