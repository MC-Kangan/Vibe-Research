import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Search, FileText, Newspaper, Loader2, AlertCircle, LineChart, BarChart3, Megaphone,
  Wallet, Trophy, CalendarClock, Boxes, MessageSquare, Users,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { EarningsSnapshot } from "@/components/ui/EarningsSnapshot";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { MarketStockView } from "@/components/market/EuropeanStockView";
import { SkillAnalysisPanel } from "@/components/market/SkillAnalysisPanel";
import { PriceHistoryChart } from "@/components/market/PriceHistoryChart";
import {
  api, ApiError, type Valuation, type Report, type NewsItem, type ValPercentile, type ValMetric,
  type Financials, type Announcement, type MarginRow, type BlockTradeRow, type HolderRow,
  type DividendRow, type FundFlowRow, type DragonTiger, type Lockup, type Blocks, type HotConcept, type QaRow,
  type GlobalStock, type HkCashflow, type MarketSnapshot, type MarketHistoricalSeries,
  type MarketNews, type MarketEarnings, type SecFilings, type SecFacts,
} from "@/lib/api";
import { isUSSymbol, stockDataRoute } from "@/lib/market-symbols";
import { cn } from "@/lib/utils";
import { getLocale, useLocale } from "@/lib/i18n";

// 金额格式化（后端资金单位：元 / 万元）
const yi = (v: number) => getLocale() === "en"
  ? `${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} Million CNY`
  : `${(v / 1e8).toFixed(2)} 亿`;

const fmt = (v: number | null | undefined, suffix = "") =>
  v === null || v === undefined ? "—" : `${v}${suffix}`;

// International convention: green up, red down.
const pctColor = (p: number | null | undefined) =>
  p != null && p > 0 ? "text-success" : p != null && p < 0 ? "text-danger" : "text-muted-foreground";
const pctStr = (p: number | null | undefined) => (p == null ? "—" : `${p > 0 ? "+" : ""}${p}%`);
// 美/港股金额（原生币种）
const curOf = (market: string) => getLocale() === "en" ? (market === "HK" ? "HKD" : market === "KR" ? "KRW" : "USD") : (market === "HK" ? "港元" : market === "KR" ? "韩元" : "美元");
const mktName = (m: string) => getLocale() === "en" ? (m === "HK" ? "Hong Kong stock" : m === "KR" ? "Korean stock" : "US stock") : (m === "HK" ? "港股" : m === "KR" ? "韩股" : "美股");
const bigMoney = (v: number | null, market: string) =>
  v == null ? "—" : getLocale() === "en"
    ? `${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} Million ${curOf(market)}`
    : v >= 1e12 ? `${(v / 1e12).toFixed(2)} 万亿${curOf(market)}` : `${(v / 1e8).toFixed(0)} 亿${curOf(market)}`;
const round2 = (v: number | null | undefined, suffix = "") =>
  v == null ? "—" : `${Math.round(v * 100) / 100}${suffix}`;

// 百分比：后端偶发给 null/缺字段时显示 —，不出现 "NaN%" / 误导性 "0.00%"
const pct = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : `${Number(v).toFixed(2)}%`;

