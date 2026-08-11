import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, FileText, Newspaper, Rss, RefreshCw, Loader2, ExternalLink, AlertCircle, Sparkles, Lightbulb, Star } from "lucide-react";
import { SafeMarkdown } from "@/components/ui/SafeMarkdown";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { SaveNoteButton } from "@/components/ui/SaveNoteButton";
import { api, ApiError, type RadarData, type Industry, type IntelligenceItem, type IntelligenceKind } from "@/lib/api";
import { loadWatch } from "@/lib/watchlist";
import { hasLlm, chatStream } from "@/lib/llm";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n";

const TABS = [
  { key: "events", label: "Event probabilities (planned)", labelZh: "事件概率（规划中）", icon: TrendingUp, integrated: false, desc: "Public probability data for macro and market events is planned; no market is connected yet.", descZh: "计划汇总宏观与市场事件的公开概率数据；目前尚未接入任何市场。" },
  { key: "filings", label: "Regulatory filings", labelZh: "监管文件", icon: FileText, integrated: true, desc: "Available US SEC filings and A-share announcements, with European filing gaps disclosed.", descZh: "汇总关注列表中可用的美国 SEC、A股公告与欧洲文件缺口" },
  { key: "news", label: "Company news", labelZh: "公司新闻", icon: Newspaper, integrated: true, desc: "Available company news for the watchlist.", descZh: "汇总关注列表中可用的公司新闻" },
  { key: "earnings", label: "Earnings", labelZh: "Earnings", icon: TrendingUp, integrated: true, desc: "Available earnings actuals, estimates, and surprises for the watchlist.", descZh: "汇总关注列表中可用的 earnings 实际值、预期值与 surprise" },
  { key: "investment-news", label: "Investment News", labelZh: "Investment News", icon: Rss, integrated: true, desc: "Public global RSS news across 12 themes, integrated from investment-news.", descZh: "12 赛道全球公开 RSS 资讯（集成自 investment-news 仓库）" },
];

interface Digest { loading?: boolean; text?: string; err?: string; needKey?: boolean }

