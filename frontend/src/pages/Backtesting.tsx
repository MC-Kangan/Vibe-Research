import { useMemo, useState, type FormEvent } from "react";
import { AlertCircle, Beaker, Loader2, Play, TrendingUp } from "lucide-react";
import { ApiError, api, type BacktestResponse, type BacktestStrategy } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { EChart } from "@/components/ui/EChart";
import { Disclaimer } from "@/components/ui/Disclaimer";

const STRATEGIES: Array<{ kind: BacktestStrategy["kind"]; en: string; zh: string }> = [
  { kind: "sma_crossover", en: "SMA crossover", zh: "均线交叉" },
  { kind: "macd_crossover", en: "MACD crossover", zh: "MACD 交叉" },
  { kind: "rsi_mean_reversion", en: "RSI mean reversion", zh: "RSI 均值回归" },
  { kind: "markov_regime", en: "Markov regime", zh: "马尔可夫状态" },
];

function defaultStartDate() {
  const value = new Date();
  value.setUTCFullYear(value.getUTCFullYear() - 1);
  return value.toISOString().slice(0, 10);
}

function defaultStrategy(kind: BacktestStrategy["kind"]): BacktestStrategy {
  if (kind === "macd_crossover") return { kind, fast_window: 12, slow_window: 26, signal_window: 9 };
  if (kind === "rsi_mean_reversion") return { kind, window: 14, entry_threshold: 30, exit_threshold: 70 };
  if (kind === "markov_regime") return { kind, window: 20, bull_threshold: .05, bear_threshold: -.05, min_train: 200 };
  return { kind: "sma_crossover", fast_window: 20, slow_window: 50 };
}

function NumberField({ label, value, onChange, min, max, step = 1 }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number;
}) {
  return <label className="space-y-1 text-xs text-muted-foreground"><span>{label}</span><input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary/60" /></label>;
}

function StrategyFields({ strategy, onChange }: { strategy: BacktestStrategy; onChange: (value: BacktestStrategy) => void }) {
  const { tr } = useLocale();
  if (strategy.kind === "sma_crossover") return <div className="grid gap-3 sm:grid-cols-2"><NumberField label={tr("Fast SMA window", "短期均线窗口")} value={strategy.fast_window} min={2} max={252} onChange={(fast_window) => onChange({ ...strategy, fast_window })} /><NumberField label={tr("Slow SMA window", "长期均线窗口")} value={strategy.slow_window} min={3} max={520} onChange={(slow_window) => onChange({ ...strategy, slow_window })} /></div>;
  if (strategy.kind === "macd_crossover") return <div className="grid gap-3 sm:grid-cols-3"><NumberField label={tr("Fast EMA", "快速 EMA")} value={strategy.fast_window} min={2} max={252} onChange={(fast_window) => onChange({ ...strategy, fast_window })} /><NumberField label={tr("Slow EMA", "慢速 EMA")} value={strategy.slow_window} min={3} max={520} onChange={(slow_window) => onChange({ ...strategy, slow_window })} /><NumberField label={tr("Signal window", "信号窗口")} value={strategy.signal_window} min={2} max={252} onChange={(signal_window) => onChange({ ...strategy, signal_window })} /></div>;
  if (strategy.kind === "rsi_mean_reversion") return <div className="grid gap-3 sm:grid-cols-3"><NumberField label={tr("RSI window", "RSI 窗口")} value={strategy.window} min={2} max={252} onChange={(window) => onChange({ ...strategy, window })} /><NumberField label={tr("Entry threshold", "入场阈值")} value={strategy.entry_threshold} min={1} max={99} onChange={(entry_threshold) => onChange({ ...strategy, entry_threshold })} /><NumberField label={tr("Exit threshold", "退出阈值")} value={strategy.exit_threshold} min={1} max={99} onChange={(exit_threshold) => onChange({ ...strategy, exit_threshold })} /></div>;
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><NumberField label={tr("Regime window", "状态窗口")} value={strategy.window} min={2} max={252} onChange={(window) => onChange({ ...strategy, window })} /><NumberField label={tr("Bull threshold (%)", "多头阈值（%）")} value={strategy.bull_threshold * 100} min={.1} max={100} step={.1} onChange={(value) => onChange({ ...strategy, bull_threshold: value / 100 })} /><NumberField label={tr("Bear threshold (%)", "空头阈值（%）")} value={strategy.bear_threshold * 100} min={-100} max={-.1} step={.1} onChange={(value) => onChange({ ...strategy, bear_threshold: value / 100 })} /><NumberField label={tr("Training bars", "训练日线数")} value={strategy.min_train} min={50} max={520} onChange={(min_train) => onChange({ ...strategy, min_train })} /></div>;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border/60 bg-muted/15 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-lg font-semibold">{value}</p></div>;
}

