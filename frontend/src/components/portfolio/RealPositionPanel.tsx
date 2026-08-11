import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as echarts from "echarts";
import { AlertCircle, BarChart3, Loader2, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { ApiError, api, type IbkrAnalytics, type IbkrInstrument, type IbkrPositionChart, type IbkrRefreshStatus, type RealPositionSnapshot } from "@/lib/api";
import { investmentProfileContext, portfolioAiInstruction, portfolioAiNumber, portfolioNumber, portfolioRatioPercent, portfolioSigned } from "@/lib/portfolio-format";
import { useLocale, type Locale } from "@/lib/i18n";

const fmt = portfolioNumber;
const signed = portfolioSigned;
const pnlClass = (value: number | null | undefined) => value == null ? "text-muted-foreground" : value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-muted-foreground";
const percent = portfolioRatioPercent;
const sourceLabel = (status: string, locale: Locale) => status === "broker" ? "IBKR" : status === "trade_reconstructed" ? (locale === "en" ? "Reconstructed from trades" : "交易重建") : (locale === "en" ? "Unavailable" : "不可用");
const chartValue = (value: unknown): string => Array.isArray(value)
  ? value.map((item) => typeof item === "number" ? portfolioNumber(item) : String(item)).join(", ")
  : typeof value === "number" ? portfolioNumber(value) : String(value ?? "—");

export function RealPositionPanel({ preferences }: { preferences: string[] }) {
  const { locale, tr } = useLocale();
  const [data, setData] = useState<RealPositionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [analytics, setAnalytics] = useState<IbkrAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [range, setRange] = useState("3m");
  const [instruments, setInstruments] = useState<IbkrInstrument[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [chart, setChart] = useState<IbkrPositionChart | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [job, setJob] = useState<IbkrRefreshStatus | null>(null);
  const [mapping, setMapping] = useState("");
  const [multiplier, setMultiplier] = useState("1");

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.realPositions()); setError(null); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : tr("Real positions are unavailable", "真实持仓不可用")); }
    finally { setLoading(false); }
  }, [tr]);

  const loadAnalytics = useCallback(async (selectedRange = range) => {
    try {
      const [summary, list] = await Promise.all([api.positionAnalytics(selectedRange), api.positionInstruments()]);
      setAnalytics(summary); setInstruments(list);
      setAnalyticsError(null);
      setSelectedKey((current) => current ?? list[0]?.instrument_key ?? null);
    } catch (reason) {
      setAnalyticsError(reason instanceof ApiError ? reason.message : tr("Unable to load IBKR portfolio analytics", "IBKR 组合分析加载失败"));
    }
  }, [range, tr]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

  useEffect(() => {
    if (!selectedKey) { setChart(null); setChartError(null); return; }
    let cancelled = false;
    api.positionChart(selectedKey, range).then((payload) => {
      if (cancelled) return;
      setChart(payload); setChartError(null);
      setMapping(payload.provider_symbol || "");
      setMultiplier(String(payload.price_multiplier || 1));
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setChart(null);
      setChartError(reason instanceof ApiError ? reason.message : tr("Unable to load position chart", "持仓图表加载失败"));
    });
    return () => { cancelled = true; };
  }, [selectedKey, range, tr]);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await api.positionRefreshStatus(job.job_id || undefined);
        setJob(next);
        if (["complete", "partial"].includes(next.status)) { await load(); await loadAnalytics(); }
      } catch (reason) {
        setError(reason instanceof ApiError ? reason.message : tr("Unable to load IBKR refresh status", "IBKR 刷新状态加载失败"));
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [job, load, loadAnalytics, tr]);

  const refresh = async () => {
    setLoading(true); setError(null);
    try {
      setData(await api.refreshRealPositions());
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && window.confirm(tr("IBKR returned no positions. Replace the current snapshot with an empty one?", "IBKR 返回空持仓。确认用空快照替换当前真实持仓吗？"))) {
        try { setData(await api.refreshRealPositions(true)); }
        catch (retryReason) { setError(retryReason instanceof ApiError ? retryReason.message : tr("IBKR refresh failed", "IBKR 刷新失败")); }
      } else setError(reason instanceof ApiError ? reason.message : tr("IBKR refresh failed", "IBKR 刷新失败"));
    } finally { setLoading(false); }
  };

  const positions = data?.positions || [];
  const allocations = useMemo(() => {
    const valued = positions.filter((item) => item.reporting_market_value != null);
    const grossExposure = valued.reduce(
      (sum, item) => sum + Math.abs(item.reporting_market_value || 0),
      0,
    );
    const ranked = [...valued].sort((left, right) => Math.abs(right.reporting_market_value || 0) - Math.abs(left.reporting_market_value || 0));
    const visible = ranked.length > 8 ? ranked.slice(0, 7) : ranked;
    const result = visible.map((item) => ({
      key: [item.account_ref, item.symbol, item.currency, item.venue || ""].join("|"),
      label: item.symbol,
      exposureSide: (item.reporting_market_value || 0) < 0 ? "Short" : "Long",
      weight: grossExposure ? Math.abs(item.reporting_market_value || 0) / grossExposure : null,
    }));
    if (ranked.length > 8) {
      const otherExposure = ranked.slice(7).reduce((sum, item) => sum + Math.abs(item.reporting_market_value || 0), 0);
      result.push({ key: "other", label: "__OTHER__", exposureSide: "", weight: grossExposure ? otherExposure / grossExposure : null });
    }
    return result;
  }, [positions]);
  const instrumentByPosition = useMemo(() => new Map(instruments.map((item) => [
    [item.account_ref, item.symbol, item.currency, item.venue || ""].join("|"),
    item,
  ])), [instruments]);
  const aiContext = `${investmentProfileContext(preferences)}\n\nMarket-data validation: securities with the same name on different exchanges may be different products. Use the market-data symbol below for live-price queries and verify both venue and currency; never substitute the bare IBKR symbol.\n\n${data?.status === "available"
    ? `My real IBKR positions (sent only after the user clicks):\n${positions.map((item) => {
      const instrument = instrumentByPosition.get([item.account_ref, item.symbol, item.currency, item.venue || ""].join("|"));
      return `${item.name}: IBKR symbol ${item.symbol}; market-data symbol ${instrument?.provider_symbol || "unmapped"}; venue ${item.venue || "not provided"}; currency ${item.currency}; quantity ${portfolioAiNumber(item.quantity)}; cost ${portfolioAiNumber(item.average_cost)} (${sourceLabel(item.cost_status, "en")}); IBKR mark ${portfolioAiNumber(item.latest_price)}; unrealized P&L ${portfolioAiNumber(item.unrealized_pnl)} (${sourceLabel(item.pnl_status, "en")})`;
    }).join("\n")}`
    : "Real IBKR positions have not been loaded."}\n\n${portfolioAiInstruction}`;

  const refreshAll = async () => {
    setLoading(true); setError(null);
    try { setJob(await api.refreshAllPositions()); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : tr("IBKR refresh failed", "IBKR 刷新失败")); }
    finally { setLoading(false); }
  };

  const saveMapping = async () => {
    if (!selectedKey || !mapping.trim()) return;
    try {
      await api.savePositionMapping(selectedKey, mapping, Number(multiplier) || 1);
      const payload = await api.positionChart(selectedKey, range);
      setChart(payload); setChartError(null);
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : tr("Unable to save market-data mapping", "保存行情映射失败")); }
  };
  const activeJob = Boolean(job && ["queued", "running"].includes(job.status));

  return <GlassCard className="mb-5" glow>
    <div className="mb-4 flex flex-wrap items-start gap-3">
      <div><h2 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="h-5 w-5 text-primary" />{tr("Real positions (IBKR Flex)", "真实持仓（IBKR Flex）")}</h2><p className="mt-1 text-xs text-muted-foreground">{tr("Local Vibe Research snapshot. Refreshing is a read-only IBKR query and never submits orders.", "Vibe Research 本地快照；刷新是只读 IBKR 查询，不提交订单。")}</p></div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
        {data?.status === "available" && <AskAiButton workflow="portfolio" context={aiContext} label={tr("Ask AI about real positions", "让 AI 看真实持仓")} suggestions={locale === "en" ? ["Where is my portfolio concentrated?", "What structural risks do I have?", "Help me review the portfolio"] : ["我的持仓集中在哪些方向", "结构上有什么风险", "帮我梳理一下"]} />}
        <button onClick={refreshAll} disabled={loading || activeJob} title={tr("Update current positions, historical P&L, and execution points", "更新当前持仓、历史 P&L 与交易点位")} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-50">{activeJob ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{activeJob ? tr("Syncing", "同步中") : tr("Sync IBKR", "同步 IBKR")}</button>
        <button onClick={refresh} disabled={loading || activeJob} title={tr("Update only the current-position snapshot without historical P&L", "仅更新当前持仓快照，不查询历史 P&L")} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">{loading && !activeJob ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{tr("Positions only", "仅更新持仓")}</button>
      </div>
    </div>
    {error && <p className="mb-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning"><AlertCircle className="h-4 w-4" />{error}</p>}
    {data?.status === "not_configured" && <p className="text-sm text-muted-foreground">{tr("IBKR Flex is not configured. Set the Flex token and query ID in Vibe to enable refresh.", "尚未配置 IBKR Flex。设置 Vibe 的 Flex token 和 query ID 后即可刷新。")}</p>}
    {data?.status === "empty" && <p className="text-sm text-muted-foreground">{tr("The IBKR snapshot is empty. Refresh to fetch the current account state.", "IBKR 快照为空；点击刷新获取当前账户状态。")}</p>}
    {data?.status === "available" && <>
      <div className="grid gap-3 sm:grid-cols-4">
        {[['NAV', fmt(data.summary.nav), data.summary.reporting_currency || ""], [tr('Coverage', '覆盖率'), percent(data.summary.reporting_coverage), ""], [tr('Positions', '持仓数'), String(positions.length), ""], [tr('Report date', '报告日期'), data.report_date || "—", ""]].map(([label, value, suffix]) => <div key={String(label)} className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{label}{suffix ? ` · ${suffix}` : ""}</p><p className="mt-1 font-mono text-lg font-bold">{value}</p></div>)}
      </div>
      {allocations.length > 0 && <div className="mt-4">
        <h3 className="mb-2 text-sm font-semibold">{tr("Gross exposure allocation", "总敞口配置")}</h3>
        <div className="flex h-3 overflow-hidden rounded-full bg-muted/40">
          {allocations.map((item, index) => <div
            key={item.key}
            title={`${item.exposureSide} ${item.label === "__OTHER__" ? tr("Other", "其他") : item.label} ${percent(item.weight)}`}
            style={{ width: `${(item.weight || 0) * 100}%`, backgroundColor: ["#60a5fa", "#34d399", "#f59e0b", "#f472b6", "#a78bfa", "#fb7185"][index % 6] }}
          />)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {allocations.map((item) => <span key={item.key}>{item.exposureSide ? `${item.exposureSide} · ` : ""}{item.label === "__OTHER__" ? tr("Other", "其他") : item.label} {percent(item.weight)}</span>)}
        </div>
      </div>}
      <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border/50 text-left text-xs text-muted-foreground">{[tr("Account", "账户"), tr("Name", "名称"), tr("Quantity", "数量"), tr("Cost / source", "成本 / 来源"), tr("IBKR mark", "IBKR标记"), tr("Converted value", "折算市值"), tr("Unrealized P&L / source", "未实现盈亏 / 来源"), tr("Local currency / venue", "本币 / 交易所")].map((heading) => <th key={heading} className="whitespace-nowrap px-2 py-2 font-medium">{heading}</th>)}</tr></thead><tbody>{positions.map((item) => <tr key={`${item.account_ref}-${item.symbol}`} className="border-b border-border/30"><td className="px-2 py-2 text-xs text-muted-foreground">{item.account_label}</td><td className="px-2 py-2"><span className="font-medium">{item.name}</span><span className="ml-1.5 font-mono text-xs text-muted-foreground/60">{item.symbol}</span></td><td className="px-2 py-2 font-mono">{fmt(item.quantity)}</td><td className="px-2 py-2"><span className="font-mono">{fmt(item.average_cost)}</span><span className="ml-1.5 text-[10px] text-muted-foreground">{sourceLabel(item.cost_status, locale)}</span></td><td className="px-2 py-2 font-mono">{fmt(item.latest_price)}</td><td className="px-2 py-2 font-mono">{fmt(item.reporting_market_value ?? item.market_value)} <span className="text-[10px] text-muted-foreground">{item.reporting_currency || item.currency}</span></td><td className={`px-2 py-2 ${pnlClass(item.unrealized_pnl)}`}><span className="font-mono">{signed(item.unrealized_pnl)}</span><span className="ml-1.5 text-[10px] text-muted-foreground">{sourceLabel(item.pnl_status, locale)}</span></td><td className="px-2 py-2 text-xs text-muted-foreground">{item.currency}{item.venue ? ` · ${item.venue}` : ""}</td></tr>)}</tbody></table></div>
      {data.warnings.length > 0 && <p className="mt-3 text-xs text-warning">{data.warnings.join(locale === "en" ? "; " : "；")}</p>}
      <p className="mt-3 text-[11px] text-muted-foreground/60">{tr("Last refreshed: ", "最后刷新：")}{data.refreshed_at ? new Date(data.refreshed_at).toLocaleString(locale) : "—"} · {tr("Source: ", "数据源：")}IBKR Flex</p>
    </>}
    {job && <p className="mt-3 text-xs text-muted-foreground">{tr("Refresh job: ", "刷新任务：")}{job.status} · {tr("Current positions", "当前持仓")} {job.positions_status} · {tr("Historical P&L", "历史 P&L")} {job.history_status}{job.error_message ? ` · ${job.error_message}` : ""}</p>}
    <IbkrAnalyticsView analytics={analytics} analyticsError={analyticsError} chartError={chartError} instruments={instruments} selectedKey={selectedKey} onSelect={setSelectedKey} range={range} onRange={setRange} chart={chart} mapping={mapping} setMapping={setMapping} multiplier={multiplier} setMultiplier={setMultiplier} onSaveMapping={saveMapping} />
  </GlassCard>;
}

