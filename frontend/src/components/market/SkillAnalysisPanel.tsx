import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { AlertCircle, BarChart3, BookOpen, Loader2, Play, SlidersHorizontal } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { ApiError, api, type ResearchRunResponse, type ResearchSkill } from "@/lib/api";
import { useLocale, type Locale } from "@/lib/i18n";

type Json = Record<string, any>;
type Guide = { overview: string; rows: Array<{ term: string; meaning: string; interpretation: string }> };

const SKILL_GUIDES: Record<string, Guide> = {
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

const SKILL_GUIDES_ZH: Record<string, Guide> = {
  "worth-buy-stocks": {
    overview: "基于规则检查趋势与相对强度。机会得分越高越积极，但较高的风险否决分可覆盖机会信号。",
    rows: [
      { term: "综合得分", meaning: "将趋势、动量、相对强度和成交量证据加权为 0–100 分。", interpretation: "越高越强；70 分以上通过机会阈值，50–69 分为观察区，低于 50 分偏弱。" },
      { term: "风险否决", meaning: "对趋势破坏、过度延伸或不利风险状态进行扣分。", interpretation: "越低越好；低于 30 为低风险，30–49 为升高，50 以上会阻止新入场结论。" },
      { term: "入场形态", meaning: "识别趋势延续、回调或修复附近的价格结构。", interpretation: "建设性标签支持得分，趋势破坏或过度延伸提示谨慎；它们不是交易指令。" },
      { term: "入场 / 止损 / 目标", meaning: "由近期价格结构计算的模型参考位。", interpretation: "仅作情景标记；未考虑仓位、流动性、新闻或个人风险限制。" },
      { term: "证据组成", meaning: "构成综合得分的各个 0–100 分输入。", interpretation: "多个组成项方向一致通常比单一异常高分更稳健。" },
    ],
  },
  "markov-method": {
    overview: "把近期收益划分为多头、震荡和空头状态，并描述这些历史状态之间的转移。",
    rows: [
      { term: "当前状态", meaning: "根据滚动收益和设定阈值划分的状态。", interpretation: "多头表示样本窗口内方向向上，空头向下，震荡为中性；不是预测。" },
      { term: "方向信号", meaning: "根据当前状态概率计算的带符号汇总值。", interpretation: "正值偏多，负值偏空，接近零为中性。" },
      { term: "转移矩阵", meaning: "每一行表示从当前状态转向下一状态的历史概率。", interpretation: "按行读取；对角线越高表示该状态历史上越持续。" },
      { term: "稳态分布", meaning: "若历史转移持续，模型长期处于各状态的比例。", interpretation: "多头权重高较积极，空头权重高提示谨慎；它是模型属性，不是目标价。" },
      { term: "持续性", meaning: "下一次观察仍保持同一状态的概率。", interpretation: "数值越高表示状态越黏，无论当前是多头还是空头。" },
    ],
  },
  "technical-basic": {
    overview: "基于日线组合常见趋势、动量、波动带和成交量指标。",
    rows: [
      { term: "技术综合得分", meaning: "0–100 的综合技术得分。", interpretation: "本技能将 70 以上归为偏多，40–69 为中性，低于 40 为偏空。" },
      { term: "EMA 12 / EMA 26", meaning: "快速和慢速指数移动平均线。", interpretation: "EMA 12 高于 EMA 26 表示趋势排列偏多，反之偏空。" },
      { term: "RSI 14", meaning: "范围为 0–100 的动量振荡指标。", interpretation: "通常高于 70 为超买，低于 30 为超卖；极值不保证反转。" },
      { term: "ADX 14", meaning: "从 0 向上的趋势强度指标，不表示方向。", interpretation: "约 25 以上通常表示趋势较明显，方向仍需由价格或均线判断。" },
      { term: "布林带", meaning: "20 日均线及其上下波动带。", interpretation: "靠近带边表示相对延伸；触及带边本身不代表多空。" },
      { term: "OBV 趋势 / 成交量比", meaning: "能量潮方向及当前成交量相对 20 日均量。", interpretation: "OBV 为正较积极；成交量比高于 1 表示参与度高于平均。" },
    ],
  },
  "risk-analysis": {
    overview: "描述已实现收益风险和尾部形态。大多数指标衡量风险幅度，而不是价格方向。",
    rows: [
      { term: "年化波动率", meaning: "将日收益波动缩放至一年。", interpretation: "越低通常表示价格路径更平稳，越高表示潜在波动更大。" },
      { term: "下行波动率", meaning: "仅统计负收益的波动。", interpretation: "从损失风险角度看通常越低越好。" },
      { term: "最大回撤", meaning: "样本内从峰值到谷值的最大跌幅。", interpretation: "越接近 0% 越好；越负表示历史损失越深。" },
      { term: "历史 VaR 95", meaning: "历史上约 5% 交易日会超过的损失阈值。", interpretation: "损失幅度越低越好；它不是最坏情况上限。" },
      { term: "历史 CVaR 95", meaning: "超过 95% VaR 阈值后的平均损失。", interpretation: "越低越好，专注于 VaR 以外的尾部。" },
      { term: "偏度 / 超额峰度", meaning: "收益分布的不对称性和尾部厚度。", interpretation: "负偏度表示下行不对称更强；正超额峰度表示极端结果更多。" },
      { term: "最佳 / 最差单日收益", meaning: "样本中最大的单日上涨和下跌。", interpretation: "用于理解历史极值，不代表未来可能范围。" },
    ],
  },
  "volatility-regime": {
    overview: "把当前已实现波动率放到自身近期历史中比较，并判断波动正在扩张还是收缩。",
    rows: [
      { term: "波动率分位", meaning: "当前波动率相对比较期历史的排名。", interpretation: "20 分位及以下为压缩，80 分位及以上为高位，其余为正常。" },
      { term: "波动状态", meaning: "根据分位划分为压缩、正常或高位。", interpretation: "高位表示风险和振幅更大，并不代表看空；压缩也不自动代表看多。" },
      { term: "波动趋势", meaning: "已实现波动率处于扩张、稳定或收缩。", interpretation: "扩张表示风险增加，但不说明价格上涨或下跌。" },
      { term: "年化波动率", meaning: "将当前日度波动缩放至一年。", interpretation: "应与资产自身历史和仓位风险承受能力比较。" },
    ],
  },
};

const SKILL_DESCRIPTION_ZH: Record<string, string> = {
  "worth-buy-stocks": "趋势、相对强度与风险检查。",
  "markov-method": "识别多头、空头与震荡状态。",
  "technical-basic": "EMA、ADX、RSI、布林带、OBV 与成交量确认。",
  "risk-analysis": "历史波动、尾部损失、回撤与收益分布。",
  "volatility-regime": "已实现波动率分位与扩张状态。",
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
]);

