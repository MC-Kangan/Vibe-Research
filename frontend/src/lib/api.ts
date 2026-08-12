// Vibe-Research 后端 API 客户端。/api → vite 代理到本地 FastAPI（默认 8900）。
// 后端未启动或数据源异常时抛 ApiError，页面据此优雅降级。

import { getLocale, translate } from "@/lib/i18n";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

const API_ERROR_MESSAGES: Record<string, [string, string]> = {
  invalid_stock_symbol: ["Enter a six-digit A-share symbol, a US ticker, or an exchange-qualified European ticker.", "请输入六位 A 股代码、美股代码或带交易所后缀的欧洲股票代码。"],
  invalid_a_share_code: ["A-share symbols must contain exactly six digits.", "A 股代码必须为六位数字。"],
  research_skill_required: ["Select at least one analysis skill.", "请至少选择一个分析技能。"],
  research_skill_not_enabled: ["The request contains a skill that is not enabled.", "请求中包含未启用的分析技能。"],
  tradeagent_not_configured: ["TradeAgent is not configured.", "TradeAgent 尚未配置。"],
  holding_quantity_invalid: ["Holding quantity must be greater than zero.", "持仓数量必须大于零。"],
  manual_holding_not_found: ["The manual stock holding was not found.", "未找到该手工股票持仓。"],
  close_position_values_invalid: ["Close price and quantity must be greater than zero.", "清仓价格和数量必须大于零。"],
  close_date_required: ["Close date is required.", "请填写清仓日期。"],
  close_date_invalid: ["Close date must use YYYY-MM-DD format.", "清仓日期必须使用 YYYY-MM-DD 格式。"],
  ibkr_not_configured: ["IBKR Flex current-position import is not configured.", "IBKR Flex 当前持仓导入尚未配置。"],
  authentication_disabled: ["Application authentication is disabled.", "应用登录功能未启用。"],
  login_rate_limited: ["Too many failed login attempts; try again later.", "登录失败次数过多，请稍后重试。"],
  invalid_credentials: ["Invalid username or password.", "用户名或密码错误。"],
};

function errorMessage(payload: any, fallback: string): string {
  const messages = API_ERROR_MESSAGES[String(payload?.code || "")];
  return messages ? translate(getLocale(), messages[0], messages[1]) : String(payload?.detail || fallback);
}

export const AUTH_INVALIDATED_EVENT = "vibe-auth-invalidated";