function IbkrAnalyticsView({
  analytics, analyticsError, chartError, instruments, selectedKey, onSelect, range, onRange, chart, mapping, setMapping, multiplier, setMultiplier, onSaveMapping,
}: {
  analytics: IbkrAnalytics | null; instruments: IbkrInstrument[]; selectedKey: string | null; onSelect: (key: string) => void;
  analyticsError: string | null; chartError: string | null;
  range: string; onRange: (range: string) => void; chart: IbkrPositionChart | null; mapping: string;
  setMapping: (value: string) => void; multiplier: string; setMultiplier: (value: string) => void; onSaveMapping: () => void;
}) {
  const { locale, tr } = useLocale();
  const chartHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!chartHost.current || !chart?.bars.length) return;
    const instance = echarts.init(chartHost.current);
    const bars = chart.bars.filter((bar) => bar.open != null && bar.close != null && bar.low != null && bar.high != null);
    const dates = bars.map((bar) => bar.date);
    const closes = bars.map((bar) => bar.close as number);
    const averageCost = chart.instrument.average_cost;
    const buy = chart.executions.filter((item) => item.side === "BUY").map((item) => [item.occurred_at.slice(0, 10), item.price, item.quantity]);
    const sell = chart.executions.filter((item) => item.side === "SELL").map((item) => [item.occurred_at.slice(0, 10), item.price, item.quantity]);
    const volumeMillions = bars.map((bar) => (bar.volume || 0) / 1_000_000);
    const sma = closes.map((_, index) => { const values = closes.slice(Math.max(0, index - 19), index + 1); return values.reduce((sum, value) => sum + value, 0) / values.length; });
    const chartGrid = (compact: boolean) => compact
      ? [{ left: 42, right: 14, top: 54, height: "54%" }, { left: 42, right: 14, top: "76%", height: "13%" }]
      : [{ left: 58, right: 76, top: 40, height: "58%" }, { left: 58, right: 76, top: "76%", height: "14%" }];
    const compact = chartHost.current.clientWidth < 520;
    instance.setOption({
      animation: false, tooltip: { trigger: "axis", axisPointer: { type: "cross" }, valueFormatter: chartValue },
      legend: { type: "scroll", left: compact ? 0 : "center", right: compact ? 0 : undefined, data: [tr("Price", "价格"), "SMA20", tr("Volume (millions)", "成交量（百万）"), tr("Buy", "买入"), tr("Sell", "卖出")], textStyle: { color: "#94a3b8" } },
      grid: chartGrid(compact),
      xAxis: [{ type: "category", data: dates, axisLabel: { color: "#94a3b8", hideOverlap: true } }, { type: "category", gridIndex: 1, data: dates, axisLabel: { show: false } }],
      yAxis: [{ scale: true, axisLabel: { color: "#94a3b8", formatter: (value: number) => portfolioNumber(value) }, splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } } }, { gridIndex: 1, scale: true, name: tr("million", "百万"), nameTextStyle: { color: "#64748b", fontSize: 10 }, axisLabel: { color: "#94a3b8", formatter: (value: number) => `${portfolioNumber(value)}M` } }],
      dataZoom: [{ type: "inside", xAxisIndex: [0, 1] }, { type: "slider", xAxisIndex: [0, 1], bottom: 0, height: 18 }],
      series: [
        { name: tr("Price", "价格"), type: "candlestick", data: bars.map((bar) => [bar.open, bar.close, bar.low, bar.high]), itemStyle: { color: "#22c55e", color0: "#ef4444", borderColor: "#22c55e", borderColor0: "#ef4444" }, markLine: averageCost != null ? { symbol: "none", data: [{ yAxis: averageCost, lineStyle: { color: "#f59e0b", type: "dashed", width: 1.5 }, label: { position: "insideEndTop", distance: 6, formatter: `${tr("Cost", "成本")} ${portfolioNumber(averageCost)}`, color: "#fbbf24", backgroundColor: "rgba(15,23,42,.88)", borderRadius: 3, padding: [3, 5] } }] } : undefined },
        { name: "SMA20", type: "line", showSymbol: false, data: sma, lineStyle: { color: "#60a5fa" } },
        { name: tr("Volume (millions)", "成交量（百万）"), type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: volumeMillions, itemStyle: { color: "rgba(148,163,184,.48)" } },
        { name: tr("Buy", "买入"), type: "scatter", data: buy, symbol: "path://M0,-8 L8,8 L-8,8 Z", symbolSize: 15, itemStyle: { color: "#14b8a6", borderColor: "#ccfbf1", borderWidth: 2 } },
        { name: tr("Sell", "卖出"), type: "scatter", data: sell, symbol: "path://M0,8 L8,-8 L-8,-8 Z", symbolSize: 15, itemStyle: { color: "#f97316", borderColor: "#ffedd5", borderWidth: 2 } },
      ],
    });
    const resize = () => {
      const nextCompact = (chartHost.current?.clientWidth || 0) < 520;
      instance.setOption({ grid: chartGrid(nextCompact), legend: { left: nextCompact ? 0 : "center", right: nextCompact ? 0 : undefined } });
      instance.resize();
    };
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); instance.dispose(); };
  }, [chart, locale, tr]);

  if (!analytics && !instruments.length && !analyticsError) return null;
  const latest = analytics?.latest_contributors || [];
  const reconciliationWarnings = analytics?.reconciliations.filter((item) => item.status === "warning") || [];
  return <div className="mt-6 border-t border-border/50 pt-5">
    <div className="mb-3"><h3 className="flex items-center gap-2 text-base font-semibold"><BarChart3 className="h-4 w-4 text-primary" />{tr("IBKR portfolio analytics", "IBKR 组合分析")}</h3><p className="text-xs text-muted-foreground">{tr("Syncing IBKR automatically updates positions, daily P&L, and execution points; no manual trade ledger is required.", "同步 IBKR 时会自动更新仓位、每日盈亏与交易点位，无需手工维护交易记录。")}</p></div>
    {analyticsError && <p className="mb-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">{analyticsError}</p>}
    {analytics && <>
      <div className="grid gap-3 sm:grid-cols-4"><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{tr("Latest NAV", "最新 NAV")}</p><p className="font-mono text-lg font-bold">{fmt(analytics.latest_nav)} <span className="text-xs font-normal text-muted-foreground">{analytics.reporting_currency || ""}</span></p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{tr("Gross exposure", "总敞口")}</p><p className="font-mono text-lg font-bold">{fmt(analytics.gross_exposure)}</p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{tr("P&L days", "P&L 天数")}</p><p className="font-mono text-lg font-bold">{analytics.daily_pnl.length}</p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{tr("Latest report", "最新报告")}</p><p className="font-mono text-sm font-bold">{analytics.latest_report_date || "—"}</p></div></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-border/50 p-3"><p className="text-xs text-muted-foreground">{tr("Flow-adjusted return", "资金流调整回报")} · {range.toUpperCase()}</p><p className="mt-1 font-mono text-lg font-bold">{percent(analytics.performance.flow_adjusted_return)}</p></div><div className="rounded-lg border border-border/50 p-3"><p className="text-xs text-muted-foreground">{tr("Maximum drawdown", "最大回撤")} · {analytics.performance.observations} {tr("days", "天")}</p><p className={`mt-1 font-mono text-lg font-bold ${pnlClass(analytics.performance.max_drawdown)}`}>{percent(analytics.performance.max_drawdown)}</p></div><div className="rounded-lg border border-border/50 p-3"><p className="text-xs text-muted-foreground">{tr("Broker reconciliation", "券商对账")}</p><p className={`mt-1 text-sm font-semibold ${reconciliationWarnings.length ? "text-warning" : "text-success"}`}>{analytics.reconciliations.length ? (reconciliationWarnings.length ? tr(`${reconciliationWarnings.length} differences`, `${reconciliationWarnings.length} 个差异`) : tr("Fully reconciled", "全部一致")) : tr("Waiting for a complete IBKR snapshot", "等待 IBKR 完整快照")}</p></div></div>
      {analytics.performance.reason && <p className="mt-2 text-xs text-muted-foreground">{tr("Return unavailable: ", "回报暂不可用：")}{analytics.performance.reason}</p>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2"><div><h4 className="mb-2 text-sm font-semibold">{tr("Position allocation", "持仓配置")}</h4><div className="space-y-2">{analytics.allocation.slice(0, 12).map((item) => <div key={`${item.symbol}-${item.currency}`}><div className="flex justify-between text-xs"><span>{item.side} · {item.symbol}</span><span className="font-mono">{percent(item.weight)}</span></div><div className="mt-1 h-2 rounded-full bg-muted/40"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, item.weight * 100)}%` }} /></div></div>)}</div></div><div><h4 className="mb-2 text-sm font-semibold">{tr("P&L calendar", "P&L 日历")}</h4><div className="grid max-h-52 grid-cols-2 gap-1 overflow-auto sm:grid-cols-3">{analytics.daily_pnl.map((item) => <div key={`${item.calendar_date}-${item.reporting_currency}`} className={`rounded border p-2 text-xs ${item.pnl_amount > 0 ? "border-success/25 bg-success/5" : item.pnl_amount < 0 ? "border-danger/25 bg-danger/5" : "border-border/50"}`}><div className="text-muted-foreground">{item.calendar_date} · {item.reporting_currency}</div><div className={`font-mono ${pnlClass(item.pnl_amount)}`}>{signed(item.pnl_amount)}</div></div>)}</div></div></div>
      <div className="mt-4"><h4 className="mb-2 text-sm font-semibold">{tr("Latest broker P&L contributors", "最新券商 P&L 贡献")} {analytics.latest_report_date ? `· ${analytics.latest_report_date}` : ""}</h4>{latest.length ? <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-border/50 text-left text-muted-foreground"><th className="p-2">{tr("Symbol", "代码")}</th><th className="p-2">{tr("Close", "收盘价")}</th><th className="p-2">{tr("Transaction MTM", "交易市值变动")}</th><th className="p-2">{tr("Total", "合计")}</th></tr></thead><tbody>{latest.map((item) => <tr key={`${item.account_ref}-${item.report_date}-${item.symbol}`} className="border-b border-border/30"><td className="p-2 font-medium">{item.symbol}</td><td className="p-2 font-mono">{fmt(item.close_price)}</td><td className={`p-2 font-mono ${pnlClass(item.transaction_mtm)}`}>{signed(item.transaction_mtm)}</td><td className={`p-2 font-mono ${pnlClass(item.total)}`}>{signed(item.total)}</td></tr>)}</tbody></table></div> : <p className="text-xs text-muted-foreground">{tr("No historical P&L. Configure the IBKR history query and refresh.", "暂无历史 P&L。请配置 IBKR history query 后刷新。")}</p>}</div>
      <details className="mt-4 rounded-lg border border-border/50"><summary className="cursor-pointer px-3 py-2 text-sm font-semibold">{tr("Automatically synced transactions", "自动同步的交易记录")} ({analytics.recent_transactions.length})</summary><div className="overflow-x-auto border-t border-border/40"><table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="p-2">{tr("Date", "日期")}</th><th className="p-2">{tr("Account", "账户")}</th><th className="p-2">{tr("Instrument", "标的")}</th><th className="p-2">{tr("Side", "方向")}</th><th className="p-2">{tr("Quantity", "数量")}</th><th className="p-2">{tr("Price", "价格")}</th><th className="p-2">{tr("Net cash", "净现金")}</th></tr></thead><tbody>{analytics.recent_transactions.map((item) => <tr key={item.trade_key} className="border-t border-border/30"><td className="whitespace-nowrap p-2">{item.occurred_at.slice(0, 10)}</td><td className="whitespace-nowrap p-2 text-muted-foreground">{item.account_label}</td><td className="p-2 font-medium">{item.symbol}</td><td className="p-2">{item.side}</td><td className="p-2 font-mono">{fmt(item.quantity)}</td><td className="p-2 font-mono">{fmt(item.price)}</td><td className="p-2 font-mono">{signed(item.net_cash)} <span className="text-muted-foreground">{item.currency}</span></td></tr>)}</tbody></table>{analytics.recent_transactions.length === 0 && <p className="p-3 text-xs text-muted-foreground">{tr("No synced transactions.", "暂无已同步交易。")}</p>}</div></details>
      {analytics.warnings.length > 0 && <p className="mt-3 text-xs text-warning">{analytics.warnings.join(locale === "en" ? "; " : "；")}</p>}
    </>}
    {instruments.length > 0 && <div className="mt-5"><h4 className="mb-2 text-sm font-semibold">{tr("Position deep dive", "持仓深度分析")}</h4><div className="flex flex-wrap gap-2">{instruments.map((item) => <button key={item.instrument_key} onClick={() => onSelect(item.instrument_key)} className={`rounded-lg border px-3 py-2 text-left text-xs ${selectedKey === item.instrument_key ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground"}`}><span className="font-mono font-semibold">{item.symbol}</span><span className="ml-2">{item.status} · {fmt(item.quantity)}</span></button>)}</div></div>}
    {chartError && <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">{chartError}</p>}
    {chart && <div className="mt-4 rounded-lg border border-border/60 p-3"><div className="flex flex-wrap items-center gap-2"><div><p className="font-semibold">{chart.instrument.name} <span className="font-mono text-xs text-muted-foreground">{chart.instrument.symbol}</span></p><p className="text-xs text-muted-foreground">{chart.provider_symbol || tr("Unmapped", "未映射")} · {chart.mapping_source}</p></div><div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">{chart.instrument.status === "open" && chart.provider_symbol && <Link to={`/debate?mode=team&asset_type=equity&code=${encodeURIComponent(chart.provider_symbol)}&position_context=1&position=${encodeURIComponent(chart.instrument.instrument_key)}`} className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary"><Users className="h-3.5 w-3.5" />{tr("Research team", "研究团队")}</Link>}<input value={mapping} onChange={(event) => setMapping(event.target.value)} placeholder={tr("Yahoo symbol, e.g. VOD.L", "Yahoo symbol，如 VOD.L")} className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs sm:w-40 sm:flex-none" /><input value={multiplier} onChange={(event) => setMultiplier(event.target.value)} className="w-14 rounded border border-border bg-background px-2 py-1 text-xs" title={tr("Price multiplier", "价格倍数")} /><button onClick={onSaveMapping} className="rounded bg-primary/15 px-2 py-1 text-xs text-primary">{tr("Save mapping", "保存映射")}</button></div></div><div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border/40 pt-3"><span className="mr-1 text-xs text-muted-foreground">{tr("Chart range", "图表区间")}</span>{["1m", "3m", "ytd", "1y", "2y", "all"].map((item) => <button key={item} onClick={() => onRange(item)} className={`rounded px-2 py-1 text-xs ${range === item ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground"}`}>{item.toUpperCase()}</button>)}</div>{chart.bars.length ? <div ref={chartHost} className="mt-2 h-[360px] w-full sm:h-[430px]" role="img" aria-label={tr("IBKR position price chart with executions", "含成交点位的 IBKR 持仓价格图")} /> : <p className="py-8 text-center text-sm text-muted-foreground">{tr("No market data", "暂无行情数据")}</p>}{chart.warnings.length > 0 && <p className="mt-2 text-xs text-warning">{chart.warnings.join(locale === "en" ? "; " : "；")}</p>}</div>}
  </div>;
}