// 小指标块（复用于资金面/筹码卡）
function Metric({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{k}</p>
      <p className="mt-0.5 font-mono text-base font-bold">{v}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// 估值历史分位带（理杏仁式）：绿=低估区 / 灰=合理区 / 红=高估区；只给位置，不划买卖。
function ValBand({ label, m }: { label: string; m: ValMetric }) {
  const { tr } = useLocale();
  const span = Math.max(m.max - m.min, 1e-6);
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - m.min) / span) * 100));
  const p20 = pos(m.p20), p80 = pos(m.p80), cur = pos(m.current);
  const zoneColor = m.percentile < 20 ? "text-success" : m.percentile > 80 ? "text-danger" : "text-muted-foreground";
  const zoneLabel = m.percentile < 20 ? tr("Low zone", "低估区") : m.percentile > 80 ? tr("High zone", "高估区") : tr("Middle zone", "合理区");
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-1 text-sm">
        <span className="font-medium">{label} <span className="text-xs text-muted-foreground/60">{m.n} {tr("points", "点")}</span></span>
        <span className="text-muted-foreground">{tr("Current", "当前")} <b className="font-mono text-foreground">{m.current}</b> · {tr("5-year percentile", "近5年分位")} <b className={cn("font-mono", zoneColor)}>{m.percentile}%</b> {tr("(", "（")}<span className={zoneColor}>{zoneLabel}</span>{tr(")", "）")}</span>
      </div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full">
        <div className="absolute inset-0 flex">
          <div className="bg-success/35" style={{ width: `${p20}%` }} />
          <div className="bg-muted" style={{ width: `${p80 - p20}%` }} />
          <div className="flex-1 bg-danger/35" />
        </div>
        <div className="absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded bg-foreground shadow" style={{ left: `${cur}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground/60">
        <span>{tr("Low", "低")} {m.min}</span><span>20% {m.p20}</span><span>{tr("Median", "中")} {m.p50}</span><span>80% {m.p80}</span><span>{tr("High", "高")} {m.max}</span>
      </div>
    </div>
  );
}

export function StockData() {
  const { locale, tr } = useLocale();
  const [assetType, setAssetType] = useState<"equity" | "crypto">("equity");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [val, setVal] = useState<Valuation | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [pctl, setPctl] = useState<ValPercentile | null>(null);
  const [fin, setFin] = useState<Financials | null>(null);
  const [anns, setAnns] = useState<Announcement[]>([]);
  const [depNote, setDepNote] = useState<string | null>(null);
  // 资金面 / 筹码 / 信号（v3.3 并入）
  const [margin, setMargin] = useState<MarginRow[]>([]);
  const [blockT, setBlockT] = useState<BlockTradeRow[]>([]);
  const [holders, setHolders] = useState<HolderRow[]>([]);
  const [dividend, setDividend] = useState<DividendRow[]>([]);
  const [fundFlow, setFundFlow] = useState<FundFlowRow[]>([]);
  const [dt, setDt] = useState<DragonTiger | null>(null);
  const [lockup, setLockup] = useState<Lockup | null>(null);
  const [blocks, setBlocks] = useState<Blocks | null>(null);
  const [hotCon, setHotCon] = useState<HotConcept[]>([]);
  const [qa, setQa] = useState<QaRow[]>([]);
  const [gstock, setGStock] = useState<GlobalStock | null>(null);  // 美股 / 港股
  const [cashflow, setCashflow] = useState<HkCashflow | null>(null);  // 港股现金流量表（仅港股）
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(null);
  const [marketHistory, setMarketHistory] = useState<MarketHistoricalSeries | null>(null);
  const [marketNews, setMarketNews] = useState<MarketNews | null>(null);
  const [marketEarnings, setMarketEarnings] = useState<MarketEarnings | null>(null);
  const [marketFilings, setMarketFilings] = useState<SecFilings | null>(null);
  const [marketSecFacts, setMarketSecFacts] = useState<SecFacts | null>(null);
  const [marketSourceGaps, setMarketSourceGaps] = useState<string[]>([]);
  const [aShareHistory, setAShareHistory] = useState<MarketHistoricalSeries | null>(null);
  const runIdRef = useRef(0);

  const run = async () => {
    const c = code.trim().toUpperCase();
    if (!c) { setErr(tr("Enter a symbol", "请输入代码")); return; }
    const rid = ++runIdRef.current;
    setLoading(true); setErr(null); setDepNote(null); setVal(null); setReports([]); setNews([]); setPctl(null); setFin(null); setAnns([]);
    setMargin([]); setBlockT([]); setHolders([]); setDividend([]); setFundFlow([]); setDt(null); setLockup(null); setBlocks(null); setHotCon([]); setQa([]);
    setGStock(null); setCashflow(null); setMarketSnapshot(null); setMarketHistory(null);
    setMarketNews(null); setMarketEarnings(null); setMarketFilings(null); setMarketSecFacts(null); setMarketSourceGaps([]);
    setAShareHistory(null);

    if (assetType === "crypto") {
      try {
        const [snapshot, history] = await Promise.all([
          api.marketSnapshot(c, "crypto"),
          api.marketBars(c, "1y", "1d", "crypto"),
        ]);
        if (rid === runIdRef.current) {
          setCode(snapshot.instrument.symbol);
          setMarketSnapshot(snapshot);
          setMarketHistory(history);
          setMarketSourceGaps(locale === "en" ? ["Traditional company fundamentals and valuation do not apply", "On-chain flows and token unlock data are not integrated"] : ["传统公司基本面与估值不适用", "链上资金流与代币解锁数据尚未接入"]);
        }
      } catch (e) {
        if (rid === runIdRef.current) setErr(e instanceof ApiError ? e.message : tr("Query failed", "查询失败"));
      } finally {
        if (rid === runIdRef.current) setLoading(false);
      }
      return;
    }

    const route = stockDataRoute(c);

    // 显式欧洲交易所后缀走新的规范化数据路径；不改变现有 A 股和 global fallback。
    if (route === "market") {
      const noteGap = (label: string) => (error: unknown) => {
        if (rid !== runIdRef.current) return;
        const detail = error instanceof ApiError ? error.message : tr("Data source is currently unavailable", "数据源当前不可达");
        setMarketSourceGaps((current) => [...current, `${label}：${detail}`]);
      };
      api.marketNews(c).then((data) => { if (rid === runIdRef.current) setMarketNews(data); }).catch(noteGap(tr("News", "新闻")));
      api.marketEarnings(c).then((data) => { if (rid === runIdRef.current) setMarketEarnings(data); }).catch(noteGap("Earnings"));
      if (isUSSymbol(c)) {
        api.marketFilings(c).then((data) => { if (rid === runIdRef.current) setMarketFilings(data); }).catch(noteGap(tr("SEC filings", "SEC 文件")));
        api.marketSecFacts(c).then((data) => { if (rid === runIdRef.current) setMarketSecFacts(data); }).catch(noteGap(tr("SEC fundamentals", "SEC 基本面")));
      }
      try {
        const [snapshot, history, supplemental] = await Promise.all([
          api.marketSnapshot(c),
          api.marketBars(c, "1y", "1d"),
          isUSSymbol(c) ? api.globalStock(c).catch(() => null) : Promise.resolve(null),
        ]);
        if (rid === runIdRef.current) {
          setMarketSnapshot(snapshot);
          setMarketHistory(history);
          setGStock(supplemental);
        }
      } catch (e) {
        if (rid === runIdRef.current) setErr(e instanceof ApiError ? e.message : tr("Query failed", "查询失败"));
      } finally {
        if (rid === runIdRef.current) setLoading(false);
      }
      return;
    }

    // 非 A 股、非显式欧洲后缀：保持原有美股 / 港股 / 韩股路径。
    if (route === "global") {
      // 港股现金流独立回填（美股返回 404 → 静默留空，卡片不渲染）
      api.hkCashflow(c).then((cf) => { if (rid === runIdRef.current) setCashflow(cf); }).catch(() => { if (rid === runIdRef.current) setCashflow(null); });
      try {
        const g = await api.globalStock(c);
        if (rid === runIdRef.current) setGStock(g);
      } catch (e) {
        if (rid === runIdRef.current) setErr(e instanceof ApiError ? e.message : tr("Query failed", "查询失败"));
      } finally {
        if (rid === runIdRef.current) setLoading(false);
      }
      return;
    }

    // A 股：竞态守卫（快速换代码时只让最新一次回填）+ 资金面/筹码独立回填、不阻塞主数据
    const ok = <T,>(set: (v: T) => void) => (v: T) => { if (rid === runIdRef.current) set(v); };
    api.margin(c).then(ok(setMargin)).catch(() => {});
    api.blockTrade(c).then(ok(setBlockT)).catch(() => {});
    api.holders(c).then(ok(setHolders)).catch(() => {});
    api.dividend(c).then(ok(setDividend)).catch(() => {});
    api.fundFlow(c).then(ok(setFundFlow)).catch(() => {});
    api.dragonTiger(c).then(ok(setDt)).catch(() => {});
    api.lockup(c).then(ok(setLockup)).catch(() => {});
    api.blocks(c).then(ok(setBlocks)).catch(() => {});
    api.hotConcepts(c).then(ok(setHotCon)).catch(() => {});
    api.investorQa(c).then(ok(setQa)).catch(() => {});
    api.aShareBars(c).then((aBars) => {
      if (rid !== runIdRef.current) return;
      setAShareHistory({
        provider_symbol: c,
        range: "240d",
        interval: "1d",
        source: "mootdx",
        fetched_at: new Date().toISOString(),
        bars: aBars.map((bar) => ({
          date: String(bar.date),
          open: bar.open == null ? null : Number(bar.open),
          high: bar.high == null ? null : Number(bar.high),
          low: bar.low == null ? null : Number(bar.low),
          close: bar.close == null ? null : Number(bar.close),
          adjusted_close: bar.close == null ? null : Number(bar.close),
          volume: bar.volume == null ? null : Number(bar.volume),
          currency: "CNY",
        })),
      });
    }).catch(() => {});
    try {
      // 行情+估值+研报+历史分位+财务+公告（新闻单独降级）
      const [v, r, p, f, a] = await Promise.all([
        api.valuation(c),
        api.reports(c).catch(() => []),
        api.percentile(c).catch(() => null),
        api.financials(c).catch(() => null),
        api.announcements(c).catch(() => []),
      ]);
      if (rid !== runIdRef.current) return;
      setVal(v);
      setReports(r);
      setPctl(p);
      setFin(f);
      setAnns(a);
      try {
        const n = await api.news(c);
        if (rid === runIdRef.current) setNews(n);
      } catch (e) {
        if (rid === runIdRef.current && e instanceof ApiError && e.status === 501) setDepNote(e.message);
      }
    } catch (e) {
      if (rid !== runIdRef.current) return;
      setErr(e instanceof ApiError ? e.message : tr("Query failed", "查询失败"));
    } finally {
      if (rid === runIdRef.current) setLoading(false);
    }
  };

  const metrics = val ? [
    { k: tr("Price", "现价"), v: fmt(val.price) },
    { k: "PE(TTM)", v: fmt(val.pe_ttm) },
    { k: "PB", v: fmt(val.pb) },
    { k: tr("Market cap", "总市值"), v: locale === "en" ? fmt(val.mcap_yi == null ? null : val.mcap_yi * 100, " Million CNY") : fmt(val.mcap_yi, " 亿") },
    { k: "26E EPS", v: fmt(val.eps_26e) },
    { k: tr("Forward PE", "前向PE"), v: fmt(val.pe_26e) },
    { k: "PEG", v: fmt(val.peg) },
    { k: tr("Years to digest", "消化年数"), v: fmt(val.digest_years, tr(" years", " 年")) },
  ] : [];

  const aiContext = val
    ? `Stock: ${val.name} (${val.code})\nPrice ${val.price}; PE (TTM) ${val.pe_ttm}; PB ${val.pb}; market cap ${val.mcap_yi == null ? "—" : val.mcap_yi * 100} Million CNY\n` +
      `26E EPS ${val.eps_26e ?? "—"}; forward PE ${val.pe_26e ?? "—"}; PEG ${val.peg ?? "—"}; valuation digestion ${val.digest_years ?? "—"} years; ${val.analyst_count} institutions covering\n` +
      (pctl?.metrics.pe_ttm ? `Five-year valuation percentiles: PE-TTM ${pctl.metrics.pe_ttm.percentile}%; PB ${pctl.metrics.pb?.percentile ?? "—"}%\n` : "") +
      (fin?.revenue ? `Financials (${fin.period ?? "—"}): revenue ${fin.revenue} (YoY ${fin.revenue_yoy ?? "—"}); net income ${fin.net_profit ?? "—"} (YoY ${fin.net_profit_yoy ?? "—"}); ROE ${fin.roe ?? "—"}; gross margin ${fin.gross_margin ?? "—"}\n` : "") +
      (anns.length ? `Recent announcements: ${anns.slice(0, 5).map((a) => a.title.replace(/^[^:：]*[:：]/, "")).join("; ")}\n` : "") +
      `Recent research reports: ${reports.slice(0, 5).map((r) => r.title).join("; ") || "none"}`
    : "No stock has been queried. Enter a Chinese, US, or European stock symbol to analyze the integrated objective data.";

  const gAiContext = gstock
    ? `Stock (${gstock.market}): ${gstock.name} (${gstock.code})\n` +
      `Price ${gstock.quote.price ?? "—"}; change ${pctStr(gstock.quote.change_pct)}; market cap ${bigMoney(gstock.quote.mcap, gstock.market)}\n` +
      (gstock.metrics
        ? `Financials (${gstock.metrics.report_date}): revenue ${bigMoney(gstock.metrics.revenue, gstock.market)} (YoY ${round2(gstock.metrics.revenue_yoy, "%")}); net income ${bigMoney(gstock.metrics.net_profit, gstock.market)}; EPS ${gstock.metrics.eps ?? "—"}; ROE ${round2(gstock.metrics.roe, "%")}; gross margin ${round2(gstock.metrics.gross_margin, "%")}; net margin ${round2(gstock.metrics.net_margin, "%")}; debt ratio ${round2(gstock.metrics.debt_ratio, "%")}`
        : "")
    : "";
  const marketAiContext = marketSnapshot && marketHistory
    ? `${marketSnapshot.instrument.asset_type === "crypto" ? "Cryptocurrency" : "Stock"}: ${marketSnapshot.instrument.name} (${marketSnapshot.instrument.provider_symbol})\n` +
      `Exchange ${marketSnapshot.instrument.exchange}; price ${marketSnapshot.quote.price ?? "—"} ${marketSnapshot.quote.currency}; change ${pctStr(marketSnapshot.quote.change_pct)}\n` +
      `${marketHistory.bars.length} daily bars over the past year; source ${marketSnapshot.quote.source}.\n` +
      (gstock?.metrics ? gAiContext : "Fundamentals, announcements, filings, and company news are incomplete. Explicitly disclose these gaps in the analysis.")
    : "";

  return (
    <div>
      <PageHeader
        title={tr("Instrument data", "标的数据")}
        subtitle={tr("Stocks and crypto share prices, charts, and compatible analysis skills; specialized data is clearly separated by availability", "股票与加密货币共享行情、图表和兼容技能；专项数据按能力明确区分")}
        actions={(val || gstock || marketSnapshot) && (
          <div className="flex flex-wrap gap-2"><AskAiButton
            workflow="stock"
            context={marketSnapshot ? marketAiContext : gstock ? gAiContext : aiContext}
            // 本页不换路由就能换标的，必须按代码分开存对话，否则会串台。
            // ⚠️ 用**已解析结果**的代码，不能用输入框的 code——后者一边打字一边变，
            // 而 val/gstock 和 AI 上下文仍描述上一只票，会把旧上下文存到新代码名下。
            scopeKey={marketSnapshot ? `m:${marketSnapshot.instrument.provider_symbol}` : gstock ? `g:${gstock.code}` : val?.code}
            label={tr("Ask AI to analyze this data", "让 AI 读这些数据")}
            suggestions={(gstock || marketSnapshot)
              ? (marketSnapshot?.instrument.asset_type === "crypto" ? (locale === "en" ? ["What characterizes the price structure?", "What is the market environment?", "What data is missing?"] : ["价格结构有什么特征", "市场环境如何", "有哪些数据缺口"]) : (locale === "en" ? ["How are the fundamentals?", "How is profitability?", "What are the risks?"] : ["这家公司基本面怎么样", "盈利能力如何", "有什么风险"]))
              : (locale === "en" ? ["How demanding is the valuation?", "What does consensus imply?", "Where do recent reports disagree?", "What are the risks?"] : ["这个估值贵不贵", "机构一致预期怎么看", "近期研报的分歧点", "有什么风险"])}
          /><Link to={`/debate?mode=team&asset_type=${assetType}&code=${encodeURIComponent(marketSnapshot?.instrument.provider_symbol || gstock?.code || val?.code || code)}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-sm text-muted-foreground hover:text-primary"><Users className="h-4 w-4" />{tr("Research team", "研究团队")}</Link></div>
        )}
      />

      <div className="mb-3 flex w-fit gap-1 rounded-lg border border-border/60 bg-muted/20 p-1">
        {([['equity', tr('Stocks', '股票')], ['crypto', tr('Crypto', '加密货币')]] as const).map(([value, label]) => <button key={value} onClick={() => { setAssetType(value); setCode(""); setErr(null); setMarketSnapshot(null); setMarketHistory(null); }} className={`rounded-md px-4 py-1.5 text-sm ${assetType === value ? "bg-background text-primary shadow-sm" : "text-muted-foreground"}`}>{label}</button>)}
      </div>

      {/* 查询框 */}
      <div className="mb-5 flex flex-wrap gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9.-]/g, "").toUpperCase().slice(0, 24))}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder={assetType === "crypto" ? "BTC / ETH / SOL" : tr("Chinese, US (AAPL), or European symbol (VOD.L / SAP.DE)", "A股、美股（AAPL）或欧洲代码（VOD.L / SAP.DE）")}
          aria-label={assetType === "crypto" ? tr("Cryptocurrency symbol", "加密货币代码") : tr("Stock symbol", "股票代码")}
          className="min-w-0 flex-1 basis-64 rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50"
        />
        <button
          onClick={run}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary shadow-glow hover:bg-primary/25 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {tr("Search", "查询")}
        </button>
      </div>

      {err && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      {marketSnapshot && marketHistory && (
        <MarketStockView
          snapshot={marketSnapshot}
          history={marketHistory}
          news={marketNews}
          earnings={marketEarnings}
          filings={marketFilings}
          secFacts={marketSecFacts}
          sourceGaps={marketSourceGaps}
        />
      )}

      {/* 美股 / 港股视图（global-stock-data，东财域内源） */}
      {gstock && (
        <>
          {!marketSnapshot && <GlassCard glow className="mb-4">
            <div className="mb-4 flex items-baseline gap-2">
              <h2 className="text-xl font-bold">{gstock.name}</h2>
              <span className="font-mono text-sm text-muted-foreground">{gstock.code}</span>
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">{gstock.market}</span>
              <span className="ml-auto text-xs text-muted-foreground">{mktName(gstock.market)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { k: tr("Price", "现价"), v: fmt(gstock.quote.price), cls: pctColor(gstock.quote.change_pct) },
                { k: tr("Change", "涨跌幅"), v: pctStr(gstock.quote.change_pct), cls: pctColor(gstock.quote.change_pct) },
                { k: tr("Market cap", "总市值"), v: bigMoney(gstock.quote.mcap, gstock.market), cls: "" },
                { k: tr("Turnover", "成交额"), v: bigMoney(gstock.quote.amount, gstock.market), cls: "" },
                { k: tr("Open", "开盘"), v: fmt(gstock.quote.open), cls: "" },
                { k: tr("High", "最高"), v: fmt(gstock.quote.high), cls: "" },
                { k: tr("Low", "最低"), v: fmt(gstock.quote.low), cls: "" },
                { k: tr("Previous close", "昨收"), v: fmt(gstock.quote.prev_close), cls: "" },
              ].map((m) => (
                <div key={m.k} className="rounded-lg bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{m.k}</p>
                  <p className={cn("mt-0.5 font-mono text-base font-bold", m.cls)}>{m.v}</p>
                </div>
              ))}
            </div>
          </GlassCard>}

          {gstock.metrics && (
            <GlassCard className="mb-4">
              <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                <BarChart3 className="h-4 w-4 text-primary" /> {tr("Key financial metrics", "关键财务指标")}
                <span className="text-xs font-normal text-muted-foreground/60">· {gstock.metrics.report_date}</span>
              </h3>
              <p className="mb-3 text-[11px] text-muted-foreground/60">{tr("Eastmoney GMAININDICATOR, latest reporting period. Amounts use the native currency.", "东财 GMAININDICATOR，最新报告期。金额为原生币种。")}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { k: tr("Revenue", "营业收入"), v: bigMoney(gstock.metrics.revenue, gstock.market), yoy: gstock.metrics.revenue_yoy != null ? round2(gstock.metrics.revenue_yoy, "%") : "" },
                  { k: tr("Net income", "归母净利"), v: bigMoney(gstock.metrics.net_profit, gstock.market), yoy: "" },
                  { k: tr("EPS", "每股收益 EPS"), v: round2(gstock.metrics.eps), yoy: "" },
                  { k: "ROE", v: round2(gstock.metrics.roe, "%"), yoy: "" },
                  { k: tr("Gross margin", "毛利率"), v: round2(gstock.metrics.gross_margin, "%"), yoy: "" },
                  { k: tr("Net margin", "净利率"), v: round2(gstock.metrics.net_margin, "%"), yoy: "" },
                  { k: tr("Debt ratio", "资产负债率"), v: round2(gstock.metrics.debt_ratio, "%"), yoy: "" },
                ].map((m) => (
                  <div key={m.k} className="rounded-lg bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">{m.k}</p>
                    <p className="mt-0.5 font-mono text-base font-bold">{m.v}</p>
                    {m.yoy && <p className="text-[11px] text-muted-foreground">{tr("YoY", "同比")} {m.yoy}</p>}
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {cashflow && cashflow.periods.length > 0 && (
            <GlassCard className="mb-4">
              <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                <BarChart3 className="h-4 w-4 text-primary" /> {tr("Cash flow statement", "现金流量表")}
                <span className="text-xs font-normal text-muted-foreground/60">· {tr("Unit: Million ", "单位：亿")}{cashflow.currency ?? ""}</span>
              </h3>
              <p className="mb-3 text-[11px] text-muted-foreground/60">{tr("Eastmoney RPT_HKSK_FN_CASHFLOW · quarterly figures are year-to-date · negative cash outflows are shown in green.", "东财 RPT_HKSK_FN_CASHFLOW · 季度为年初至今累计 · 负数（现金流出）标绿。")}</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="py-1 pr-3 text-left font-normal">{tr("Item", "科目")}</th>
                      {cashflow.periods.slice(0, 5).map((p) => (
                        <th key={p.report_date} className="px-2 py-1 text-right font-normal">{p.report_date.slice(0, 7)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cashflow.item_order.map((it) => (
                      <tr key={it} className="border-t border-border/40">
                        <td className="py-1.5 pr-3 text-muted-foreground">{it}</td>
                        {cashflow.periods.slice(0, 5).map((p) => {
                          const amt = p.items[it]?.amount ?? null;
                          return (
                            <td key={p.report_date} className={cn("px-2 py-1.5 text-right font-mono", amt != null && amt < 0 ? "text-success" : "")}>
                              {amt == null ? "—" : (amt / (locale === "en" ? 1e6 : 1e8)).toFixed(1)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          )}

          <p className="text-xs text-muted-foreground/60">
            {tr("US and Hong Kong data comes from public market sources · Amounts use the native currency · Objective data only, not investment advice.", "美股 / 港股数据来自公开市场数据源 · 金额为原生币种 · 仅客观数据，不含买卖建议。")}
          </p>
        </>
      )}

      {val && (
        <>
          {aShareHistory && aShareHistory.bars.length > 0 && <GlassCard className="mb-4">
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><LineChart className="h-4 w-4 text-primary" /> 日线行情 · {aShareHistory.range}</h3>
            <p className="mb-2 text-[11px] text-muted-foreground/60">{tr("A-share daily trend and volume; drag the lower range to zoom.", "A 股日线趋势与成交量；拖动底部区间可缩放。")}</p>
            <PriceHistoryChart bars={aShareHistory.bars} currency="CNY" />
          </GlassCard>}
          <GlassCard glow className="mb-4">
            <div className="mb-4 flex items-baseline gap-2">
              <h2 className="text-xl font-bold">{val.name}</h2>
              <span className="font-mono text-sm text-muted-foreground">{val.code}</span>
              {val.analyst_count > 0 && (
                <span className="ml-auto text-xs text-muted-foreground">机构覆盖 {val.analyst_count} 家</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {metrics.map((m) => (
                <div key={m.k} className="rounded-lg bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{m.k}</p>
                  <p className="mt-0.5 font-mono text-lg font-bold">{m.v}</p>
                </div>
              ))}
            </div>
            {val.forecast_note && (
              <p className="mt-3 text-xs text-warning">{val.forecast_note}</p>
            )}
          </GlassCard>

          {/* 财报速览（结论先行摘要，借鉴 equity-research 的结构纪律，剔除评级/目标价） */}
          <EarningsSnapshot val={val} fin={fin} pctl={pctl} />

          {pctl && (pctl.metrics.pe_ttm || pctl.metrics.pb) && (
            <GlassCard glow className="mb-4">
              <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><LineChart className="h-4 w-4 text-primary" /> 估值历史分位 · {pctl.period}</h3>
              <p className="mb-4 text-[11px] text-muted-foreground/60">{tr("Green = low zone / grey = middle zone / red = high zone. This shows historical position only and is not trading advice.", "绿=低估区 / 灰=合理区 / 红=高估区。只显示当前处于历史什么位置，不构成买卖建议。")}</p>
              <div className="space-y-4">
                {pctl.metrics.pe_ttm && <ValBand label="PE-TTM" m={pctl.metrics.pe_ttm} />}
                {pctl.metrics.pb && <ValBand label={tr("Price-to-book PB", "市净率 PB")} m={pctl.metrics.pb} />}
              </div>
            </GlassCard>
          )}

          {fin && (fin.revenue || fin.roe) && (
            <GlassCard className="mb-4">
              <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><BarChart3 className="h-4 w-4 text-primary" /> {tr("Key financial metrics", "财务关键指标")}{fin.period && <span className="text-xs font-normal text-muted-foreground/60">· {fin.period}</span>}</h3>
              <p className="mb-3 text-[11px] text-muted-foreground/60">{tr("Tonghuashun financial summary, latest reporting period.", "同花顺财务摘要，最新报告期。")}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { k: tr("Revenue", "营业总收入"), v: fin.revenue, yoy: fin.revenue_yoy },
                  { k: tr("Net income", "归母净利润"), v: fin.net_profit, yoy: fin.net_profit_yoy },
                  { k: tr("EPS", "每股收益"), v: fin.eps },
                  { k: "ROE", v: fin.roe },
                  { k: tr("Gross margin", "销售毛利率"), v: fin.gross_margin },
                  { k: tr("Net margin", "销售净利率"), v: fin.net_margin },
                  { k: tr("Book value per share", "每股净资产"), v: fin.bvps },
                  { k: tr("Operating cash flow per share", "每股经营现金流"), v: fin.op_cf_ps },
                ].map((m) => (
                  <div key={m.k} className="rounded-lg bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">{m.k}</p>
                    <p className="mt-0.5 font-mono text-base font-bold">{m.v ?? "—"}</p>
                    {m.yoy && <p className="text-[11px] text-muted-foreground">同比 {m.yoy}</p>}
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {reports.length > 0 && (
            <GlassCard className="mb-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><FileText className="h-4 w-4 text-primary" /> 近期研报（{reports.length}）</h3>
              <div className="space-y-2">
                {reports.slice(0, 12).map((r, i) => (
                  <div key={i} className="flex items-center gap-3 border-b border-border/40 pb-2 text-sm last:border-0">
                    <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{(r.publishDate || "").slice(0, 10)}</span>
                    <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{r.orgSName}</span>
                    {r.pdfUrl ? (
                      <a href={r.pdfUrl} target="_blank" rel="noreferrer" className="flex-1 truncate hover:text-primary">{r.title}</a>
                    ) : (
                      <span className="flex-1 truncate">{r.title}</span>
                    )}
                    {r.emRatingName && <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{r.emRatingName}</span>}
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {anns.length > 0 && (
            <GlassCard className="mb-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Megaphone className="h-4 w-4 text-primary" /> 近期公告（{anns.length}）</h3>
              <div className="space-y-2">
                {anns.slice(0, 12).map((a, i) => (
                  <div key={i} className="flex items-center gap-3 border-b border-border/40 pb-2 text-sm last:border-0">
                    <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{a.date}</span>
                    {a.type && <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{a.type}</span>}
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noreferrer" className="flex-1 truncate hover:text-primary">{a.title.replace(/^[^:：]*[:：]/, "")}</a>
                    ) : (
                      <span className="flex-1 truncate">{a.title}</span>
                    )}
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          <GlassCard>
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Newspaper className="h-4 w-4 text-primary" /> {tr("Company news", "个股新闻")}</h3>
            {depNote ? (
              <p className="text-xs text-warning">{depNote}（安装后新闻/公告即可用）</p>
            ) : news.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">{tr("No news", "暂无新闻")}</p>
            ) : (
              <div className="space-y-2">
                {news.slice(0, 10).map((n, i) => (
                  <div key={i} className="flex items-center gap-3 border-b border-border/40 pb-2 text-sm last:border-0">
                    <span className="w-28 shrink-0 font-mono text-xs text-muted-foreground">{(n.发布时间 || "").slice(0, 16)}</span>
                    {n.新闻链接 ? (
                      <a href={n.新闻链接} target="_blank" rel="noreferrer" className="flex-1 truncate hover:text-primary">{n.新闻标题}</a>
                    ) : (
                      <span className="flex-1 truncate">{n.新闻标题}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          {/* 资金面 · 筹码（融资融券 / 股东户数 / 主力资金流 / 分红 / 大宗交易） */}
          {(margin.length > 0 || holders.length > 0 || fundFlow.length > 0 || dividend.length > 0) && (
            <GlassCard className="mb-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Wallet className="h-4 w-4 text-primary" /> {tr("Flows and ownership", "资金面 · 筹码")}</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {margin[0] && <Metric k={tr("Margin financing balance", "融资余额")} v={yi(margin[0].rzye)} sub={margin[0].date} />}
                {margin[0] && <Metric k={tr("Securities lending balance", "融券余额")} v={yi(margin[0].rqye)} />}
                {holders[0] && <Metric k={tr("Shareholder count", "股东户数")} v={Number(holders[0].holder_num).toLocaleString()} sub={`${tr("QoQ", "环比")} ${pct(holders[0].change_ratio)}`} />}
                {fundFlow.length > 0 && <Metric k={tr("20-day main net inflow", "近20日主力净流入")} v={yi(fundFlow.slice(-20).reduce((s, r) => s + r.main_net, 0))} />}
                {dividend[0] && <Metric k={tr("Latest dividend (per 10 shares)", "最近派息(每10股)")} v={`${dividend[0].bonus_rmb} ${tr("CNY", "元")}`} sub={dividend[0].date} />}
              </div>
              {blockT.length > 0 && (
                <div className="mt-3 border-t border-border/40 pt-3">
                  <p className="mb-2 text-xs text-muted-foreground">近期大宗交易（{blockT.length}）</p>
                  <div className="space-y-1.5">
                    {blockT.slice(0, 5).map((b, i) => (
                      <div key={i} className="flex items-center gap-3 text-xs">
                        <span className="w-20 shrink-0 font-mono text-muted-foreground">{b.date}</span>
                        <span className="w-14 shrink-0">{b.price} 元</span>
                        <span className={cn("w-20 shrink-0", b.premium_pct >= 0 ? "text-danger" : "text-success")}>折溢 {b.premium_pct}%</span>
                        <span className="flex-1 truncate text-muted-foreground">买 {b.buyer} · 卖 {b.seller}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground/60">{tr("Flow and ownership figures are objective public data for understanding current conditions; they are not trading advice.", "资金/筹码为公开客观数据，仅供了解该股当前状态，不构成任何买卖建议。")}</p>
            </GlassCard>
          )}

          {/* 龙虎榜 */}
          {dt && dt.records.length > 0 && (
            <GlassCard className="mb-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Trophy className="h-4 w-4 text-primary" /> 龙虎榜（近30日 {dt.records.length} 次）</h3>
              <div className="space-y-2">
                {dt.records.slice(0, 6).map((r, i) => (
                  <div key={i} className="flex items-center gap-3 border-b border-border/40 pb-2 text-sm last:border-0">
                    <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{r.date}</span>
                    <span className="flex-1 truncate">{r.reason}</span>
                    <span className={cn("shrink-0 font-mono text-xs", r.net_buy >= 0 ? "text-danger" : "text-success")}>净买 {r.net_buy} 万</span>
                  </div>
                ))}
              </div>
              {(dt.seats.buy.length > 0 || dt.seats.sell.length > 0) && (
                <div className="mt-3 grid gap-4 border-t border-border/40 pt-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-danger">{tr("Top buying seats", "买入席位 TOP")}</p>
                    {dt.seats.buy.map((s, i) => (
                      <div key={i} className="flex justify-between gap-2 text-xs text-muted-foreground"><span className="truncate">{s.name}</span><span className="shrink-0 font-mono">净{s.net}万</span></div>
                    ))}
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-success">{tr("Top selling seats", "卖出席位 TOP")}</p>
                    {dt.seats.sell.map((s, i) => (
                      <div key={i} className="flex justify-between gap-2 text-xs text-muted-foreground"><span className="truncate">{s.name}</span><span className="shrink-0 font-mono">净{s.net}万</span></div>
                    ))}
                  </div>
                </div>
              )}
            </GlassCard>
          )}

          {/* 限售解禁 */}
          {lockup && (lockup.upcoming.length > 0 || lockup.history.length > 0) && (
            <GlassCard className="mb-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><CalendarClock className="h-4 w-4 text-primary" /> {tr("Lock-up expirations", "限售解禁")}</h3>
              {lockup.upcoming.length > 0 ? (
                <div className="mb-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
                  <p className="mb-1.5 text-xs font-medium text-warning">未来 90 天待解禁（{lockup.upcoming.length}）</p>
                  {lockup.upcoming.slice(0, 4).map((h, i) => (
                    <div key={i} className="flex items-center gap-3 text-xs"><span className="w-20 shrink-0 font-mono text-muted-foreground">{h.date}</span><span className="flex-1 truncate">{h.type}</span><span className="shrink-0 text-muted-foreground">占比 {pct(h.ratio)}</span></div>
                  ))}
                </div>
              ) : (
                <p className="mb-2 text-xs text-muted-foreground/70">{tr("No lock-up expirations in the next 90 days.", "未来 90 天无待解禁。")}</p>
              )}
              {lockup.history.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs text-muted-foreground">历史解禁（近 {Math.min(lockup.history.length, 5)}）</p>
                  {lockup.history.slice(0, 5).map((h, i) => (
                    <div key={i} className="flex items-center gap-3 text-xs"><span className="w-20 shrink-0 font-mono text-muted-foreground">{h.date}</span><span className="flex-1 truncate text-muted-foreground">{h.type}</span></div>
                  ))}
                </div>
              )}
            </GlassCard>
          )}

          {/* 板块归属 · 概念 */}
          {((blocks && blocks.concept_tags.length > 0) || hotCon.length > 0) && (
            <GlassCard className="mb-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Boxes className="h-4 w-4 text-primary" /> {tr("Sector and themes", "板块归属 · 概念")}</h3>
              {blocks && blocks.concept_tags.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {blocks.concept_tags.slice(0, 24).map((t, i) => (
                    <span key={i} className="rounded-full border border-border/70 px-2 py-0.5 text-xs text-muted-foreground">{t}</span>
                  ))}
                </div>
              )}
              {hotCon.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs text-muted-foreground">{tr("Current hot-theme matches", "当下热门概念命中")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {hotCon.slice(0, 12).map((h, i) => (
                      <span key={i} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{h.concept}</span>
                    ))}
                  </div>
                </div>
              )}
            </GlassCard>
          )}

          {/* 投资者互动（互动易） */}
          {qa.filter((q) => q.answer).length > 0 && (
            <GlassCard className="mb-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><MessageSquare className="h-4 w-4 text-primary" /> {tr("Investor Q&A", "投资者互动（互动易）")}</h3>
              <div className="space-y-3">
                {qa.filter((q) => q.answer).slice(0, 5).map((q, i) => (
                  <div key={i} className="border-b border-border/40 pb-3 text-sm last:border-0">
                    <p className="text-muted-foreground"><span className="mr-1.5 rounded bg-muted/50 px-1.5 py-0.5 text-[10px]">{tr("Q", "问")}</span>{q.question}</p>
                    <p className="mt-1"><span className="mr-1.5 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">{tr("A", "答")}</span>{q.answer}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground/60">{q.ask_time}</p>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </>
      )}

      {!val && !gstock && !marketSnapshot && !err && !loading && (
        <GlassCard>
          <div className="py-10 text-center text-sm text-muted-foreground">
            {assetType === "crypto" ? tr("Enter a Coinbase USD spot symbol such as BTC, ETH, or SOL.", "输入 BTC、ETH、SOL 等 Coinbase USD 现货代码。") : tr("Enter an A-share, US, or exchange-qualified European stock symbol.", "输入 A 股、美股或带交易所后缀的欧洲股票代码。")}<br />
            <span className="text-xs text-muted-foreground/60">{assetType === "crypto" ? tr("Crypto provides Coinbase prices, UTC daily bars, and compatible skills; inapplicable company fundamentals are hidden.", "加密货币提供 Coinbase 行情、UTC 日线和兼容技能；不显示不适用的公司基本面。") : tr("International coverage initially provides Yahoo prices and history; fundamentals, filings, and news are shown according to connected sources.", "海外首期提供 Yahoo 行情与历史价格；基本面、公告和新闻按已接入来源如实显示。")}</span>
          </div>
        </GlassCard>
      )}

      <SkillAnalysisPanel
        key={marketSnapshot?.instrument.provider_symbol || val?.code || "none"}
        symbol={marketSnapshot?.instrument.provider_symbol || val?.code || null}
        supported={Boolean(marketSnapshot || val)}
        assetType={assetType}
      />

      <Disclaimer />
    </div>
  );
}