const METRIC_LABEL_ZH: Record<string, string> = {
  technical_basic_score: "技术综合得分", exponential_moving_average_12: "EMA 12", exponential_moving_average_26: "EMA 26",
  relative_strength_index_14: "RSI 14", adx_14: "ADX 14", bollinger_upper_20: "布林带上轨 20",
  bollinger_middle_20: "布林带中轨 20", bollinger_lower_20: "布林带下轨 20", on_balance_volume_trend_20: "OBV 趋势 20",
  volume_ratio_20: "成交量比 20", annualized_volatility: "年化波动率", downside_volatility: "下行波动率",
  max_drawdown: "最大回撤", historical_var_95: "历史 VaR 95", historical_cvar_95: "历史 CVaR 95",
  skewness: "偏度", excess_kurtosis: "超额峰度", best_daily_return: "最佳单日收益", worst_daily_return: "最差单日收益",
  volatility_regime_percentile: "波动率分位", volatility_regime_code: "波动状态", volatility_trend: "波动趋势",
};

function metricLabel(metric: string, locale: Locale = "en"): string {
  if (locale === "zh-CN" && METRIC_LABEL_ZH[metric]) return METRIC_LABEL_ZH[metric];
  const abbreviations: Record<string, string> = { adx: "ADX", ema: "EMA", rsi: "RSI", obv: "OBV", var: "VaR", cvar: "CVaR" };
  return metric.split("_").map((part) => abbreviations[part] || part).join(" ");
}

function formatMetric(metric: string, value: unknown, locale: Locale = "en"): string {
  if (metric === "volatility_regime_code") return (locale === "zh-CN" ? ["压缩", "正常", "高位"] : ["Compressed", "Normal", "Elevated"])[Number(value)] || "—";
  if (metric === "volatility_trend") return (locale === "zh-CN" ? { "-1": "收缩", "0": "稳定", "1": "扩张" } : { "-1": "Contracting", "0": "Stable", "1": "Expanding" })[String(value)] || "—";
  return PERCENT_METRICS.has(metric) ? formatSkillPercent(value) : formatSkillNumber(value);
}