export function notifyAuthInvalidated() {
  window.dispatchEvent(new Event(AUTH_INVALIDATED_EVENT));
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
  supported_asset_types?: Array<"equity" | "crypto">;
}
export interface ResearchSkillsResponse {
  configured: boolean;
  status: "available" | "disabled" | "unavailable";
  detail?: string;
  skills: ResearchSkill[];
}
export interface ResearchSkillDefaults {
  equity: string[];
  crypto: string[];
  updated_at: string | null;
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

export interface InstrumentOverview {
  symbol: string;
  route: "a-share" | "market" | "global" | "crypto";
  status: "available" | "partial" | "unavailable";
  capabilities: string[];
  gaps: Array<{ section: string; detail: string }>;
  data: {
    valuation?: Valuation;
    reports?: Report[];
    percentile?: ValPercentile;
    financials?: Financials;
    announcements?: Announcement[];
    a_share_history?: AShareHistoricalBar[];
    market_snapshot?: MarketSnapshot;
    market_history?: MarketHistoricalSeries;
    global_stock?: GlobalStock;
    cashflow?: HkCashflow;
  };
}

export interface ExtractedResearchContext {
  name: string;
  content: string;
  characters: number;
  original_characters: number;
  truncated: boolean;
  pages: number | null;
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
export interface IbkrPerformance {
  method: "broker_flow_adjusted" | "unavailable"; coverage: "complete" | "unavailable";
  flow_adjusted_return: number | null; max_drawdown: number | null; observations: number; reason: string | null;
}
export interface IbkrReconciliation {
  reconciliation_key: string; account_ref: string; account_label: string; observed_at: string; currency: string;
  broker_nav: number; calculated_nav: number; nav_difference: number; broker_cash: number | null;
  calculated_cash: number; cash_difference: number | null; status: "matched" | "warning"; source: string;
}
export interface IbkrAnalytics {
  range: string; source: string; current: RealPositionSnapshot; allocation: IbkrAllocation[];
  gross_exposure: number | null; latest_nav: number | null; reporting_currency: string | null;
  daily_pnl: IbkrDailyPnl[]; latest_contributors: IbkrContributor[]; latest_report_date: string | null;
  performance: IbkrPerformance; reconciliations: IbkrReconciliation[]; recent_transactions: IbkrExecution[];
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
  fees: number; gross_amount: number; taxes: number; net_cash: number | null;
  description: string | null; external_id: string | null; account_ref: string; account_label: string;
  symbol: string; name: string; asset_class: string; currency: string; venue: string | null; source: string;
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
  if (!resp.ok) {
    if (resp.status === 401) notifyAuthInvalidated();
    throw new ApiError(`下载失败 HTTP ${resp.status}`, resp.status);
  }
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

async function request<T>(path: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  let resp: Response;
  const headers: Record<string, string> = { ...authHeaders() };
  const opts: RequestInit = { method, credentials: "same-origin", signal };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  if (Object.keys(headers).length > 0) opts.headers = headers;
  try {
    resp = await fetch(`/api${path}`, opts);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(translate(getLocale(), "Cannot reach the backend. Start it with uvicorn app:app --port 8900.", "连接不到后端，请先启动 backend（uvicorn app:app --port 8900）"), 0);
  }
  let payload: any = null;
  try {
    payload = await resp.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!resp.ok) {
    if (resp.status === 401 && payload?.code !== "invalid_credentials") {
      if (!path.startsWith("/auth/")) notifyAuthInvalidated();
      throw new ApiError(translate(getLocale(), "The backend requires a login or access key. Sign in or enter VR_API_KEY in AI Setup.", "后端需要登录或访问密钥：请先登录，或在「接入 AI」页填写 VR_API_KEY"), 401);
    }
    throw new ApiError(errorMessage(payload, `HTTP ${resp.status}`), resp.status, payload?.code);
  }
  return (payload?.data ?? payload) as T;
}

const get = <T>(path: string, signal?: AbortSignal) => request<T>(path, "GET", undefined, signal);

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
  include_in_total: boolean;
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
  instrument_id: string; asset_type: "equity" | "crypto"; symbol: string; provider_symbol: string;
  name: string; exchange: string; mic: string; country: string;
  currency: string; timezone: string | null;
  base_asset?: string | null; quote_asset?: string | null; capabilities?: string[];
}
export interface MarketQuote {
  price: number | null; open: number | null; high: number | null; low: number | null;
  previous_close: number | null; change_pct: number | null; currency: string;
  source_price: number | null; source_price_unit: string; price_scale: number;
  market_state: string | null; observed_at: string | null; fetched_at: string;
  delay_seconds: number | null; source: string;
  is_stale?: boolean;
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
export interface CryptoOverviewAsset {
  id: string | null; symbol: string; name: string; rank: number | null;
  market_cap: number | null; volume_24h: number | null; change_24h_pct: number | null;
  circulating_supply: number | null; ath: number | null; coinbase_available: boolean;
  price: number | null; price_currency: string; price_source: string | null;
}
export interface CryptoOverview {
  fetched_at: string; sources: { prices: string; market_metadata: string | null; market_metadata_stale?: boolean };
  global: { total_market_cap_usd: number | null; total_volume_24h_usd: number | null; market_cap_change_24h_pct: number | null; btc_dominance_pct: number | null; eth_dominance_pct: number | null };
  breadth: { total: number; up: number; down: number; flat: number };
  assets: CryptoOverviewAsset[]; gaps: string[];
}
export interface CryptoPosition {
  source: "coinbase" | "manual"; wallet_label: string; asset: string; quantity: number;
  asset_kind?: "fiat" | "crypto"; cash_like: boolean; unit_cost?: number | null; cost_currency?: string;
  price?: number | null; price_currency?: string; reporting_market_value?: number | null;
  reporting_currency?: string; cost_value?: number | null; pnl?: number | null;
}
export interface CoinbasePositionSnapshot {
  status: "available" | "empty" | "not_configured" | "error"; source: "coinbase";
  refreshed_at: string | null; positions: CryptoPosition[]; warnings: string[];
}
export interface CryptoPortfolioData {
  reporting_currency: string; positions: CryptoPosition[]; assets: Array<{ asset: string; quantity: number; reporting_market_value: number | null; reporting_currency: string; cash_like: boolean; sources: Array<{ source: string; wallet_label: string; quantity: number }> }>; fiat_positions: CryptoPosition[];
  total: number; cash_like_total: number; fiat_total: number; gaps: string[];
  coinbase: CoinbasePositionSnapshot; manual: CryptoPosition[];
}
export interface PortfolioSummary {
  reporting_currency: string; stock: number; crypto: number; cash: number; total: number;
  cash_like_crypto: number; weights: { stock: number; crypto: number; cash: number }; gaps: string[];
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
  instrumentOverview: (symbol: string, assetType: "equity" | "crypto" = "equity", signal?: AbortSignal) => get<InstrumentOverview>(`/instruments/overview?symbol=${encodeURIComponent(symbol)}&asset_type=${assetType}`, signal),
  cryptoOverview: () => get<CryptoOverview>("/market-data/crypto/overview"),
  marketNews: (symbol: string, days = 30, signal?: AbortSignal) => get<MarketNews>(
    `/market-data/news?symbol=${encodeURIComponent(symbol)}&days=${days}`, signal,
  ),
  marketEarnings: (symbol: string, signal?: AbortSignal) => get<MarketEarnings>(`/market-data/earnings?symbol=${encodeURIComponent(symbol)}`, signal),
  marketFilings: (symbol: string, signal?: AbortSignal) => get<SecFilings>(`/market-data/filings?symbol=${encodeURIComponent(symbol)}`, signal),
  marketSecFacts: (symbol: string, signal?: AbortSignal) => get<SecFacts>(`/market-data/sec-facts?symbol=${encodeURIComponent(symbol)}`, signal),
  radar: () => get<RadarData>("/radar"),
  radarRefresh: () => request<RadarData>("/radar/refresh", "POST"),
  portfolio: () => get<PortfolioData>("/portfolio"),
  addHolding: (code: string, shares: number, cost: number) => request<PortfolioData>("/portfolio/holding", "POST", { code, shares, cost }),
  removeHolding: (code: string) => request<PortfolioData>(`/portfolio/holding?code=${encodeURIComponent(code)}`, "DELETE"),
  refreshPortfolio: () => request<PortfolioData>("/portfolio/refresh", "POST"),
  setHoldingInTotal: (code: string, includeInTotal: boolean) => request<PortfolioData>(`/portfolio/holding/total?code=${encodeURIComponent(code)}`, "PUT", { include_in_total: includeInTotal }),
  cryptoPortfolio: (reportingCurrency = "USD") => get<CryptoPortfolioData>(`/portfolio/crypto?reporting_currency=${encodeURIComponent(reportingCurrency)}`),
  refreshCryptoPositions: () => request<CoinbasePositionSnapshot>("/positions/crypto/refresh", "POST"),
  upsertManualCrypto: (item: { wallet_label: string; asset: string; quantity: number; unit_cost?: number | null; cost_currency?: string }) => request<CryptoPosition[]>("/portfolio/crypto/manual", "POST", item),
  removeManualCrypto: (walletLabel: string, asset: string) => request<CryptoPosition[]>(`/portfolio/crypto/manual?wallet_label=${encodeURIComponent(walletLabel)}&asset=${encodeURIComponent(asset)}`, "DELETE"),
  previewCryptoCsv: (content: string) => request<{ rows: CryptoPosition[] }>("/portfolio/crypto/import/preview", "POST", { content }),
  importCryptoCsv: (content: string) => request<CryptoPosition[]>("/portfolio/crypto/import", "POST", { content }),
  portfolioSummary: (reportingCurrency?: string) => get<PortfolioSummary>(`/portfolio/summary${reportingCurrency ? `?reporting_currency=${encodeURIComponent(reportingCurrency)}` : ""}`),
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
  news: (code: string, signal?: AbortSignal) => get<NewsItem[]>(`/news?code=${code}`, signal),
  margin: (code: string, signal?: AbortSignal) => get<MarginRow[]>(`/margin?code=${code}`, signal),
  blockTrade: (code: string, signal?: AbortSignal) => get<BlockTradeRow[]>(`/block-trade?code=${code}`, signal),
  holders: (code: string, signal?: AbortSignal) => get<HolderRow[]>(`/holders?code=${code}`, signal),
  dividend: (code: string, signal?: AbortSignal) => get<DividendRow[]>(`/dividend?code=${code}`, signal),
  fundFlow: (code: string, signal?: AbortSignal) => get<FundFlowRow[]>(`/fund-flow?code=${code}`, signal),
  dragonTiger: (code: string, signal?: AbortSignal) => get<DragonTiger>(`/dragon-tiger?code=${code}`, signal),
  lockup: (code: string, signal?: AbortSignal) => get<Lockup>(`/lockup?code=${code}`, signal),
  blocks: (code: string, signal?: AbortSignal) => get<Blocks>(`/blocks?code=${code}`, signal),
  hotConcepts: (code: string, signal?: AbortSignal) => get<HotConcept[]>(`/hot-concepts?code=${code}`, signal),
  investorQa: (code: string, signal?: AbortSignal) => get<QaRow[]>(`/investor-qa?code=${code}`, signal),
  industry: (top = 20) => get<IndustryData>(`/industry?top=${top}`),
  myReports: () => get<MyReport[]>("/myreports"),
  researchSkills: () => get<ResearchSkillsResponse>("/research/skills"),
  researchSkillDefaults: () => get<ResearchSkillDefaults>("/research/skill-defaults"),
  saveResearchSkillDefaults: (assetType: "equity" | "crypto", skills: string[]) =>
    request<ResearchSkillDefaults>("/research/skill-defaults", "PUT", { asset_type: assetType, skills }),
  runResearch: (symbol: string, skills: string[], skillParameters: Record<string, Record<string, unknown>> = {}, assetType: "equity" | "crypto" = "equity") =>
    request<ResearchRunResponse>("/research/run", "POST", { symbol, skills, skill_parameters: skillParameters, asset_type: assetType }),
  extractResearchContexts: (files: Array<{ name: string; content_b64: string }>) =>
    request<ExtractedResearchContext[]>("/research-context/extract", "POST", { files, locale: getLocale() }),
  uploadReport: (name: string, contentB64: string) =>
    request<MyReport>("/myreports", "POST", { name, content_b64: contentB64 }),
  deleteReport: (id: string) => request<{ ok: boolean }>(`/myreports/${id}`, "DELETE"),
};
