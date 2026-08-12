import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BarChart3, BookOpen, Loader2, Play, SlidersHorizontal } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { EChart } from "@/components/ui/EChart";
import { ApiError, api, type ResearchRunResponse, type ResearchSkill } from "@/lib/api";

type Json = Record<string, any>;
type Guide = { overview: string; rows: Array<{ term: string; meaning: string; interpretation: string }> };

// Financial skill terminology stays canonical English across app locales.
const tr = (english: string, _chinese: string): string => english;

const SKILL_GUIDES: Record<string, Guide> = {
  "fundamental": {
    overview: "Calculates point-in-time growth, profitability, cash-flow, leverage, and valuation factors from SEC Company Facts. Missing factors remain explicit rather than being estimated.",
    rows: [
      { term: "Revenue / earnings growth", meaning: "Change from the comparable prior reporting period.", interpretation: "Positive growth is constructive when periods are comparable; negative growth signals contraction. One period does not establish a durable trend." },
      { term: "Operating / net margin", meaning: "Operating income or net income divided by revenue.", interpretation: "Higher is generally better, but compare with the same company and industry because business models differ." },
      { term: "Return on equity", meaning: "Net income relative to shareholders' equity.", interpretation: "Higher can indicate capital efficiency, but leverage or unusually low equity can inflate it." },
      { term: "Free cash flow / margin", meaning: "Operating cash flow less capital expenditure, shown directly and relative to revenue.", interpretation: "Positive and improving cash conversion is constructive. Capital-intensive businesses can be volatile between periods." },
      { term: "Leverage", meaning: "Reported debt divided by shareholders' equity.", interpretation: "Lower usually means less balance-sheet risk. Appropriate levels vary materially by industry." },
      { term: "P/E, EV/EBITDA, FCF yield", meaning: "Point-in-time valuation factors when compatible market values are available.", interpretation: "Lower multiples or higher yield may indicate cheaper valuation, but only when earnings and cash flow are representative." },
    ],
  },
  "filings": {
    overview: "Summarizes the recent SEC filing record. It measures filing activity and reporting recency; it does not interpret the full filing text.",
    rows: [
      { term: "Recent filing count", meaning: "Number of bounded recent SEC submissions returned by the provider.", interpretation: "Context only. A larger count is not inherently bullish or bearish." },
      { term: "Material event count", meaning: "Number of recent 8-K or amended 8-K filings.", interpretation: "More events warrant document review, but event direction cannot be inferred from the count." },
      { term: "Annual report age", meaning: "Days since the latest 10-K or amended 10-K.", interpretation: "A smaller value means more recent annual information. Missing data may reflect issuer form or coverage differences." },
      { term: "Quarterly report age", meaning: "Days since the latest 10-Q or amended 10-Q.", interpretation: "A smaller value means more recent quarterly information; foreign issuers may use different SEC forms." },
    ],
  },
  "worth-buy-stocks": {
    overview: "A rules-based trend and relative-strength screen. High opportunity scores are constructive, while a high risk-veto score can override them.",
    rows: [
      { term: "Composite score", meaning: "Weighted trend, momentum, relative-strength, and volume evidence on a 0–100 scale.", interpretation: "Higher is stronger. 70+ passes the opportunity threshold; 50–69 is a watch setup; below 50 is weak." },
      { term: "Risk veto", meaning: "Penalty for broken trends, excessive extension, or adverse risk conditions.", interpretation: "Lower is better. Below 30 is low; 30–49 is elevated; 50+ is high enough to block a new-entry verdict." },
      { term: "Entry setup", meaning: "The detected price structure around trend continuation, pullback, or recovery.", interpretation: "Constructive labels support the score; broken or overextended labels are cautionary. They are not trade instructions." },
      { term: "Entry / stop / target", meaning: "Model-generated reference levels derived from recent price structure.", interpretation: "Use as scenario markers only. They do not account for portfolio size, liquidity, news, or personal risk limits." },
      { term: "Evidence components", meaning: "The individual 0–100 inputs behind the composite score.", interpretation: "Broad agreement across components is more robust than one unusually high component." },
    ],
  },
  "markov-method": {
    overview: "Classifies recent returns into Bull, Sideways, and Bear regimes, then describes how those observed states transitioned historically.",
    rows: [
      { term: "Current regime", meaning: "The state assigned from the trailing return and configured thresholds.", interpretation: "Bull is directionally positive, Bear negative, and Sideways neutral for the observed window—not a forecast." },
      { term: "Directional signal", meaning: "A signed summary of the current regime probabilities.", interpretation: "Positive leans bullish, negative leans bearish, and values near zero are neutral." },
      { term: "Transition matrix", meaning: "Each row shows the historical probability of moving from one state to the next.", interpretation: "Read across a row. Larger diagonal values mean that state was more persistent." },
      { term: "Stationary distribution", meaning: "The model's long-run share of time in each state if observed transitions persist.", interpretation: "Higher Bull weight is constructive; higher Bear weight is cautionary. It is a model property, not a price target." },
      { term: "Persistence", meaning: "The probability of remaining in the same regime on the next observation.", interpretation: "Higher means stickier regimes, whether bullish or bearish." },
    ],
  },
  "technical-basic": {
    overview: "Combines common trend, momentum, volatility-band, and volume indicators from daily price series.",
    rows: [
      { term: "Technical basic score", meaning: "Composite technical score on a 0–100 scale.", interpretation: "70+ is classified bullish, 40–69 neutral, and below 40 bearish by this skill." },
      { term: "EMA 12 / EMA 26", meaning: "Fast and slow exponential moving averages.", interpretation: "EMA 12 above EMA 26 is bullish trend alignment; below is bearish." },
      { term: "RSI 14", meaning: "Momentum oscillator bounded from 0 to 100.", interpretation: "Above 70 is commonly overbought and below 30 oversold. Extremes describe momentum and do not guarantee reversal." },
      { term: "ADX 14", meaning: "Trend-strength measure from 0 upward, without direction.", interpretation: "Above roughly 25 suggests a meaningful trend. Direction must come from price or moving averages." },
      { term: "Bollinger bands", meaning: "A 20-day average with upper and lower volatility bands.", interpretation: "Price near a band shows relative extension; a band touch alone is neither bullish nor bearish." },
      { term: "OBV trend / volume ratio", meaning: "Direction of on-balance volume and current volume versus its 20-day average.", interpretation: "Positive OBV is constructive. A volume ratio above 1.00 means above-average participation." },
    ],
  },
  "risk-analysis": {
    overview: "Describes realized return risk and tail behavior. Most metrics are risk magnitudes, not bullish or bearish price signals.",
    rows: [
      { term: "Annualized volatility", meaning: "Daily return variability scaled to one year.", interpretation: "Lower generally means a smoother price path; higher means wider expected swings." },
      { term: "Downside volatility", meaning: "Variability of negative returns only.", interpretation: "Lower is generally better from a loss-risk perspective." },
      { term: "Max drawdown", meaning: "Largest peak-to-trough decline in the sample.", interpretation: "Closer to 0% is better. A more negative value means a deeper historical loss." },
      { term: "Historical VaR 95", meaning: "Loss threshold exceeded on about 5% of historical days.", interpretation: "Lower is less severe. It is based on the observed sample, not a worst-case bound." },
      { term: "Historical CVaR 95", meaning: "Average loss on days worse than the 95% VaR threshold.", interpretation: "Lower is better; it focuses on the tail beyond VaR." },
      { term: "Skewness / excess kurtosis", meaning: "Shape of the return distribution and thickness of its tails.", interpretation: "Negative skew implies more downside asymmetry. Positive excess kurtosis implies more extreme outcomes than a normal distribution." },
      { term: "Best / worst daily return", meaning: "Largest observed one-day gain and loss.", interpretation: "Use them to understand realized extremes, not to estimate likely future bounds." },
    ],
  },
  "volatility-regime": {
    overview: "Places current realized volatility within its own recent history and shows whether volatility is expanding or contracting.",
    rows: [
      { term: "Volatility percentile", meaning: "Current volatility's rank versus the comparison history.", interpretation: "20th percentile or lower is Compressed; 80th or higher is Elevated; otherwise Normal." },
      { term: "Regime", meaning: "Compressed, Normal, or Elevated classification from the percentile.", interpretation: "Elevated means more risk and larger moves—not bearish direction. Compressed is calmer—not automatically bullish." },
      { term: "Volatility trend", meaning: "Whether realized volatility is expanding, stable, or contracting.", interpretation: "Expansion means risk is increasing; it does not specify whether price is rising or falling." },
      { term: "Annualized volatility", meaning: "Current daily variability scaled to one year.", interpretation: "Compare it with the asset's own history and with position risk tolerance." },
    ],
  },
};