function EChart({ option, label, className = "h-64" }: { option: Json; label: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const chart = echarts.init(host.current);
    chart.setOption({ animation: false, backgroundColor: "transparent", ...option });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); chart.dispose(); };
  }, [option]);
  return <div ref={host} className={`${className} w-full`} role="img" aria-label={label} />;
}

function observations(result: Json): Record<string, any> {
  return Object.fromEntries((result.observations || []).map((item: Json) => [item.metric, item.value]));
}

function SkillGuide({ skill }: { skill: string }) {
  const { locale, tr } = useLocale();
  const guide = (locale === "zh-CN" ? SKILL_GUIDES_ZH : SKILL_GUIDES)[skill];
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
  const { tr } = useLocale();
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
  const { locale, tr } = useLocale();
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
  const regimeLabel = locale === "zh-CN" ? ({ Bull: "多头", Bear: "空头", Sideways: "震荡", Unavailable: "不可用" } as Record<string, string>)[regime] || regime : regime;
  return <div className="space-y-4">
    <div className={`rounded-xl border p-4 ${regime === "Bull" ? "border-success/30 bg-success/5" : regime === "Bear" ? "border-danger/30 bg-danger/5" : "border-warning/30 bg-warning/5"}`}><p className="text-lg font-semibold">{tr("Current regime: ", "当前状态：")}{regimeLabel}</p><p className="mt-1 text-sm text-muted-foreground">{result.summary || tr("Markov regime report completed.", "Markov 状态报告已完成。")}</p><p className="mt-2 text-xs text-muted-foreground">{tr("Window", "窗口")} {presentation.window ?? 20}d · {tr("Bull", "多头")} ≥ {formatSkillPercent(presentation.bull_threshold ?? .05)} · {tr("Bear", "空头")} ≤ {formatSkillPercent(presentation.bear_threshold ?? -.05)}</p></div>
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground"><label className="inline-flex items-center gap-2"><input type="checkbox" checked={showMatrix} onChange={(event) => setShowMatrix(event.target.checked)} />{tr("Transition matrix", "转移矩阵")}</label><label className="inline-flex items-center gap-2"><input type="checkbox" checked={showStationary} onChange={(event) => setShowStationary(event.target.checked)} />{tr("Stationary table", "稳态表")}</label></div>
    {points.length > 0 && <div className="relative rounded-lg border border-border/50 p-2"><EChart option={option} label={tr("Markov price, rolling return, and regime ribbon", "Markov 价格、滚动收益与状态带")} className="h-[470px]" />{showMatrix && <div className="absolute right-3 top-3 rounded-lg border border-border/70 bg-background/90 p-2 text-[10px] shadow-lg"><p className="mb-1 font-semibold">{tr("Transition matrix", "转移矩阵")}</p><table><thead><tr><th className="px-1 text-left">{tr("From / To", "从 / 到")}</th>{[tr("Bear", "空头"), tr("Side", "震荡"), tr("Bull", "多头")].map((name) => <th key={name} className="px-1">{name}</th>)}</tr></thead><tbody>{[tr("Bear", "空头"), tr("Side", "震荡"), tr("Bull", "多头")].map((name, row) => <tr key={name}><th className="px-1 text-left">{name}</th>{(matrix[row] || []).map((value: number | null, col: number) => <td key={col} className="px-1 text-right font-mono">{formatSkillPercent(value)}</td>)}</tr>)}</tbody></table></div>}</div>}
    {showStationary && <div className="overflow-x-auto rounded-lg border border-border/60"><table className="w-full text-left text-xs"><thead className="bg-muted/30 text-muted-foreground"><tr><th className="p-2">{tr("Stationary distribution", "稳态分布")}</th><th className="p-2">{tr("Probability", "概率")}</th><th className="p-2">{tr("Persistence", "持续性")}</th></tr></thead><tbody>{["Bear", "Sideways", "Bull"].map((name, index) => <tr key={name} className="border-t border-border/40"><td className="p-2">{locale === "zh-CN" ? ({ Bear: "空头", Sideways: "震荡", Bull: "多头" } as Record<string, string>)[name] : name}</td><td className="p-2 font-mono">{formatSkillPercent(stationary[index])}</td><td className="p-2 font-mono">{formatSkillPercent(persistence[index])}</td></tr>)}</tbody></table></div>}
    <div className="grid gap-3 sm:grid-cols-3"><MetricCard label={tr("Directional signal", "方向信号")} value={formatSkillNumber(values.markov_signal)} /><MetricCard label={tr("Observed points", "观测点数")} value={String(points.length || "—")} mono={false} /><MetricCard label={tr("Data quality", "数据质量")} value={result.status || tr("Unknown", "未知")} mono={false} /></div>
    {!points.length && <div className="grid gap-4 lg:grid-cols-2"><ChartBlock title={tr("Stationary probabilities", "稳态概率")} option={stationaryOption} label={tr("Markov stationary probabilities", "Markov 稳态概率")} /><ChartBlock title={tr("Persistence", "持续性")} option={persistenceOption} label={tr("Markov regime persistence", "Markov 状态持续性")} /></div>}
    <SkillGuide skill="markov-method" />
  </div>;
}