export function Backtesting() {
  const { locale, tr } = useLocale();
  const [assetType, setAssetType] = useState<"equity" | "crypto">("equity");
  const [symbol, setSymbol] = useState("");
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [initialCash, setInitialCash] = useState(1000);
  const [minimumHolding, setMinimumHolding] = useState(1);
  const [commissionPct, setCommissionPct] = useState(.1);
  const [spreadPct, setSpreadPct] = useState(0);
  const [positionSizePct, setPositionSizePct] = useState(95);
  const [strategy, setStrategy] = useState<BacktestStrategy>(() => defaultStrategy("sma_crossover"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<BacktestResponse | null>(null);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (!symbol.trim() || !startDate) return setError(tr("Enter a symbol and start date.", "请输入标的代码和开始日期。"));
    setLoading(true); setError(null);
    try {
      setResponse(await api.runBacktest({
        symbol: symbol.trim().toUpperCase(), asset_type: assetType, start_date: startDate,
        strategy, initial_cash: initialCash, minimum_holding_days: minimumHolding,
        commission: commissionPct / 100, spread: spreadPct / 100, position_size: positionSizePct / 100,
      }));
    } catch (unknown) {
      setError(unknown instanceof ApiError ? unknown.message : tr("Backtest failed.", "回测失败。"));
    } finally { setLoading(false); }
  };

  const presentation = response?.result.presentation || null;
  const observations = Object.fromEntries((response?.result.observations || []).map((item) => [item.metric, item.value]));
  const money = (value: unknown) => Number.isFinite(Number(value)) ? new Intl.NumberFormat(locale, { style: "currency", currency: response?.currency || "USD", maximumFractionDigits: 2 }).format(Number(value)) : "—";
  const percent = (value: unknown) => Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(2)}%` : "—";
  const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "—";

  const priceOption = useMemo(() => {
    if (!presentation) return {};
    const dates = presentation.price_bars.map((bar) => bar.observed_at.slice(0, 10));
    const markData = presentation.trades.flatMap((trade) => [
      { name: tr("Buy", "买入"), coord: [trade.entry_at.slice(0, 10), trade.entry_price], symbol: "triangle", symbolSize: 13, itemStyle: { color: "#22c55e" }, label: { show: false } },
      { name: tr("Sell", "卖出"), coord: [trade.exit_at.slice(0, 10), trade.exit_price], symbol: "pin", symbolSize: 16, itemStyle: { color: "#ef4444" }, label: { show: false } },
    ]);
    if (presentation.open_position) markData.push({ name: tr("Open", "持有中"), coord: [presentation.open_position.entry_at.slice(0, 10), presentation.open_position.entry_price], symbol: "triangle", symbolSize: 13, itemStyle: { color: "#f59e0b" }, label: { show: false } });
    const priceIndicators = presentation.indicator_series.filter((item) => item.panel === "price");
    const byDate = (points: Array<{ observed_at: string; value: number }>) => Object.fromEntries(points.map((point) => [point.observed_at.slice(0, 10), point.value]));
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "cross" } }, legend: { type: "scroll", top: 4, left: 58, right: 20, textStyle: { color: "#94a3b8" } },
      grid: { left: 58, right: 20, top: 64, bottom: 72, containLabel: true }, xAxis: { type: "category", data: dates, axisLabel: { color: "#94a3b8", hideOverlap: true } },
      yAxis: { scale: true, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } } },
      dataZoom: [{ type: "inside", start: 20, end: 100 }, { type: "slider", bottom: 4, height: 18 }],
      series: [
        { name: tr("Price", "价格"), type: "candlestick", data: presentation.price_bars.map((bar) => [bar.open, bar.close, bar.low, bar.high]), itemStyle: { color: "#22c55e", color0: "#ef4444", borderColor: "#22c55e", borderColor0: "#ef4444" }, markPoint: { data: markData } },
        ...priceIndicators.map((item, index) => { const values = byDate(item.points); return { name: item.label, type: "line", showSymbol: false, data: dates.map((date) => values[date] ?? null), lineStyle: { width: 1.5, color: ["#60a5fa", "#f59e0b", "#c084fc"][index % 3] } }; }),
      ],
    };
  }, [presentation, tr]);

  const indicatorOption = useMemo(() => {
    if (!presentation) return {};
    const items = presentation.indicator_series.filter((item) => item.panel !== "price");
    const dates = presentation.price_bars.map((bar) => bar.observed_at.slice(0, 10));
    return {
      tooltip: { trigger: "axis" }, legend: { type: "scroll", top: 4, left: 58, right: 20, textStyle: { color: "#94a3b8" } }, grid: { left: 58, right: 20, top: 64, bottom: 48, containLabel: true },
      xAxis: { type: "category", data: dates, axisLabel: { color: "#94a3b8", hideOverlap: true } },
      yAxis: { scale: true, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } } },
      series: items.map((item, index) => { const values = Object.fromEntries(item.points.map((point) => [point.observed_at.slice(0, 10), point.value])); return { name: item.label, type: item.panel === "regime" ? "bar" : "line", showSymbol: false, data: dates.map((date) => values[date] ?? null), lineStyle: { color: ["#c084fc", "#f59e0b", "#60a5fa"][index % 3] }, itemStyle: { color: "#64748b" } }; }),
    };
  }, [presentation]);

  const equityOption = useMemo(() => presentation ? {
    tooltip: { trigger: "axis" }, legend: { type: "scroll", top: 4, left: 64, right: 64, textStyle: { color: "#94a3b8" } }, grid: { left: 64, right: 64, top: 64, bottom: 48, containLabel: true },
    xAxis: { type: "category", data: presentation.curve.map((point) => point.observed_at.slice(0, 10)), axisLabel: { color: "#94a3b8", hideOverlap: true } },
    yAxis: [{ scale: true, axisLabel: { color: "#94a3b8" } }, { min: 0, max: 1, inverse: true, axisLabel: { color: "#94a3b8", formatter: (value: number) => `${(value * 100).toFixed(0)}%` } }],
    series: [{ name: tr("Equity", "权益"), type: "line", showSymbol: false, data: presentation.curve.map((point) => point.equity), lineStyle: { color: "#22c55e", width: 2 } }, { name: tr("Drawdown", "回撤"), type: "line", yAxisIndex: 1, showSymbol: false, areaStyle: { opacity: .12 }, data: presentation.curve.map((point) => point.drawdown), lineStyle: { color: "#ef4444" } }],
  } : {}, [presentation, tr]);

  return <div>
    <PageHeader title={tr("Backtest playground", "回测实验室")} subtitle={tr("Test bounded daily long-only ideas with TradeAgent; no intraday trading or broker actions", "使用 TradeAgent 测试有边界的日线做多策略；不含日内交易或券商操作")} />
    <GlassCard glow className="mb-5"><form onSubmit={run} className="space-y-4">
      <div className="flex w-fit gap-1 rounded-lg border border-border/60 bg-muted/20 p-1">{(["equity", "crypto"] as const).map((value) => <button type="button" key={value} onClick={() => setAssetType(value)} className={`rounded-md px-4 py-1.5 text-sm ${assetType === value ? "bg-background text-primary shadow-sm" : "text-muted-foreground"}`}>{value === "equity" ? tr("Stocks", "股票") : tr("Crypto", "加密货币")}</button>)}</div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-xs text-muted-foreground"><span>{tr("Symbol", "标的代码")}</span><input value={symbol} onChange={(event) => setSymbol(event.target.value.replace(/[^a-zA-Z0-9.-]/g, "").toUpperCase().slice(0, 24))} placeholder={assetType === "crypto" ? "BTC" : "AAPL"} className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60" /></label>
        <label className="space-y-1 text-xs text-muted-foreground"><span>{tr("Performance start", "回测开始日期")}</span><input type="date" value={startDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60" /></label>
        <NumberField label={tr("Starting capital (USD)", "初始资金（美元）")} value={initialCash} min={1} step={1} onChange={setInitialCash} />
        <NumberField label={tr("Minimum holding (trading days)", "最短持有（交易日）")} value={minimumHolding} min={1} max={520} onChange={setMinimumHolding} />
      </div>
      <div><p className="mb-2 text-xs text-muted-foreground">{tr("Strategy", "策略")}</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{STRATEGIES.map((item) => <button type="button" key={item.kind} onClick={() => setStrategy(defaultStrategy(item.kind))} className={`rounded-lg border px-3 py-2 text-left text-sm ${strategy.kind === item.kind ? "border-primary/50 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"}`}>{tr(item.en, item.zh)}</button>)}</div></div>
      <details className="rounded-xl border border-border/60 bg-muted/10 p-3"><summary className="cursor-pointer text-sm font-medium">{tr("Advanced assumptions and strategy parameters", "高级假设与策略参数")}</summary><div className="mt-4 space-y-4"><StrategyFields strategy={strategy} onChange={setStrategy} /><div className="grid gap-3 sm:grid-cols-3"><NumberField label={tr("Commission (%)", "佣金（%）")} value={commissionPct} min={0} max={10} step={.01} onChange={setCommissionPct} /><NumberField label={tr("Spread (%)", "价差（%）")} value={spreadPct} min={0} max={10} step={.01} onChange={setSpreadPct} /><NumberField label={tr("Capital used (%)", "资金使用比例（%）")} value={positionSizePct} min={1} max={99.99} step={1} onChange={setPositionSizePct} /></div></div></details>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{tr("USD-quoted US stocks and crypto only. Signals use each daily close and fill at the following daily open.", "目前仅支持以美元计价的美股和加密货币。信号使用每日收盘数据，并在下一交易日开盘成交。")}</p><button type="submit" disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary shadow-glow hover:bg-primary/25 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{tr("Run backtest", "运行回测")}</button></div>
    </form></GlassCard>
    {error && <div className="mb-5 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{error}</div>}
    {response && !presentation && <GlassCard><p className="text-sm text-muted-foreground">{response.result.summary || tr("TradeAgent could not produce a complete backtest.", "TradeAgent 无法生成完整回测。")}</p></GlassCard>}
    {response && presentation && <div className="space-y-5">
      <GlassCard><div className="mb-4 flex flex-wrap items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">{response.symbol} · {presentation.strategy_name}</h2><span className={`rounded px-2 py-1 text-xs ${response.result.status === "complete" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{response.result.status}</span><span className="ml-auto text-xs text-muted-foreground">{response.available_start_date} — {response.available_end_date}</span></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><MetricCard label={tr("Final equity", "最终权益")} value={money(observations.backtest_final_equity)} /><MetricCard label={tr("Strategy return", "策略收益")} value={percent(observations.backtest_total_return)} /><MetricCard label={tr("Buy and hold", "买入并持有")} value={percent(observations.backtest_buy_hold_return)} /><MetricCard label={tr("Maximum drawdown", "最大回撤")} value={percent(observations.backtest_max_drawdown)} /><MetricCard label={tr("Closed trades", "已平仓交易")} value={number(observations.backtest_trade_count)} /><MetricCard label={tr("Win rate", "胜率")} value={percent(observations.backtest_win_rate)} /><MetricCard label={tr("Sharpe ratio", "夏普比率")} value={number(observations.backtest_sharpe_ratio)} /><MetricCard label={tr("Minimum hold", "最短持有")} value={`${presentation.assumptions.minimum_holding_bars}d`} /></div>{response.result.limitations?.length ? <p className="mt-3 text-xs text-warning">{response.result.limitations.join(" · ")}</p> : null}</GlassCard>
      <GlassCard><h3 className="mb-3 font-semibold">{tr("Price and executed trades", "价格与实际成交")}</h3><EChart option={priceOption} label={tr("Backtest price with buy and sell points", "带买卖点的回测价格图")} className="h-[480px]" /></GlassCard>
      {presentation.indicator_series.some((item) => item.panel !== "price") && <GlassCard><h3 className="mb-3 font-semibold">{tr("Strategy indicators", "策略指标")}</h3><EChart option={indicatorOption} label={tr("Backtest strategy indicators", "回测策略指标")} className="h-72" /></GlassCard>}
      <GlassCard><h3 className="mb-3 font-semibold">{tr("Equity and drawdown", "权益与回撤")}</h3><EChart option={equityOption} label={tr("Backtest equity and drawdown", "回测权益与回撤")} className="h-80" /></GlassCard>
      {presentation.open_position && <GlassCard><div className="flex items-center gap-2"><Beaker className="h-5 w-5 text-warning" /><h3 className="font-semibold">{tr("Position open at test end", "回测结束时仍持仓")}</h3></div><div className="mt-3 grid gap-3 sm:grid-cols-3"><MetricCard label={tr("Entry price", "入场价")} value={money(presentation.open_position.entry_price)} /><MetricCard label={tr("Final mark", "期末估值")} value={money(presentation.open_position.current_price)} /><MetricCard label={tr("Unrealized P/L", "未实现盈亏")} value={money(presentation.open_position.unrealized_pnl)} /></div></GlassCard>}
      {presentation.trades.length > 0 && <GlassCard><h3 className="mb-3 font-semibold">{tr("Closed trades", "已平仓交易")}</h3><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="text-muted-foreground"><tr>{[tr("Entry", "入场"), tr("Exit", "退出"), tr("Entry price", "入场价"), tr("Exit price", "退出价"), tr("P/L", "盈亏"), tr("Return", "收益率"), tr("Days", "天数")].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{presentation.trades.map((trade, index) => <tr key={`${trade.entry_at}-${index}`} className="border-t border-border/40"><td className="p-2">{trade.entry_at.slice(0, 10)}</td><td className="p-2">{trade.exit_at.slice(0, 10)}</td><td className="p-2 font-mono">{money(trade.entry_price)}</td><td className="p-2 font-mono">{money(trade.exit_price)}</td><td className={`p-2 font-mono ${trade.pnl >= 0 ? "text-success" : "text-danger"}`}>{money(trade.pnl)}</td><td className="p-2 font-mono">{percent(trade.return_ratio)}</td><td className="p-2 font-mono">{trade.duration_bars}</td></tr>)}</tbody></table></div></GlassCard>}
    </div>}
    <Disclaimer />
  </div>;
}