function formatSkillNumber(value: unknown): string {
  const number = Number(value);
  return value == null || !Number.isFinite(number) ? "—" : number.toFixed(2);
}

function formatSkillPercent(value: unknown): string {
  const number = Number(value);
  return value == null || !Number.isFinite(number) ? "—" : `${(number * 100).toFixed(2)}%`;
}

function formatCandlestickTooltip(value: unknown): string {
  return Array.isArray(value) ? value.map(formatSkillNumber).join(" / ") : formatSkillNumber(value);
}

const PERCENT_METRICS = new Set([
  "annualized_volatility", "downside_volatility", "max_drawdown", "historical_var_95",
  "historical_cvar_95", "best_daily_return", "worst_daily_return",
  "volatility_regime_percentile",
  "revenue_growth", "earnings_growth", "operating_margin", "net_margin",
  "return_on_equity", "free_cash_flow_margin", "free_cash_flow_yield",
]);

function metricLabel(metric: string): string {
  const abbreviations: Record<string, string> = { adx: "ADX", ema: "EMA", rsi: "RSI", obv: "OBV", var: "VaR", cvar: "CVaR" };
  return metric.split("_").map((part) => abbreviations[part] || part).join(" ");
}

function formatMetric(metric: string, value: unknown): string {
  if (metric === "volatility_regime_code") return ["Compressed", "Normal", "Elevated"][Number(value)] || "—";
  if (metric === "volatility_trend") return ({ "-1": "Contracting", "0": "Stable", "1": "Expanding" } as Record<string, string>)[String(value)] || "—";
  return PERCENT_METRICS.has(metric) ? formatSkillPercent(value) : formatSkillNumber(value);
}