function barOption(labels: string[], values: unknown[], max?: number, percent = false, colors?: string[]): Json {
  return { tooltip: { trigger: "axis" }, grid: { left: 145, right: 42, top: 18, bottom: 28 }, xAxis: { type: "value", max, axisLabel: { color: "#94a3b8", formatter: (value: number) => percent ? `${(value * 100).toFixed(2)}%` : value.toFixed(2) }, splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } } }, yAxis: { type: "category", data: labels, axisLabel: { color: "#cbd5e1" } }, series: [{ type: "bar", data: values, itemStyle: { color: (p: Json) => colors?.[p.dataIndex] || "#f97316" }, label: { show: true, position: "right", color: "#cbd5e1", formatter: (p: Json) => percent ? formatSkillPercent(p.value) : formatSkillNumber(p.value) } }] };
}

function PriceSeriesVisual({ result, values }: { result: Json; values: Record<string, any> }) {
  const { tr } = useLocale();
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
  const { locale, tr } = useLocale();
  const items = result.observations || [];
  const values = observations(result);
  const signal = String(result.signal || "not_assessed").split("_").join(" ");
  return <div className="space-y-4">
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-lg font-semibold capitalize">{result.analyst?.split("-").join(" ")}</p><p className="mt-1 text-sm text-muted-foreground">{result.summary}</p><p className="mt-2 text-xs text-muted-foreground">{tr("Signal", "信号")}: <span className="capitalize text-foreground">{signal}</span> · {tr("Daily price-series analysis", "日线价格序列分析")}</p></div>
    <PriceSeriesVisual result={result} values={values} />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((item: Json) => <MetricCard key={item.metric} label={metricLabel(item.metric, locale)} value={formatMetric(item.metric, item.value, locale)} />)}</div>
    {!items.length && <p className="text-sm text-muted-foreground">{tr("The skill did not return enough data to calculate metrics.", "数据不足，技能未返回可计算指标。")}</p>}
    <SkillGuide skill={result.analyst} />
    <p className="text-xs text-muted-foreground">{tr("Price-derived statistics are descriptive research signals, not forecasts or trade instructions.", "价格衍生统计是描述性研究信号，不是预测或交易指令。")}</p>
  </div>;
}

function SkillReport({ result }: { result: Json }) {
  if (result.analyst === "worth-buy-stocks") return <WorthBuyReport result={result} />;
  if (result.analyst === "markov-method") return <MarkovReport result={result} />;
  return <PriceSeriesReport result={result} />;
}