function InvestmentNewsPanel() {
  const { tr } = useLocale();
  const [data, setData] = useState<RadarData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState("ai");
  const [refreshing, setRefreshing] = useState(false);
  const [digests, setDigests] = useState<Record<string, Digest>>({});
  const [bulk, setBulk] = useState<{ running: boolean; done: number; total: number }>({ running: false, done: 0, total: 0 });

  useEffect(() => {
    api.radar().then(setData).catch((e) => setErr(e instanceof ApiError ? e.message : tr("Unable to load", "加载失败")));
  }, []);

  const refresh = async () => {
    setRefreshing(true); setErr(null);
    try { setData(await api.radarRefresh()); }
    catch (e) { setErr(e instanceof ApiError ? e.message : tr("Refresh failed", "刷新失败")); }
    finally { setRefreshing(false); }
  };

  const industries: Industry[] = data?.industries || [];
  const cur = industries.find((i) => i.key === active) || industries[0];
  const hasData = !!data?.generated_at;

  const genDigest = async (ind: Industry) => {
    if (!hasLlm()) { setDigests((d) => ({ ...d, [ind.key]: { needKey: true } })); return; }
    setDigests((d) => ({ ...d, [ind.key]: { loading: true } }));
    const ctx = ind.items.slice(0, 25).map((it) => `[${it.time}] ${it.source}｜${it.zh || it.title}`).join("\n");
    const prompt =
      `Below is recent news for the “${ind.name}” theme. Extract 3–5 key points for today, one concise sentence each. ` +
      `State only important objective events or trends. Do not recommend securities, predict prices, or provide advice. Use a simple bulleted list with no preamble or conclusion.\n\n${ctx}`;
    try {
      let acc = "";
      await chatStream("intelligence", [{ role: "user", content: prompt }], `${ind.name} theme news`, {
        onDelta: (t) => { acc += t; setDigests((d) => ({ ...d, [ind.key]: { text: acc } })); },
      });
    } catch (e) {
      setDigests((d) => ({ ...d, [ind.key]: { err: e instanceof ApiError ? e.message : tr("Generation failed", "生成失败") } }));
    }
  };

  // 一键提炼全部赛道要点（串行，带进度；单赛道按需的按钮仍保留）
  const genAll = async () => {
    if (!hasLlm()) { if (cur) setDigests((d) => ({ ...d, [cur.key]: { needKey: true } })); return; }
    const targets = industries.filter((i) => i.items.length > 0);
    setBulk({ running: true, done: 0, total: targets.length });
    for (const ind of targets) {
      await genDigest(ind);
      setBulk((b) => ({ ...b, done: b.done + 1 }));
    }
    setBulk((b) => ({ ...b, running: false }));
  };

  const dg = cur ? digests[cur.key] : undefined;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {hasData ? tr(`${data!.stats.total_sources} public sources · past ${data!.recent_days} days · updated ${data!.generated_at}`, `${data!.stats.total_sources} 个公开源 · 近 ${data!.recent_days} 天 · 更新于 ${data!.generated_at}`) : tr("12 themes · 108 public sources", "12 赛道 · 108 个公开源")}
        </span>
        <div className="flex items-center gap-2">
          {hasData && (
            <button onClick={genAll} disabled={bulk.running || refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-sm font-medium text-primary shadow-glow hover:bg-primary/25 disabled:opacity-50">
              {bulk.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {bulk.running ? tr(`Distilling ${bulk.done}/${bulk.total}`, `提炼中 ${bulk.done}/${bulk.total}`) : tr("Distill all key points", "一键提炼全部要点")}
            </button>
          )}
          <button onClick={refresh} disabled={refreshing || bulk.running}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {refreshing ? tr("Fetching…", "抓取中…") : tr("Refresh", "刷新")}
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      {!hasData && !err ? (
        <div className="rounded-lg border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground/70">
          {tr("No news has been fetched. Select ", "还没有抓取资讯，点上方")}<b className="text-foreground">{tr("Refresh", "「刷新」")}</b>{tr(" above to fetch it (about 20–40 seconds).", "拉取（约 20-40 秒）。")}
        </div>
      ) : (
        <>
          {/* 赛道筛选 —— 暖橙边框 pill */}
          <div className="mb-4 flex flex-wrap gap-2">
            {industries.map((ind) => (
              <button key={ind.key} onClick={() => setActive(ind.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                  active === ind.key
                    ? "border-primary bg-primary/15 font-medium text-primary shadow-glow"
                    : "border-primary/25 text-muted-foreground hover:border-primary/60 hover:text-foreground",
                )}>
                <span className="h-2 w-2 rounded-full" style={{ background: ind.accent }} />
                {ind.name}<span className="text-muted-foreground/50">{ind.items.length}</span>
              </button>
            ))}
          </div>

          {cur && (
            <>
              {/* 今日要点总结框（暖橙框） */}
              <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                    <Lightbulb className="h-4 w-4" /> {tr("Today's key points", "今日要点")} · {cur.name}
                  </span>
                  {(dg?.text || dg?.err || dg?.needKey) && (
                    <button onClick={() => genDigest(cur)} className="text-xs text-muted-foreground hover:text-primary">{tr("Distill again", "重新提炼")}</button>
                  )}
                </div>
                {dg?.loading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {tr("AI is reading this theme's news…", "AI 正在读这个赛道的资讯…")}</p>
                ) : dg?.text ? (
                  <>
                    <div className="prose prose-sm prose-invert max-w-none text-foreground"><SafeMarkdown>{dg.text}</SafeMarkdown></div>
                    <div className="mt-2"><SaveNoteButton kind={tr("Today's key points", "今日要点")} title={tr(`${cur.name} today's key points`, `${cur.name} 今日要点`)} content={dg.text} /></div>
                  </>
                ) : dg?.needKey ? (
                  <p className="text-sm text-muted-foreground">{tr("AI is not configured. ", "还没接入 AI。")}<Link to="/settings" className="text-primary">{tr("Set up your AI", "先接入你的 AI")}</Link>{tr(" to distill today's key points for this theme.", "，即可一键提炼本赛道今日要点。")}</p>
                ) : dg?.err ? (
                  <p className="text-sm text-destructive">{dg.err}</p>
                ) : (
                  <button onClick={() => genDigest(cur)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/25">
                    <Sparkles className="h-4 w-4" /> {tr("Ask AI to distill today's key points", "让 AI 提炼今日要点")}
                  </button>
                )}
              </div>

              {/* 资讯列表 */}
              <div className="space-y-2">
                {cur.items.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground/60">{tr(`No updates for this theme in the past ${data!.recent_days} days`, `近 ${data!.recent_days} 天该赛道暂无更新`)}</p>
                ) : (
                  cur.items.map((it, i) => (
                    <a key={i} href={it.url} target="_blank" rel="noreferrer"
                      className="group flex items-baseline gap-3 border-b border-border/30 pb-2 text-sm last:border-0">
                      <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground/70">{it.time}</span>
                      <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">{it.source}</span>
                      <span className="flex-1 group-hover:text-primary">{it.zh || it.title}</span>
                      <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/0 group-hover:text-primary/60" />
                    </a>
                  ))
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// 关注股公告 / 新闻聚合：从本地关注列表取代码，复用个股接口批量拉取、按时间倒序合并。
// 只做公开信息聚合，标的均为用户自己关注列表里的，不预置、不推荐。
interface FeedRow extends IntelligenceItem { }
const MAX_ROWS = 60;

function WatchlistFeed({ kind }: { kind: IntelligenceKind }) {
  const { locale, tr } = useLocale();
  const [codes, setCodes] = useState<string[]>(loadWatch);
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [gaps, setGaps] = useState<{ symbol: string; kind: IntelligenceKind; reason: string; message: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (cs: string[]) => {
    if (!cs.length) { setRows([]); setGaps([]); return; }
    setLoading(true); setErr(null);
    try {
      const feed = await api.intelligenceFeed(cs, [kind], 10);
      setRows(feed.items.slice(0, MAX_ROWS));
      setGaps(feed.gaps);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tr("Unable to load", "加载失败"));
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => { const cs = loadWatch(); setCodes(cs); load(cs); }, [load]);

  const refresh = () => { const cs = loadWatch(); setCodes(cs); load(cs); };

  if (!codes.length) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground/70">
        {tr("No watchlist stocks. Add them in ", "还没有关注股票。到")}<Link to="/daily-review" className="text-primary">{tr("Daily Review", "「每日复盘」")}</Link>{tr("; this page will aggregate available ", "加自选，这里会汇总已接入来源的")}{kind === "filings" ? tr("regulatory filings", "监管文件") : kind === "news" ? tr("company news", "公司新闻") : "earnings"}{tr(".", "。")}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Star className="h-3.5 w-3.5 text-primary/70" /> {tr(`${codes.length} watched · ${rows.length} recent `, `关注 ${codes.length} 只 · 共 ${rows.length} 条`)}{kind === "filings" ? tr("filings", "监管文件") : kind === "news" ? tr("news items", "新闻") : "earnings"}{tr("", "（近期）")}
        </span>
        <button onClick={refresh} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {loading ? tr("Fetching…", "拉取中…") : tr("Refresh", "刷新")}
        </button>
      </div>

      {err && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {tr("Aggregating watchlist ", "正在汇总关注股的")}{kind === "filings" ? tr("filings", "监管文件") : kind === "news" ? tr("news", "新闻") : "earnings"}…</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground/60">
          {tr("No recent ", "关注列表里的个股近期暂无可显示的")}{kind === "filings" ? tr("regulatory filings", "监管文件") : kind === "news" ? tr("company news", "公司新闻") : "earnings"}{tr(" are available for the watchlist.", "。")}
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <a key={i} href={r.url || undefined} target={r.url ? "_blank" : undefined} rel="noreferrer"
              className={cn("group flex items-baseline gap-3 border-b border-border/30 pb-2 text-sm last:border-0", r.url && "cursor-pointer")}>
              <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground/70">{r.market} · {r.symbol}</span>
              <span className="hidden w-24 shrink-0 truncate text-xs text-muted-foreground sm:block">{r.source || "—"}</span>
              <span className="flex-1 group-hover:text-primary">{r.title}</span>
              {kind === "earnings" && r.meta?.surprise_pct != null && <span className="shrink-0 font-mono text-xs">{r.meta.surprise_pct}%</span>}
              {r.url && <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/0 group-hover:text-primary/60" />}
            </a>
          ))}
        </div>
      )}
      {gaps.length > 0 && <p className="mt-3 text-xs text-warning">{tr("Data gaps: ", "数据缺口：")}{gaps.slice(0, 4).map((gap) => `${gap.symbol} ${gap.message}`).join(locale === "en" ? "; " : "；")}</p>}
    </div>
  );
}

export function Intel() {
  const { locale, tr } = useLocale();
  const [tab, setTab] = useState("investment-news");
  const cur = TABS.find((t) => t.key === tab)!;

  return (
    <div>
      <PageHeader title={tr("Intelligence radar", "资讯雷达")} subtitle={tr("Multi-source intelligence center: use AI to collect and distill information across sources", "多来源资讯中心：AI 帮你跨源捞资讯、提炼要点")} />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map(({ key, label, labelZh, icon: Icon, integrated }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
              tab === key ? "bg-primary/15 font-medium text-primary shadow-glow" : "text-muted-foreground hover:bg-muted/50")}>
            <Icon className="h-4 w-4" /> {locale === "en" ? label : labelZh}
            {integrated && <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[9px] font-medium text-primary">{tr("Integrated", "集成")}</span>}
          </button>
        ))}
      </div>

      <GlassCard glow>
        <div className="mb-3 flex items-center gap-2">
          <cur.icon className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">{locale === "en" ? cur.label : cur.labelZh}</h3>
          {cur.integrated && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">investment-news</span>}
        </div>
        {cur.key === "investment-news" ? (
          <InvestmentNewsPanel />
        ) : cur.key === "filings" ? (
          <WatchlistFeed kind="filings" />
        ) : cur.key === "news" ? (
          <WatchlistFeed kind="news" />
        ) : cur.key === "earnings" ? (
          <WatchlistFeed kind="earnings" />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{locale === "en" ? cur.desc : cur.descZh}</p>
            <div className="mt-4 rounded-lg border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground/70">
              {tr("Event-probability data is not available yet for A-shares, US stocks, or European markets. Prediction-market probabilities and macro event calendars can be integrated later; for now, use Investment News, Regulatory Filings, Company News, and Earnings.", "当前 A股、美股和欧洲市场都没有事件概率数据。后续可接入预测市场概率与宏观事件日历；现阶段请使用「Investment News」「监管文件」「公司新闻」和「Earnings」。")}
            </div>
          </>
        )}
      </GlassCard>

      <p className="mt-3 text-[11px] text-muted-foreground/60">
        {tr("Public-information aggregation only: no recommendations or price predictions. Filings and news come from public disclosures and sources for your watchlist; theme news is filtered through the compliance vocabulary. Key points are distilled by your configured AI.", "只做公开信息聚合、不做推荐、不预测涨跌。公告 / 新闻均来自你关注列表里个股的公开披露与公开源；赛道资讯已按合规词表过滤。今日要点由你自己配置的 AI 提炼。")}
      </p>
      <Disclaimer />
    </div>
  );
}