function observations(result: Json): Record<string, any> {
  return Object.fromEntries((result.observations || []).map((item: Json) => [item.metric, item.value]));
}

function SkillGuide({ skill }: { skill: string }) {
  const guide = SKILL_GUIDES[skill];
  if (!guide) return null;
  return <details className="rounded-lg border border-border/60 bg-muted/10">
    <summary className="flex cursor-pointer items-center gap-2 p-3 text-sm font-semibold"><BookOpen className="h-4 w-4 text-primary" />{tr("How to read this skill", "如何解读此技能")}</summary>
    <div className="border-t border-border/50 p-3">
      <p className="mb-3 text-xs leading-5 text-muted-foreground">{guide.overview}</p>
      <div className="overflow-x-auto rounded-lg border border-border/50"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-muted/30 text-muted-foreground"><tr><th className="p-2">{tr("Metric", "指标")}</th><th className="p-2">{tr("What it measures", "衡量内容")}</th><th className="p-2">{tr("How to interpret it", "解读方式")}</th></tr></thead><tbody>{guide.rows.map((row) => <tr key={row.term} className="border-t border-border/40 align-top"><th className="p-2 font-medium text-foreground">{row.term}</th><td className="p-2 text-muted-foreground">{row.meaning}</td><td className="p-2 text-muted-foreground">{row.interpretation}</td></tr>)}</tbody></table></div>
      <p className="mt-3 text-[11px] text-muted-foreground">{tr("Thresholds are interpretation aids, not universal rules or investment advice.", "阈值仅用于辅助解读，不是普遍规则或投资建议。")}</p>
    </div>
  </details>;
}

function WorthBuyReport({ result }: { result: Json }) {
  const values = observations(result);
  const presentation = result.presentation || {};
  const levels = presentation.reference_levels || {};
  const components = presentation.score_components || [];
  const bars = presentation.price_bars || [];
  const verdict = ({
    buy: tr("Worth further consideration", "值得进一步研究"), watch: tr("Watch for confirmation", "等待确认"), avoid: tr("Avoid new entry", "避免新建仓位"),
    reduce_risk: tr("Review existing risk", "检查现有风险"), cannot_score: tr("Insufficient data", "数据不足"),
  } as Record<string, string>)[presentation.verdict] || tr("Insufficient data", "数据不足");
  const entry = ({
    trend_broken: tr("Trend broken", "趋势已破坏"), overextended: tr("Overextended", "涨幅过度延伸"), pullback_no_trigger: tr("Pullback without trigger", "回调但无触发信号"),
    trend_continuation: tr("Trend continuation", "趋势延续"), pullback_reversal: tr("Pullback reversal", "回调反转"), recovery_reversal: tr("Recovery reversal", "修复反转"),
  } as Record<string, string>)[presentation.entry_class] || tr("Unavailable", "不可用");
  const priceOption = useMemo(() => ({
    tooltip: { trigger: "axis" }, grid: { left: 42, right: 18, top: 24, bottom: 28 },
    xAxis: { type: "category", data: bars.map((item: Json) => String(item.observed_at).slice(0, 10)), axisLabel: { color: "#94a3b8", hideOverlap: true } },
    yAxis: { scale: true, axisLabel: { color: "#94a3b8", formatter: (value: number) => formatSkillNumber(value) }, splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } } },
    series: [{ type: "candlestick", data: bars.map((item: Json) => [item.open, item.close, item.low, item.high]), tooltip: { valueFormatter: formatCandlestickTooltip }, itemStyle: { color: "#22c55e", color0: "#ef4444", borderColor: "#22c55e", borderColor0: "#ef4444" }, markLine: { symbol: "none", data: [
      levels.entry != null ? { yAxis: levels.entry, lineStyle: { color: "#60a5fa", type: "dashed" }, label: { formatter: tr("Entry", "入场") } } : null,
      levels.stop != null ? { yAxis: levels.stop, lineStyle: { color: "#f87171", type: "dotted" }, label: { formatter: tr("Stop", "止损") } } : null,
      levels.target != null ? { yAxis: levels.target, lineStyle: { color: "#34d399", type: "dashed" }, label: { formatter: tr("Target", "目标") } } : null,
    ].filter(Boolean) } }],
  }), [bars, levels.entry, levels.stop, levels.target, tr]);
  const scoreOption = useMemo(() => ({ grid: { left: 130, right: 32, top: 18, bottom: 24 }, xAxis: { type: "value", max: 100, axisLabel: { color: "#94a3b8", formatter: (value: number) => value.toFixed(2) } }, yAxis: { type: "category", data: components.map((item: Json) => item.key), axisLabel: { color: "#cbd5e1" } }, series: [{ type: "bar", data: components.map((item: Json) => item.score), tooltip: { valueFormatter: formatSkillNumber }, itemStyle: { color: "#f97316" }, label: { show: true, position: "right", color: "#cbd5e1", formatter: (item: Json) => formatSkillNumber(item.value) } }] }), [components]);
  return <div className="space-y-4">
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-lg font-semibold">{verdict}</p><p className="mt-1 text-sm text-muted-foreground">{result.summary || tr("The setup report is complete.", "分析报告已完成。")}</p><p className="mt-2 text-xs text-muted-foreground">{tr("Position context is not included in this Vibe Research run.", "本次 Vibe Research 分析不包含持仓上下文。")}</p></div>
    <div className="grid gap-3 sm:grid-cols-3"><MetricCard label={tr("Composite", "综合得分")} value={formatSkillNumber(values.worth_buy_composite)} /><MetricCard label={tr("Risk veto", "风险否决")} value={formatSkillNumber(values.worth_buy_risk_veto)} /><MetricCard label={tr("Entry setup", "入场形态")} value={entry} mono={false} /></div>
    <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]"><ChartBlock title={tr("Price structure and model reference levels", "价格结构与模型参考位")} empty={!bars.length} option={priceOption} label={tr("Price structure and reference levels", "价格结构与参考位")} emptyLabel={tr("No chart data returned.", "未返回图表数据。")} /><ChartBlock title={tr("Evidence scores and weighted contribution", "证据得分与加权贡献")} empty={!components.length} option={scoreOption} label={tr("Worth-buy evidence scores", "值得买证据得分")} emptyLabel={tr("No score components returned.", "未返回得分项。")} /></div>
    <div className="grid gap-3 sm:grid-cols-3">{[[tr("Entry reference", "入场参考"), levels.entry], [tr("Stop reference", "止损参考"), levels.stop], [tr("Target reference", "目标参考"), levels.target]].map(([label, value]) => <MetricCard key={String(label)} label={String(label)} value={formatSkillNumber(value)} />)}</div>
    <ReportTable title={tr("Risk controls", "风险控制")} rows={presentation.risk_checks} /><ReportTable title={tr("Technical confirmation", "技术确认")} rows={presentation.confirmation_checks} />
    <SkillGuide skill="worth-buy-stocks" />
    <p className="text-xs text-muted-foreground">{tr("This deterministic report uses price, volume, trend, and benchmark data. It does not calculate news risk, fundamental valuation, or AI opinion.", "此确定性报告使用价格、成交量、趋势与基准数据；不计算新闻风险、基本面估值或 AI 意见。")}</p>
  </div>;
}