function MetricCard({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return <div className="rounded-lg border border-border/60 p-3"><p className="text-xs capitalize text-muted-foreground">{label}</p><p className={`mt-1 text-lg font-semibold ${mono ? "font-mono" : "text-sm"}`}>{value}</p></div>;
}

function ChartBlock({ title, option, label, empty = false, emptyLabel = "No chart data returned." }: { title: string; option: Json; label: string; empty?: boolean; emptyLabel?: string }) {
  return <div><h4 className="mb-2 text-sm font-semibold">{title}</h4>{empty ? <p className="text-sm text-muted-foreground">{emptyLabel}</p> : <EChart option={option} label={label} />}</div>;
}

function ReportTable({ title, rows }: { title: string; rows?: Json[] }) {
  const { tr } = useLocale();
  return <section><h4 className="mb-2 text-sm font-semibold">{title}</h4><div className="overflow-x-auto rounded-lg border border-border/60"><table className="w-full text-left text-xs"><thead className="bg-muted/30 text-muted-foreground"><tr><th className="p-2">{tr("Check", "检查项")}</th><th className="p-2">{tr("Status", "状态")}</th><th className="p-2">{tr("Value", "数值")}</th></tr></thead><tbody>{(rows || []).map((row) => <tr key={row.key} className="border-t border-border/40"><td className="p-2">{row.key}</td><td className="p-2">{row.status}</td><td className="p-2 font-mono">{formatSkillNumber(row.value)}</td></tr>)}</tbody></table></div></section>;
}

export function SkillAnalysisPanel({ symbol, supported, assetType = "equity" }: { symbol: string | null; supported: boolean; assetType?: "equity" | "crypto" }) {
  const { locale, tr } = useLocale();
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
      setSkills((payload.skills || []).filter((skill) => !skill.supported_asset_types || skill.supported_asset_types.includes(assetType)));
      setStatus(payload.status === "available" ? null : payload.detail || tr("TradeAgent is not configured", "TradeAgent 尚未配置"));
    }).catch((error: unknown) => setStatus(error instanceof ApiError ? error.message : tr("Research skills unavailable", "研究技能不可用")));
  }, [symbol, supported, assetType, tr]);

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
    {skills.length > 0 && <div className="grid gap-3 md:grid-cols-2">{skills.map((skill) => <div key={skill.name} className="rounded-lg border border-border/60 p-3"><label className="flex cursor-pointer items-center gap-2 text-sm font-medium"><input type="checkbox" checked={selected.includes(skill.name)} onChange={() => toggleSkill(skill)} />{skill.name}</label><p className="mt-1 text-xs text-muted-foreground">{locale === "zh-CN" ? SKILL_DESCRIPTION_ZH[skill.name] || skill.description : skill.description}</p>{selected.includes(skill.name) && Object.entries(skill.parameters?.properties || {}).filter(([name]) => name !== "threshold").map(([name, prop]) => { const percentInput = skill.name === "markov-method" && name.endsWith("threshold"); const rawValue = parameters[skill.name]?.[name]; return <label key={name} className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{name === "bull_threshold" ? tr("Bull threshold (%)", "多头阈值（%）") : name === "bear_threshold" ? tr("Bear threshold (%)", "空头阈值（%）") : name}</span>{prop.type === "boolean" ? <input type="checkbox" checked={Boolean(rawValue)} onChange={(event) => setParameters((current) => ({ ...current, [skill.name]: { ...current[skill.name], [name]: event.target.checked } }))} /> : <input type={prop.type === "integer" || prop.type === "number" ? "number" : "text"} step={percentInput ? ".1" : prop.type === "number" ? ".01" : "1"} min={percentInput && prop.minimum != null ? prop.minimum * 100 : prop.minimum} max={percentInput && prop.maximum != null ? prop.maximum * 100 : prop.maximum} value={String(percentInput && rawValue != null ? Number(rawValue) * 100 : rawValue ?? "")} onChange={(event) => setParameters((current) => ({ ...current, [skill.name]: { ...current[skill.name], [name]: percentInput ? Number.parseFloat(event.target.value) / 100 : prop.type === "integer" ? Number.parseInt(event.target.value, 10) : prop.type === "number" ? Number.parseFloat(event.target.value) : event.target.value } }))} className="w-36 rounded border border-border bg-background px-2 py-1 font-mono text-foreground" />}</label>; })}</div>)}</div>}
    {run && <div className="mt-5 border-t border-border/50 pt-4"><div className="mb-3 flex flex-wrap gap-2">{run.results.map((item, index) => <button key={item.skill} onClick={() => setActive(index)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${index === active ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground"}`}>{item.skill}</button>)}</div>{current?.status === "failed" && <p className="text-sm text-danger">{current.detail || tr("Skill failed.", "技能运行失败。")}</p>}{currentReport && <SkillReport result={currentReport} />}<details className="mt-4"><summary className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground"><SlidersHorizontal className="h-3.5 w-3.5" /> {tr("Raw JSON", "原始 JSON")}</summary><pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-black/20 p-3 text-[10px]">{JSON.stringify(current?.report || {}, null, 2)}</pre></details></div>}
  </GlassCard>;
}
