import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Loader2, AlertCircle, RefreshCw, Gauge, ArrowDownUp, TrendingUp, TrendingDown, Plus, X, Flame, BarChart3, Globe } from "lucide-react";
import { SafeMarkdown } from "@/components/ui/SafeMarkdown";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api, ApiError, type IndexQuote, type Quote, type MarketOverview, type ShortTermEmotion, type TurnoverTop, type BenchmarkData, type IntelligenceFeed, type MarketOverviewData, type MarketMoodData } from "@/lib/api";
import { hasLlm, chatStream } from "@/lib/llm";
import { SaveNoteButton } from "@/components/ui/SaveNoteButton";
import { loadWatch, saveWatch, addCodes } from "@/lib/watchlist";
import { cn } from "@/lib/utils";

// International convention across the refocused app: green up, red down.
const pctColor = (p: number | null | undefined) => p != null && p > 0 ? "text-success" : p != null && p < 0 ? "text-danger" : "text-muted-foreground";
const fmt = (v: number) => v.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const pctText = (v: number | null | undefined) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
const yi = (v: number | null) => (v == null ? "—" : `${fmt(v / 1e8)} 亿`); // 元 → 亿
type MarketFocus = "US" | "Europe" | "CN";
const marketLabels: Record<MarketFocus, string> = { US: "美国", Europe: "欧洲", CN: "A股" };