function MarkovReport({ result }: { result: Json }) {
  const values = observations(result);
  const presentation = result.presentation || {};
  const regime = String(presentation.current_regime || ["Bear", "Sideways", "Bull"][Math.round(Number(values.markov_current_regime))] || "Unavailable");
  const points = presentation.regime_points || [];
  const stationary = presentation.stationary_distribution || [values.markov_stationary_bear, values.markov_stationary_sideways, values.markov_stationary_bull];
  const persistence = [values.markov_persistence_bear, values.markov_persistence_sideways, values.markov_persistence_bull];
  const matrix = presentation.transition_matrix || [[null, null, null], [null, null, null], [null, null, null]];
  const [showMatrix, setShowMatrix] = useState(true);
  const [showStationary, setShowStationary] = useState(true);
  const option = useMemo(() => {
    const dates = points.map((item: Json) => String(item.observed_at).slice(0, 10));
    const colors: Record<string, string> = { Bear: "#ef4444", Sideways: "#f59e0b", Bull: "#22c55e" };
    return { tooltip: { trigger: "axis" }, grid: [{ left: 54, right: 18, top: 20, height: "48%" }, { left: 54, right: 18, top: "56%", height: "22%" }, { left: 54, right: 18, top: "84%", height: "8%" }], xAxis: [{ type: "category", data: dates, axisLabel: { color: "#94a3b8", hideOverlap: true } }, { type: "category", gridIndex: 1, data: dates, axisLabel: { show: false } }, { type: "category", gridIndex: 2, data: dates, axisLabel: { show: false } }], yAxis: [{ scale: true, axisLabel: { color: "#94a3b8", formatter: formatSkillNumber }, splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } } }, { gridIndex: 1, axisLabel: { color: "#94a3b8", formatter: (value: number) => `${value.toFixed(2)}%` }, splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } } }, { gridIndex: 2, min: 0, max: 2, show: false }], series: [
      { name: "Close", type: "line", showSymbol: false, data: points.map((item: Json) => item.close), tooltip: { valueFormatter: (value: unknown) => formatSkillNumber(value) }, lineStyle: { color: "#60a5fa", width: 2 } },
      { name: "Rolling return", type: "line", xAxisIndex: 1, yAxisIndex: 1, showSymbol: false, data: points.map((item: Json) => Number(item.rolling_return) * 100), tooltip: { valueFormatter: (value: unknown) => `${formatSkillNumber(value)}%` }, lineStyle: { color: "#c084fc" }, markLine: { symbol: "none", data: [{ yAxis: Number(presentation.bull_threshold ?? .05) * 100, lineStyle: { color: "#22c55e", type: "dashed" }, label: { formatter: "Bull" } }, { yAxis: Number(presentation.bear_threshold ?? -.05) * 100, lineStyle: { color: "#ef4444", type: "dashed" }, label: { formatter: "Bear" } }] } },
      { name: "Regime", type: "bar", xAxisIndex: 2, yAxisIndex: 2, barWidth: "100%", data: points.map((item: Json) => ({ value: item.regime === "Bull" ? 2 : item.regime === "Bear" ? 0 : 1, itemStyle: { color: colors[item.regime] || "#64748b" } })) },
    ] };
  }, [points, presentation.bull_threshold, presentation.bear_threshold]);
  const stationaryOption = useMemo(() => barOption(["Bear", "Sideways", "Bull"], stationary, 1, true, ["#ef4444", "#f59e0b", "#22c55e"]), [stationary]);
  const persistenceOption = useMemo(() => barOption(["Bear persistence", "Sideways persistence", "Bull persistence"], persistence, 1, true), [persistence]);
  const regimeLabel = regime;
  return <div className="space-y-4">
    <div className={`rounded-xl border p-4 ${regime === "Bull" ? "border-success/30 bg-success/5" : regime === "Bear" ? "border-danger/30 bg-danger/5" : "border-warning/30 bg-warning/5"}`}><p className="text-lg font-semibold">{tr("Current regime: ", "当前状态：")}{regimeLabel}</p><p className="mt-1 text-sm text-muted-foreground">{result.summary || tr("Markov regime report completed.", "Markov 状态报告已完成。")}</p><p className="mt-2 text-xs text-muted-foreground">{tr("Window", "窗口")} {presentation.window ?? 20}d · {tr("Bull", "多头")} ≥ {formatSkillPercent(presentation.bull_threshold ?? .05)} · {tr("Bear", "空头")} ≤ {formatSkillPercent(presentation.bear_threshold ?? -.05)}</p></div>
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground"><label className="inline-flex items-center gap-2"><input type="checkbox" checked={showMatrix} onChange={(event) => setShowMatrix(event.target.checked)} />{tr("Transition matrix", "转移矩阵")}</label><label className="inline-flex items-center gap-2"><input type="checkbox" checked={showStationary} onChange={(event) => setShowStationary(event.target.checked)} />{tr("Stationary table", "稳态表")}</label></div>
    {points.length > 0 && <div className="relative rounded-lg border border-border/50 p-2"><EChart option={option} label={tr("Markov price, rolling return, and regime ribbon", "Markov 价格、滚动收益与状态带")} className="h-[470px]" />{showMatrix && <div className="absolute right-3 top-3 rounded-lg border border-border/70 bg-background/90 p-2 text-[10px] shadow-lg"><p className="mb-1 font-semibold">{tr("Transition matrix", "转移矩阵")}</p><table><thead><tr><th className="px-1 text-left">{tr("From / To", "从 / 到")}</th>{[tr("Bear", "空头"), tr("Side", "震荡"), tr("Bull", "多头")].map((name) => <th key={name} className="px-1">{name}</th>)}</tr></thead><tbody>{[tr("Bear", "空头"), tr("Side", "震荡"), tr("Bull", "多头")].map((name, row) => <tr key={name}><th className="px-1 text-left">{name}</th>{(matrix[row] || []).map((value: number | null, col: number) => <td key={col} className="px-1 text-right font-mono">{formatSkillPercent(value)}</td>)}</tr>)}</tbody></table></div>}</div>}
    {showStationary && <div className="overflow-x-auto rounded-lg border border-border/60"><table className="w-full text-left text-xs"><thead className="bg-muted/30 text-muted-foreground"><tr><th className="p-2">{tr("Stationary distribution", "稳态分布")}</th><th className="p-2">{tr("Probability", "概率")}</th><th className="p-2">{tr("Persistence", "持续性")}</th></tr></thead><tbody>{["Bear", "Sideways", "Bull"].map((name, index) => <tr key={name} className="border-t border-border/40"><td className="p-2">{name}</td><td className="p-2 font-mono">{formatSkillPercent(stationary[index])}</td><td className="p-2 font-mono">{formatSkillPercent(persistence[index])}</td></tr>)}</tbody></table></div>}
    <div className="grid gap-3 sm:grid-cols-3"><MetricCard label={tr("Directional signal", "方向信号")} value={formatSkillNumber(values.markov_signal)} /><MetricCard label={tr("Observed points", "观测点数")} value={String(points.length || "—")} mono={false} /><MetricCard label={tr("Data quality", "数据质量")} value={result.status || tr("Unknown", "未知")} mono={false} /></div>
    {!points.length && <div className="grid gap-4 lg:grid-cols-2"><ChartBlock title={tr("Stationary probabilities", "稳态概率")} option={stationaryOption} label={tr("Markov stationary probabilities", "Markov 稳态概率")} /><ChartBlock title={tr("Persistence", "持续性")} option={persistenceOption} label={tr("Markov regime persistence", "Markov 状态持续性")} /></div>}
    <SkillGuide skill="markov-method" />
  </div>;
}

function barOption(labels: string[], values: unknown[], max?: number, percent = false, colors?: string[]): Json {
  return { tooltip: { trigger: "axis" }, grid: { left: 145, right: 42, top: 18, bottom: 28 }, xAxis: { type: "value", max, axisLabel: { color: "#94a3b8", formatter: (value: number) => percent ? `${(value * 100).toFixed(2)}%` : value.toFixed(2) }, splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } } }, yAxis: { type: "category", data: labels, axisLabel: { color: "#cbd5e1" } }, series: [{ type: "bar", data: values, itemStyle: { color: (p: Json) => colors?.[p.dataIndex] || "#f97316" }, label: { show: true, position: "right", color: "#cbd5e1", formatter: (p: Json) => percent ? formatSkillPercent(p.value) : formatSkillNumber(p.value) } }] };
}

function PriceSeriesVisual({ result, values }: { result: Json; values: Record<string, any> }) {
  if (result.analyst === "technical-basic") {
    const option = barOption(["Composite score", "RSI 14", "ADX 14"], [values.technical_basic_score, values.relative_strength_index_14, Math.min(100, Number(values.adx_14))], 100, false, ["#f97316", "#8b5cf6", "#60a5fa"]);
    return <div><h4 className="mb-1 text-sm font-semibold">{tr("Normalized technical indicators", "标准化技术指标")}</h4><p className="mb-2 text-xs text-muted-foreground">{tr("A shared 0–100 view for comparison. RSI shows momentum; ADX shows trend strength, not direction.", "使用统一的 0–100 刻度进行比较。RSI 表示动量；ADX 表示趋势强度而非方向。")}</p><EChart option={option} label={tr("Normalized technical indicators", "标准化技术指标")} /></div>;
  }
  if (result.analyst === "risk-analysis") {
    const labels = ["Annualized volatility", "Downside volatility", "Max drawdown", "VaR 95", "CVaR 95"];
    const data = [values.annualized_volatility, values.downside_volatility, Math.abs(Number(values.max_drawdown)), values.historical_var_95, values.historical_cvar_95].map((value) => Number(value) * 100);
    const option = barOption(labels, data, undefined, false, ["#f59e0b", "#f97316", "#ef4444", "#fb7185", "#e11d48"]);
    option.xAxis.axisLabel.formatter = (value: number) => `${value.toFixed(2)}%`;
    option.series[0].label.formatter = (p: Json) => `${formatSkillNumber(p.value)}%`;
    return <div><h4 className="mb-1 text-sm font-semibold">{tr("Risk magnitude comparison", "风险幅度比较")}</h4><p className="mb-2 text-xs text-muted-foreground">{tr("Absolute percentages for visual comparison; larger bars indicate more realized risk, not bearish direction.", "使用绝对百分比进行可视化比较；柱形越大表示已实现风险越高，并不代表看空。")}</p><EChart option={option} label={tr("Risk magnitude comparison", "风险幅度比较")} /></div>;
  }
  if (result.analyst === "volatility-regime") {
    const percentile = Math.max(0, Math.min(100, Number(values.volatility_regime_percentile) * 100));
    const option = { series: [{ type: "gauge", min: 0, max: 100, startAngle: 200, endAngle: -20, progress: { show: true, width: 14 }, axisLine: { lineStyle: { width: 14, color: [[.2, "#22c55e"], [.8, "#f59e0b"], [1, "#ef4444"]] } }, axisTick: { show: false }, splitLine: { distance: -18, length: 6, lineStyle: { color: "#94a3b8" } }, axisLabel: { color: "#94a3b8", distance: 22, formatter: (value: number) => value === 20 ? "Compressed" : value === 80 ? "Elevated" : "" }, pointer: { length: "62%", width: 4 }, detail: { valueAnimation: false, formatter: (value: number) => `${value.toFixed(2)}%`, color: "#cbd5e1", offsetCenter: [0, "55%"] }, title: { show: false }, data: [{ value: percentile }] }] };
    return <div><h4 className="mb-1 text-sm font-semibold">{tr("Volatility percentile", "波动率分位")}</h4><p className="mb-2 text-xs text-muted-foreground">{tr("Low is compressed, high is elevated. This measures movement intensity, not price direction.", "低位表示波动压缩，高位表示波动升高；衡量的是运动强度而非价格方向。")}</p><EChart option={option} label={tr("Volatility percentile", "波动率分位")} className="h-72" /></div>;
  }
  return null;
}