export function DailyReview() {
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [idxErr, setIdxErr] = useState(false);
  const [benchmarks, setBenchmarks] = useState<BenchmarkData | null>(null);
  const [internationalOverview, setInternationalOverview] = useState<MarketOverviewData | null>(null);
  const [marketFocus, setMarketFocus] = useState<MarketFocus>("US");
  const [marketMood, setMarketMood] = useState<MarketMoodData | null>(null);
  const [moodDone, setMoodDone] = useState(false);
  const [review, setReview] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  const [needConfig, setNeedConfig] = useState(false);
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [emotion, setEmotion] = useState<ShortTermEmotion | null>(null);
  const [turnover, setTurnover] = useState<TurnoverTop | null>(null);
  const [intelligence, setIntelligence] = useState<IntelligenceFeed | null>(null);
  // 关注股票（自选，存本地）
  const [watchCodes, setWatchCodes] = useState<string[]>(loadWatch);
  const [watchQuotes, setWatchQuotes] = useState<Record<string, Quote>>({});
  const [watchInput, setWatchInput] = useState("");
  const [watchLoading, setWatchLoading] = useState(false);

  // 各数据块请求是否已结束：区分「加载中」与「数据源暂不可用」（非交易时段/被限流时后端返回空）
  const [ovDone, setOvDone] = useState(false);
  const [emoDone, setEmoDone] = useState(false);
  const [toDone, setToDone] = useState(false);

  const loadInternational = (codes: string[]) => {
    api.internationalOverview(codes).then((data) => {
      setInternationalOverview(data);
      setBenchmarks(data.benchmarks);
    }).catch(() => { setInternationalOverview(null); setBenchmarks(null); });
  };

  const loadMarketMood = (market: "US" | "Europe") => {
    setMoodDone(false);
    setMarketMood(null);
    api.marketMood(market).then(setMarketMood).catch(() => setMarketMood(null)).finally(() => setMoodDone(true));
  };

  const loadAShareTools = () => {
    setIdxErr(false); setOvDone(false); setEmoDone(false); setToDone(false);
    api.indices().then(setIndices).catch(() => setIdxErr(true));
    api.marketOverview().then(setOverview).catch(() => {}).finally(() => setOvDone(true));
    api.emotion().then(setEmotion).catch(() => {}).finally(() => setEmoDone(true));
    api.turnoverTop().then(setTurnover).catch(() => {}).finally(() => setToDone(true));
  };

  const refreshSelectedMarket = () => {
    if (marketFocus === "CN") loadAShareTools();
    else { loadInternational(watchCodes); loadMarketMood(marketFocus); }
  };

  // 数据块占位：请求没回来 = 加载中；回来了但为空 = 数据源暂不可用（别让用户干等）
  const pending = (done: boolean) => (
    <p className="py-4 text-center text-sm text-muted-foreground/60">
      {done ? "暂无数据：可能是非交易时段或数据源暂时不可用，可点右上角刷新重试" : "加载中…"}
    </p>
  );

  const refreshWatch = (codes: string[]) => {
    if (!codes.length) { setWatchQuotes({}); return; }
    setWatchLoading(true);
    api.quotes(codes.join(",")).then(setWatchQuotes).catch(() => {}).finally(() => setWatchLoading(false));
  };

  const refreshIntelligence = (codes: string[]) => {
    if (!codes.length) { setIntelligence(null); return; }
    api.intelligenceFeed(codes, ["filings", "news", "earnings"], 4).then(setIntelligence).catch(() => setIntelligence(null));
  };

  const refreshMarketOverview = (codes: string[]) => {
    api.internationalOverview(codes).then((data) => {
      setInternationalOverview(data);
      setBenchmarks(data.benchmarks);
    }).catch(() => {});
  };

  useEffect(() => {
    const codes = loadWatch();
    loadInternational(codes);
    loadMarketMood("US");
    refreshWatch(codes);
    refreshIntelligence(codes);
  }, []);

  const selectMarket = (next: MarketFocus) => {
    setMarketFocus(next);
    if (next === "CN") loadAShareTools();
    else loadMarketMood(next);
  };

  const addWatch = () => {
    // 支持一次粘贴多只（逗号 / 空格分隔）；全部无效或重复则清空输入、无副作用。
    const { next, added } = addCodes(watchCodes, watchInput);
    setWatchInput("");
    if (!added) return;
    setWatchCodes(next); saveWatch(next); refreshWatch(next); refreshIntelligence(next); refreshMarketOverview(next);
  };

  const removeWatch = (c: string) => {
    const next = watchCodes.filter((x) => x !== c);
    setWatchCodes(next); saveWatch(next); refreshWatch(next); refreshIntelligence(next); refreshMarketOverview(next);
  };

  const today = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });

  const aShareSummary = indices.length
    ? indices.map((i) => `${i.name} ${i.price}（${i.change_pct > 0 ? "+" : ""}${i.change_pct}%）`).join("；")
    : "（指数数据未取到）";
  const benchmarkSummary = benchmarks?.items.filter((item) => item.available).map((item) =>
    `${item.name} ${item.price == null ? "—" : fmt(item.price)}（${pctText(item.change_pct)}）`,
  ).join("；") || "（全球基准数据未取到）";
  const intelligenceSummary = intelligence?.items.slice(0, 20).map((item) =>
    `[${item.market} ${item.kind}] ${item.symbol} ${item.title}${item.meta?.surprise_pct != null ? ` surprise ${item.meta.surprise_pct}%` : ""}`,
  ).join("\n") || "（关注股票事件数据未取到）";
  const sectorGroups = internationalOverview?.sectors;
  const marketOverviewSummary = internationalOverview ? [
    `关注列表宽度（非全市场）：总数 ${internationalOverview.watchlist.breadth.total}，上涨 ${internationalOverview.watchlist.breadth.up}，下跌 ${internationalOverview.watchlist.breadth.down}，持平 ${internationalOverview.watchlist.breadth.flat}，未取到 ${internationalOverview.watchlist.breadth.unavailable}`,
    `关注列表主要波动：${internationalOverview.watchlist.movers.slice(0, 6).map((item) => `${item.symbol} ${item.change_pct == null ? "—" : `${item.change_pct > 0 ? "+" : ""}${item.change_pct.toFixed(2)}%`}`).join("；") || "无"}`,
    `美国行业 ETF 代理：${internationalOverview.sectors.US.map((item) => `${item.name} ${item.change_pct == null ? "—" : `${item.change_pct > 0 ? "+" : ""}${item.change_pct.toFixed(2)}%`}`).join("；")}`,
    `欧洲行业 ETF 代理：${internationalOverview.sectors.Europe.map((item) => `${item.name} ${item.change_pct == null ? "—" : `${item.change_pct > 0 ? "+" : ""}${item.change_pct.toFixed(2)}%`}`).join("；")}`,
  ].join("\n") : "（跨市场概览数据未取到）";
  const moodSummary = marketMood
    ? `${marketMood.universe.label}：情绪${marketMood.mood}，上涨 ${marketMood.breadth.up}，下跌 ${marketMood.breadth.down}，` +
      `站上50日均线 ${marketMood.participation["50"].pct ?? "—"}%，52周新高 ${marketMood.new_highs}，新低 ${marketMood.new_lows}。`
    : "（所选市场情绪数据未取到）";
  const selectedBenchmarks = benchmarks?.items.filter((item) => item.region === marketFocus);

  const runReview = async () => {
    setReviewErr(null);
    setNeedConfig(false);
    if (!hasLlm()) { setNeedConfig(true); return; }
    setReviewLoading(true);
    setReview("");
    const watchSummary = watchCodes.length
      ? watchCodes.map((symbol) => {
          const quote = watchQuotes[symbol];
          return quote ? `${quote.name}(${symbol}) ${quote.price ?? "—"} ${quote.currency ?? ""}（${quote.change_pct == null ? "—" : `${quote.change_pct > 0 ? "+" : ""}${quote.change_pct.toFixed(2)}%`}）` : `${symbol}（行情未取到）`;
        }).join("；")
      : "（未添加关注股票）";
    const prompt =
      `以下是今天美国与欧洲主要基准的客观数据：\n${benchmarkSummary}\n\n` +
      `以下是所选市场的日线情绪统计：\n${moodSummary}\n\n` +
      `以下是跨市场概览（关注列表宽度及行业 ETF 代理，不代表全市场宽度）：\n${marketOverviewSummary}\n\n` +
      `以下是用户关注的跨市场股票行情：\n${watchSummary}\n\n` +
      `以下是关注股票的近期文件、新闻与 earnings：\n${intelligenceSummary}\n\n` +
      `以下是 A 股数据（次要参考）：\n${aShareSummary}\n\n` +
      "请用中文做一段跨市场当天复盘：先总结美国与欧洲市场，再总结关注股票事件，最后简要补充 A 股。" +
      "只做客观陈述与多视角分析，不预测涨跌、不推荐任何标的、不构成投资建议。";
    try {
      await chatStream([{ role: "user", content: prompt }], `今日跨市场数据：${benchmarkSummary}`, {
        onDelta: (t) => setReview((r) => r + t),
      });
    } catch (e) {
      setReviewErr(e instanceof ApiError ? e.message : "复盘失败");
    } finally {
      setReviewLoading(false);
    }
  };

  const sentiment = overview?.sentiment;
  const sectors = overview?.sectors || [];
  const sentCells = sentiment ? [
    { k: "上涨家数", v: sentiment.up, up: true },
    { k: "下跌家数", v: sentiment.down, up: false },
    { k: "平盘", v: sentiment.flat, up: null },
    { k: "涨停", v: sentiment.zt, up: true },
    { k: "真实涨停", v: sentiment.zt_real, up: true },
    { k: "跌停", v: sentiment.dt, up: false },
    { k: "真实跌停", v: sentiment.dt_real, up: false },
    { k: "活跃度", v: sentiment.active, up: null },
  ] : [];

  return (
    <div>
      <PageHeader
        title="每日复盘"
        subtitle={`${today} · 美国 / 欧洲基准、自选股事件与 AI 复盘一屏看全`}
        actions={
          <AskAiButton
            context={`今日跨市场基准：${benchmarkSummary}\n所选市场情绪：${moodSummary}\n跨市场概览：\n${marketOverviewSummary}\n关注股票事件：\n${intelligenceSummary}`}
            label="问 AI"
            suggestions={["今天大盘怎么走", "哪些指数领涨领跌", "盘面有什么值得注意"]}
          />
        }
      />

      <div className="mb-4 flex items-center justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <p className="text-xs text-muted-foreground">当前市场</p>
          <p className="mt-0.5 text-sm font-semibold">{marketLabels[marketFocus]}市场复盘</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="选择复盘市场"
            value={marketFocus}
            onChange={(event) => selectMarket(event.target.value as MarketFocus)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/60"
          >
            <option value="US">美国</option>
            <option value="Europe">欧洲</option>
            <option value="CN">A股</option>
          </select>
          <button onClick={refreshSelectedMarket} className="text-muted-foreground hover:text-primary" title="刷新所选市场">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 1. Selected-market headline benchmarks */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">{marketFocus === "CN" ? "A股指数" : "主要基准"}</h3>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {marketFocus === "CN" ? (
          indices.length === 0
            ? [1, 2, 3, 4].map((i) => <GlassCard key={i} className="p-3"><p className="text-xs text-muted-foreground">{idxErr ? "行情未接通" : "加载中…"}</p><p className="mt-1 font-mono text-lg font-bold text-muted-foreground/40">—</p></GlassCard>)
            : indices.map((item) => <GlassCard key={item.name} className="p-3"><p className="truncate text-xs text-muted-foreground">{item.name}</p><p className={cn("mt-1 font-mono text-lg font-bold", pctColor(item.change_pct))}>{fmt(item.price)}</p><p className={cn("text-xs", pctColor(item.change_pct))}>{pctText(item.change_pct)}</p></GlassCard>)
        ) : !benchmarks ? (
          Array.from({ length: marketFocus === "US" ? 2 : 4 }, (_, index) => index).map((i) => (
              <GlassCard key={i} className="p-3">
                <p className="text-xs text-muted-foreground">加载中…</p>
                <p className="mt-1 font-mono text-lg font-bold text-muted-foreground/40">—</p>
              </GlassCard>
            ))
        ) : (
          selectedBenchmarks?.map((item) => (
              <GlassCard key={item.key} className="p-3">
                <p className="truncate text-xs text-muted-foreground">{item.name}</p>
                <p className={cn("mt-1 font-mono text-lg font-bold", pctColor(item.change_pct))}>{item.price == null ? "—" : fmt(item.price)}</p>
                <p className={cn("text-xs", pctColor(item.change_pct))}>{pctText(item.change_pct)}</p>
              </GlassCard>
            ))
        )}
      </div>

      {marketFocus !== "CN" && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><Gauge className="h-4 w-4" />市场情绪</h3>
            <span className="text-[11px] text-muted-foreground/50">日线宽度 · 趋势参与度 · 异常成交</span>
          </div>
          <div className="mb-6 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
            <GlassCard>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div><h4 className="text-sm font-semibold">{marketMood?.universe.label || `${marketLabels[marketFocus]}市场篮子`}</h4><p className="mt-1 text-[10px] text-muted-foreground/60">{marketMood?.as_of || "—"} · Yahoo 日线</p></div>
                <span className={cn("text-sm font-bold", marketMood?.mood === "偏强" ? "text-success" : marketMood?.mood === "偏弱" ? "text-danger" : "text-warning")}>{marketMood?.mood || "—"}</span>
              </div>
              {!marketMood ? (
                <p className="py-5 text-center text-sm text-muted-foreground/60">{moodDone ? "数据源暂时不可用，可刷新重试。" : "正在汇总50只股票的日线数据…"}</p>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: "上涨 / 下跌", value: `${marketMood.breadth.up} / ${marketMood.breadth.down}` },
                      { label: "52周新高 / 新低", value: `${marketMood.new_highs} / ${marketMood.new_lows}` },
                      { label: "异常成交", value: marketMood.unusual_volume },
                      { label: "有效样本", value: `${marketMood.breadth.available}/${marketMood.breadth.total}` },
                    ].map((cell) => <div key={cell.label} className="rounded-md bg-muted/25 p-2 text-center"><p className="text-[10px] text-muted-foreground">{cell.label}</p><p className="mt-1 font-mono text-base font-bold">{cell.value}</p></div>)}
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {(["20", "50", "200"] as const).map((window) => {
                      const item = marketMood.participation[window];
                      return <div key={window} className="flex items-baseline justify-between border-b border-border/30 pb-1.5 text-xs"><span className="text-muted-foreground">站上{window}日线</span><span className="font-mono font-semibold">{item.pct == null ? "—" : `${item.pct.toFixed(0)}%`}</span></div>;
                    })}
                  </div>
                  <div className="mt-4 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
                    {marketMood.movers.slice(0, 6).map((item) => <div key={item.symbol} className="flex items-center justify-between text-xs"><span className="font-mono text-muted-foreground">{item.symbol}</span><span className={cn("font-mono", pctColor(item.change_pct))}>{pctText(item.change_pct)}</span></div>)}
                  </div>
                </>
              )}
            </GlassCard>
            <GlassCard>
              <div className="mb-3 flex items-center justify-between"><h4 className="text-sm font-semibold">行业代理表现</h4><span className="text-[10px] text-muted-foreground/60">Yahoo ETF</span></div>
              {!sectorGroups ? <p className="py-5 text-center text-sm text-muted-foreground/60">行业代理数据加载中。</p> : (
                <div className="space-y-2">
                  {sectorGroups[marketFocus].map((sector) => <div key={sector.symbol} className="flex items-center gap-2 text-xs"><span className="w-28 truncate">{sector.name}</span><span className="flex-1 font-mono text-muted-foreground">{sector.symbol}</span><span className={cn("font-mono", pctColor(sector.change_pct))}>{pctText(sector.change_pct)}</span></div>)}
                </div>
              )}
              <p className="mt-4 border-t border-border/30 pt-3 text-[10px] leading-relaxed text-muted-foreground/60">代表篮子用于低成本观察市场宽度，不等同于全市场统计；数据为日线，可能延迟。</p>
            </GlassCard>
          </div>
        </>
      )}

      {/* 2. 关注股票（自选） */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">关注股票</h3>
        {watchCodes.length > 0 && (
          <button onClick={() => refreshWatch(watchCodes)} className="text-muted-foreground hover:text-primary" title="刷新价格">
            {watchLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      <GlassCard className="mb-6">
        <div className="mb-3 flex gap-2">
          <input
            value={watchInput}
            onChange={(e) => setWatchInput(e.target.value.replace(/[^a-zA-Z0-9.,，\s-]/g, "").toUpperCase().slice(0, 160))}
            onKeyDown={(e) => e.key === "Enter" && addWatch()}
            placeholder="加自选：600519 AAPL VOD.L"
            className="w-60 rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
          <button onClick={addWatch}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary shadow-glow hover:bg-primary/25">
            <Plus className="h-4 w-4" /> 增加
          </button>
        </div>
        {watchCodes.length === 0 ? (
          <p className="text-sm text-muted-foreground/60">加上你关注的股票，随时看它们的实时价格与涨跌。数据存本地，不上传。</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {watchCodes.map((c) => {
              const q = watchQuotes[c];
              return (
                <div key={c} className="group relative rounded-lg bg-muted/25 p-3">
                  <button onClick={() => removeWatch(c)} title="移除"
                    className="absolute right-1.5 top-1.5 text-muted-foreground/40 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100">
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <p className="truncate text-xs text-muted-foreground">{q?.name || c}</p>
                  <p className={cn("mt-1 font-mono text-lg font-bold", q ? pctColor(q.change_pct) : "text-muted-foreground/40")}>{q?.price ?? "—"} <span className="text-[10px] font-normal text-muted-foreground">{q?.currency}</span></p>
                  <p className={cn("text-xs", q ? pctColor(q.change_pct) : "text-muted-foreground/40")}>
                    {q?.change_pct != null ? `${q.change_pct > 0 ? "+" : ""}${q.change_pct.toFixed(2)}%` : c}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      <div className="mb-3 flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><Globe className="h-4 w-4" />关注股票事件</h3>
        <span className="text-[11px] text-muted-foreground/50">监管文件 · 新闻 · Earnings</span>
      </div>
      <GlassCard className="mb-6">
        {!watchCodes.length ? (
          <p className="py-4 text-center text-sm text-muted-foreground/60">添加关注股票后，这里会按市场汇总可用的文件、新闻与 earnings。</p>
        ) : !intelligence ? (
          <p className="py-4 text-center text-sm text-muted-foreground/60">事件数据加载中或当前数据源不可用。</p>
        ) : intelligence.items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground/60">近期没有可显示事件；缺口会在资讯雷达中注明。</p>
        ) : (
          <div className="space-y-2">
            {intelligence.items.slice(0, 12).map((item, index) => (
              <a key={`${item.symbol}-${item.kind}-${item.published_at}-${index}`} href={item.url || undefined} target={item.url ? "_blank" : undefined} rel="noreferrer"
                className={cn("group flex items-baseline gap-3 border-b border-border/30 pb-2 text-sm last:border-0", item.url && "cursor-pointer")}>
                <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground/70">{item.market} · {item.kind}</span>
                <span className="w-16 shrink-0 truncate text-xs text-primary/90">{item.symbol}</span>
                <span className="flex-1 truncate group-hover:text-primary">{item.title}</span>
                <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:block">{item.published_at}</span>
              </a>
            ))}
          </div>
        )}
      </GlassCard>

      {/* 3. AI 当日复盘 */}
      <GlassCard glow className="mb-6">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 font-semibold"><Sparkles className="h-4 w-4 text-primary" /> AI 当日复盘</h3>
          <button onClick={runReview} disabled={reviewLoading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary shadow-glow hover:bg-primary/25 disabled:opacity-50">
            {reviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {review ? "重新复盘" : "让 AI 复盘今天"}
          </button>
        </div>
        {needConfig && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
            还没接入 AI。<Link to="/settings" className="text-primary">先去接入你的 AI</Link>，之后一键出复盘。
          </div>
        )}
        {reviewErr && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" /> {reviewErr}
          </div>
        )}
        {review ? (
          <>
            <div className="prose prose-sm prose-invert mt-4 max-w-none text-foreground"><SafeMarkdown>{review}</SafeMarkdown></div>
            {!reviewLoading && <div className="mt-3"><SaveNoteButton kind="复盘" title={`每日复盘 ${today}`} content={review} /></div>}
          </>
        ) : !needConfig && !reviewErr && !reviewLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">点上方按钮，系统把当天客观数据打包给你的 AI，由它生成复盘。<b className="text-foreground">分析是它给的，我们只负责喂数据。</b></p>
        ) : null}
      </GlassCard>

      {marketFocus === "CN" && <>
      {/* A-share market tools */}
      <div className="mb-3 flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><Gauge className="h-4 w-4" /> 市场情绪</h3>
        {sentiment?.date && <span className="text-[11px] text-muted-foreground/50">{sentiment.date}</span>}
      </div>
      <GlassCard className="mb-6">
        {!sentiment?.breadth ? (
          pending(ovDone)
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { k: "大盘宽度", v: sentiment.breadth, hint: "冰点 / 偏弱 / 中性 / 偏强 / 普涨" },
                { k: "题材投机", v: sentiment.speculation, hint: "冰点 / 普通 / 活跃 / 亢奋" },
              ].map((m) => (
                <div key={m.k} className="rounded-lg bg-muted/25 p-4">
                  <p className="text-xs text-muted-foreground">{m.k}</p>
                  <p className="mt-1 text-2xl font-bold text-primary">{m.v}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground/60">{m.hint}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {sentCells.map((c) => (
                <div key={c.k} className="rounded-lg bg-muted/20 p-2 text-center">
                  <p className="truncate text-[11px] text-muted-foreground">{c.k}</p>
                  <p className={cn("mt-0.5 font-mono text-sm font-bold", c.up === null ? "text-foreground" : c.up ? "text-success" : "text-danger")}>{c.v}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </GlassCard>

      {/* 4b. 短线情绪（连板梯队 / 打板情绪，聚合口径零个股名） */}
      <div className="mb-3 flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><Flame className="h-4 w-4" /> 短线情绪</h3>
        <span className="text-[11px] text-muted-foreground/50">连板股 · 打板情绪 · 客观公开榜单</span>
        {emotion?.date && <span className="ml-auto text-[11px] text-muted-foreground/50">{emotion.date}</span>}
      </div>
      <GlassCard className="mb-6">
        {!emotion || emotion.zt_count === undefined ? (
          pending(emoDone)
        ) : (
          <>
            {/* 关键计数 */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { k: "涨停", v: `${emotion.zt_count}`, cls: "text-success" },
                { k: "跌停", v: `${emotion.dt_count}`, cls: "text-danger" },
                { k: "最高连板", v: `${emotion.max_boards} 板`, cls: "text-primary" },
                { k: "连板（2板+）", v: `${emotion.lianban_count} 家`, cls: "text-primary" },
              ].map((c) => (
                <div key={c.k} className="rounded-lg bg-muted/25 p-3 text-center">
                  <p className="text-[11px] text-muted-foreground">{c.k}</p>
                  <p className={cn("mt-0.5 font-mono text-xl font-bold", c.cls)}>{c.v}</p>
                </div>
              ))}
            </div>
            {/* 打板情绪比率 */}
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[
                    { k: "封板率", v: emotion.seal_rate, hint: "封住 / 尝试涨停", strong: true },
                    { k: "炸板率", v: emotion.break_rate, hint: "炸板 / 尝试涨停", strong: false },
                { k: "晋级率", v: emotion.promotion_rate, hint: "昨涨停今又停", strong: true },
              ].map((c) => (
                <div key={c.k} className="rounded-lg bg-muted/20 p-2.5 text-center">
                  <p className="text-[11px] text-muted-foreground">{c.k}</p>
                  <p className={cn("mt-0.5 font-mono text-sm font-bold", c.strong ? "text-success" : "text-danger")}>
                    {c.v == null ? "—" : `${(c.v * 100).toFixed(1)}%`}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground/50">{c.hint}</p>
                </div>
              ))}
            </div>
            {/* 连板股清单（2 板以上，客观公开榜单） */}
            <div className="mt-3">
              <p className="mb-1.5 text-[11px] text-muted-foreground">连板股（2 板以上连续涨停）· 客观公开榜单，非推荐 / 非预测</p>
              {emotion.lianban_stocks.length === 0 ? (
                <p className="text-xs text-muted-foreground/50">今日无 2 板以上个股</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                        {["名称", "连板", "现价", "涨停%", "成交额", "流通市值", "概念"].map((h) => (
                          <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {emotion.lianban_stocks.map((s) => (
                        <tr key={s.code} className="border-b border-border/30">
                          <td className="px-2 py-2"><span className="font-medium">{s.name}</span> <span className="text-xs text-muted-foreground/50">{s.code}</span></td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono font-bold text-primary">{s.boards} 板</td>
                          <td className="px-2 py-2 font-mono">{s.price}</td>
                          <td className="px-2 py-2 font-mono text-success">+{s.pct}%</td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono text-muted-foreground">{yi(s.amount)}</td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono text-muted-foreground">{yi(s.float_cap)}</td>
                          <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">{s.industry}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </GlassCard>

      {/* 4c. 全市场成交额 TOP20（客观公开榜单） */}
      <div className="mb-3 flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><BarChart3 className="h-4 w-4" /> 全市场成交额 TOP20</h3>
        <span className="text-[11px] text-muted-foreground/50">客观公开榜单，非推荐 / 非预测 / 不构成投资建议</span>
        {turnover?.updated && <span className="ml-auto text-[11px] text-muted-foreground/50">{turnover.updated}</span>}
      </div>
      <GlassCard className="mb-6">
        {!turnover || turnover.stocks.length === 0 ? (
          pending(toDone)
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                  {["#", "名称", "现价", "涨跌%", "成交额", "总市值", "行业"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {turnover.stocks.map((s, i) => (
                  <tr key={s.code} className="border-b border-border/30">
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground/50">{i + 1}</td>
                    <td className="px-2 py-2"><span className="font-medium">{s.name}</span> <span className="text-xs text-muted-foreground/50">{s.code}</span></td>
                    <td className="px-2 py-2 font-mono">{s.price ?? "—"}</td>
                    <td className={cn("px-2 py-2 font-mono", s.pct == null ? "text-muted-foreground" : pctColor(s.pct))}>
                      {s.pct == null ? "—" : `${s.pct > 0 ? "+" : ""}${s.pct}%`}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono">{yi(s.amount)}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-muted-foreground">{yi(s.mcap)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">{s.industry}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* 5. 板块资金趋势榜（行业） */}
      <div className="mb-3 flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><TrendingUp className="h-4 w-4" /> 板块资金趋势榜</h3>
        <span className="text-[11px] text-muted-foreground/50">行业 · 按今日净流入排序</span>
      </div>
      <GlassCard className="mb-6">
        {sectors.length === 0 ? (
          pending(ovDone)
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                  {["行业", "涨跌%", "今日净流入", "流入", "流出", "家数"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sectors.slice(0, 15).map((s) => (
                  <tr key={s.name} className="border-b border-border/30">
                    <td className="px-2 py-2 font-medium">{s.name}</td>
                    <td className={cn("px-2 py-2 font-mono", pctColor(s.pct))}>{s.pct > 0 ? "+" : ""}{s.pct}%</td>
                    <td className={cn("px-2 py-2 font-mono", pctColor(s.net))}>{s.net > 0 ? "+" : ""}{fmt(s.net)} 亿</td>
                    <td className="px-2 py-2 font-mono text-muted-foreground">{fmt(s.inflow)}</td>
                    <td className="px-2 py-2 font-mono text-muted-foreground">{fmt(s.outflow)}</td>
                    <td className="px-2 py-2 font-mono text-muted-foreground">{s.firms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* 6. 资金轮动 */}
      <div className="mb-3 flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><ArrowDownUp className="h-4 w-4" /> 资金轮动</h3>
        <span className="text-[11px] text-muted-foreground/50">板块级净流入 / 流出</span>
      </div>
      <div className="mb-2 grid gap-4 md:grid-cols-2">
        {[
          { title: "流入 Top", icon: TrendingUp, color: "text-success", rows: sectors.slice(0, 6) },
          { title: "流出 Top", icon: TrendingDown, color: "text-danger", rows: [...sectors].slice(-6).reverse() },
        ].map((col) => (
          <GlassCard key={col.title}>
            <h4 className={cn("mb-3 flex items-center gap-1.5 text-sm font-semibold", col.color)}><col.icon className="h-4 w-4" /> {col.title}</h4>
            {col.rows.length === 0 ? (
              pending(ovDone)
            ) : (
              <div className="space-y-1.5">
                {col.rows.map((s, i) => (
                  <div key={s.name} className="flex items-center gap-3 border-b border-border/30 pb-1.5 text-sm last:border-0">
                    <span className="w-5 text-xs text-muted-foreground/50">{i + 1}</span>
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className={cn("font-mono text-xs", pctColor(s.pct))}>{s.pct > 0 ? "+" : ""}{s.pct}%</span>
                    <span className={cn("w-20 text-right font-mono text-xs", pctColor(s.net))}>{s.net > 0 ? "+" : ""}{fmt(s.net)} 亿</span>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        ))}
      </div>
      </>}

      <Disclaimer />
    </div>
  );
}