function PriceSeriesReport({ result }: { result: Json }) {
  const items = result.observations || [];
  const values = observations(result);
  const signal = String(result.signal || "not_assessed").split("_").join(" ");
  return <div className="space-y-4">
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-lg font-semibold capitalize">{result.analyst?.split("-").join(" ")}</p><p className="mt-1 text-sm text-muted-foreground">{result.summary}</p><p className="mt-2 text-xs text-muted-foreground">{tr("Signal", "信号")}: <span className="capitalize text-foreground">{signal}</span> · {tr("Daily price-series analysis", "日线价格序列分析")}</p></div>
    <PriceSeriesVisual result={result} values={values} />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((item: Json) => <MetricCard key={item.metric} label={metricLabel(item.metric)} value={formatMetric(item.metric, item.value)} />)}</div>
    {!items.length && <p className="text-sm text-muted-foreground">{tr("The skill did not return enough data to calculate metrics.", "数据不足，技能未返回可计算指标。")}</p>}
    <SkillGuide skill={result.analyst} />
    <p className="text-xs text-muted-foreground">{tr("Price-derived statistics are descriptive research signals, not forecasts or trade instructions.", "价格衍生统计是描述性研究信号，不是预测或交易指令。")}</p>
  </div>;
}

function ProviderEvidenceReport({ result }: { result: Json }) {
  const items = result.observations || [];
  const sourceLabel = result.analyst === "fundamental" ? "SEC Company Facts analysis" : "SEC filing-history analysis";
  return <div className="space-y-4">
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-lg font-semibold capitalize">{result.analyst?.split("-").join(" ")}</p><p className="mt-1 text-sm text-muted-foreground">{result.summary}</p><p className="mt-2 text-xs text-muted-foreground">{sourceLabel} · Data quality: <span className="capitalize text-foreground">{result.status || "unknown"}</span></p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((item: Json) => <MetricCard key={item.metric} label={metricLabel(item.metric)} value={formatMetric(item.metric, item.value)} />)}</div>
    {!items.length && <p className="text-sm text-muted-foreground">The provider did not return enough compatible observations to calculate factors.</p>}
    <SkillGuide skill={result.analyst} />
    <p className="text-xs text-muted-foreground">These metrics are descriptive, point-in-time research evidence. Review the cited SEC filing before drawing a conclusion.</p>
  </div>;
}

function SkillReport({ result }: { result: Json }) {
  if (result.analyst === "worth-buy-stocks") return <WorthBuyReport result={result} />;
  if (result.analyst === "markov-method") return <MarkovReport result={result} />;
  if (result.analyst === "fundamental" || result.analyst === "filings") return <ProviderEvidenceReport result={result} />;
  return <PriceSeriesReport result={result} />;
}

function MetricCard({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return <div className="rounded-lg border border-border/60 p-3"><p className="text-xs capitalize text-muted-foreground">{label}</p><p className={`mt-1 text-lg font-semibold ${mono ? "font-mono" : "text-sm"}`}>{value}</p></div>;
}

function ChartBlock({ title, option, label, empty = false, emptyLabel = "No chart data returned." }: { title: string; option: Json; label: string; empty?: boolean; emptyLabel?: string }) {
  return <div><h4 className="mb-2 text-sm font-semibold">{title}</h4>{empty ? <p className="text-sm text-muted-foreground">{emptyLabel}</p> : <EChart option={option} label={label} />}</div>;
}

function ReportTable({ title, rows }: { title: string; rows?: Json[] }) {
  return <section><h4 className="mb-2 text-sm font-semibold">{title}</h4><div className="overflow-x-auto rounded-lg border border-border/60"><table className="w-full text-left text-xs"><thead className="bg-muted/30 text-muted-foreground"><tr><th className="p-2">{tr("Check", "检查项")}</th><th className="p-2">{tr("Status", "状态")}</th><th className="p-2">{tr("Value", "数值")}</th></tr></thead><tbody>{(rows || []).map((row) => <tr key={row.key} className="border-t border-border/40"><td className="p-2">{row.key}</td><td className="p-2">{row.status}</td><td className="p-2 font-mono">{formatSkillNumber(row.value)}</td></tr>)}</tbody></table></div></section>;
}

export function SkillAnalysisPanel({ symbol, supported, assetType = "equity", capabilities }: { symbol: string | null; supported: boolean; assetType?: "equity" | "crypto"; capabilities?: string[] }) {
  const [skills, setSkills] = useState<ResearchSkill[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [parameters, setParameters] = useState<Record<string, Record<string, unknown>>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [run, setRun] = useState<ResearchRunResponse | null>(null);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol || !supported) return;
    api.researchSkills().then((payload) => {
      const nextSkills = (payload.skills || []).filter((skill) => {
        if (skill.scope === "portfolio" || (skill.supported_asset_types && !skill.supported_asset_types.includes(assetType))) return false;
        if (capabilities && skill.name === "fundamental") return capabilities.includes("fundamentals") || capabilities.includes("sec-facts");
        if (capabilities && skill.name === "filings") return capabilities.includes("filings");
        return true;
      });
      setSkills(nextSkills);
      setSelected((current) => current.filter((name) => nextSkills.some((skill) => skill.name === name && skill.available !== false)));
      setStatus(payload.status === "available" ? null : payload.detail || tr("TradeAgent is not configured", "TradeAgent 尚未配置"));
    }).catch((error: unknown) => setStatus(error instanceof ApiError ? error.message : tr("Research skills unavailable", "研究技能不可用")));
  }, [symbol, supported, assetType, capabilities, tr]);

  if (!symbol || !supported) return null;
  const toggleSkill = (skill: ResearchSkill) => {
    setSelected((current) => current.includes(skill.name) ? current.filter((name) => name !== skill.name) : [...current, skill.name]);
    if (!parameters[skill.name]) {
      const defaults: Record<string, unknown> = {};
      for (const [name, prop] of Object.entries(skill.parameters?.properties || {})) if (prop.default !== undefined) defaults[name] = prop.default;
      setParameters((current) => ({ ...current, [skill.name]: defaults }));
    }
  };
  const runSelected = async () => {
    if (!selected.length || !symbol) return;
    setLoading(true); setStatus(null); setRun(null); setActive(0);
    try { setRun(await api.runResearch(symbol, selected, parameters, assetType)); }
    catch (error: unknown) { setStatus(error instanceof ApiError ? error.message : tr("Research failed", "研究失败")); }
    finally { setLoading(false); }
  };
  const current = run?.results[active];
  const currentReport = ((current?.report as any)?.results?.[0] || undefined) as Json | undefined;
  return <GlassCard className="mb-5" glow>
    <div className="mb-4 flex flex-wrap items-center gap-2"><div><h2 className="flex items-center gap-2 text-lg font-bold"><BarChart3 className="h-5 w-5 text-primary" /> {tr("Skills analysis", "技能分析")}</h2><p className="text-xs text-muted-foreground">{tr(`Read-only deterministic research for ${symbol}. Position context is not queried.`, `对 ${symbol} 运行只读的确定性研究，不查询持仓上下文。`)}</p></div><button onClick={runSelected} disabled={loading || !selected.length} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/25 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {tr("Run analysis", "运行分析")}</button></div>
    {status && <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning"><AlertCircle className="h-4 w-4" />{status}</div>}
    {skills.length > 0 && <div className="grid gap-3 md:grid-cols-2">{skills.map((skill) => <div key={skill.name} className={`rounded-lg border border-border/60 p-3 ${skill.available === false ? "opacity-60" : ""}`}><label className={`flex items-center gap-2 text-sm font-medium ${skill.available === false ? "cursor-not-allowed" : "cursor-pointer"}`}><input type="checkbox" checked={selected.includes(skill.name)} disabled={skill.available === false} onChange={() => toggleSkill(skill)} />{skill.name}</label><p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>{skill.available === false && <p className="mt-1 text-[11px] text-warning">Provider required: {(skill.missing_capabilities || []).join(", ") || "not configured"}</p>}{selected.includes(skill.name) && Object.entries(skill.parameters?.properties || {}).filter(([name]) => name !== "threshold").map(([name, prop]) => { const percentInput = skill.name === "markov-method" && name.endsWith("threshold"); const rawValue = parameters[skill.name]?.[name]; return <label key={name} className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{name === "bull_threshold" ? tr("Bull threshold (%)", "多头阈值（%）") : name === "bear_threshold" ? tr("Bear threshold (%)", "空头阈值（%）") : name}</span>{prop.type === "boolean" ? <input type="checkbox" checked={Boolean(rawValue)} onChange={(event) => setParameters((current) => ({ ...current, [skill.name]: { ...current[skill.name], [name]: event.target.checked } }))} /> : <input type={prop.type === "integer" || prop.type === "number" ? "number" : "text"} step={percentInput ? ".1" : prop.type === "number" ? ".01" : "1"} min={percentInput && prop.minimum != null ? prop.minimum * 100 : prop.minimum} max={percentInput && prop.maximum != null ? prop.maximum * 100 : prop.maximum} value={String(percentInput && rawValue != null ? Number(rawValue) * 100 : rawValue ?? "")} onChange={(event) => setParameters((current) => ({ ...current, [skill.name]: { ...current[skill.name], [name]: percentInput ? Number.parseFloat(event.target.value) / 100 : prop.type === "integer" ? Number.parseInt(event.target.value, 10) : prop.type === "number" ? Number.parseFloat(event.target.value) : event.target.value } }))} className="w-36 rounded border border-border bg-background px-2 py-1 font-mono text-foreground" />}</label>; })}</div>)}</div>}
    {run && <div className="mt-5 border-t border-border/50 pt-4"><div className="mb-3 flex flex-wrap gap-2">{run.results.map((item, index) => <button key={item.skill} onClick={() => setActive(index)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${index === active ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground"}`}>{item.skill}</button>)}</div>{current?.status === "failed" && <p className="text-sm text-danger">{current.detail || tr("Skill failed.", "技能运行失败。")}</p>}{currentReport && <SkillReport result={currentReport} />}<details className="mt-4"><summary className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground"><SlidersHorizontal className="h-3.5 w-3.5" /> {tr("Raw JSON", "原始 JSON")}</summary><pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-black/20 p-3 text-[10px]">{JSON.stringify(current?.report || {}, null, 2)}</pre></details></div>}
  </GlassCard>;
}
