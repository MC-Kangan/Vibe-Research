import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { AlertCircle, BarChart3, Loader2, Play, SlidersHorizontal } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { ApiError, api, type ResearchRunResponse, type ResearchSkill } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

type Json = Record<string, any>;
const REGIME_ZH: Record<string, string> = { Bull: "多头", Bear: "空头", Sideways: "震荡", Side: "震荡", Unavailable: "不可用" };

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

function WorthBuyReport({ result }: { result: Json }) {
  const { locale, tr } = useLocale();
  const values = observations(result);
  const presentation = result.presentation || {};
  const levels = presentation.reference_levels || {};
  const components = presentation.score_components || [];
  const bars = presentation.price_bars || [];
  const verdict = ({
    buy: tr("Worth further consideration", "值得进一步研究"), watch: tr("Watch for confirmation", "等待确认"), avoid: tr("Avoid new entry", "避免新建仓位"),
    reduce_risk: tr("Review existing risk", "检查现有风险"), cannot_score: tr("Insufficient data", "数据不足"),
  } as Record<string, string>)[presentation.verdict as string] || tr("Insufficient data", "数据不足");
  const entry = ({
    trend_broken: tr("Trend broken", "趋势已破坏"), overextended: tr("Overextended", "涨幅过度延伸"), pullback_no_trigger: tr("Pullback without trigger", "回调但无触发信号"),
    trend_continuation: tr("Trend continuation", "趋势延续"), pullback_reversal: tr("Pullback reversal", "回调反转"), recovery_reversal: tr("Recovery reversal", "修复反转"),
  } as Record<string, string>)[presentation.entry_class as string] || tr("Unavailable", "不可用");
  const priceOption = useMemo(() => ({
    tooltip: { trigger: "axis" },
    grid: { left: 42, right: 18, top: 24, bottom: 28 },
    xAxis: { type: "category", data: bars.map((item: Json) => String(item.observed_at).slice(0, 10)), axisLabel: { color: "#94a3b8", hideOverlap: true } },
    yAxis: { scale: true, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } } },
    series: [{
      type: "candlestick", data: bars.map((item: Json) => [item.open, item.close, item.low, item.high]),
      itemStyle: { color: "#22c55e", color0: "#ef4444", borderColor: "#22c55e", borderColor0: "#ef4444" },
      markLine: { symbol: "none", data: [
        levels.entry != null ? { yAxis: levels.entry, lineStyle: { color: "#60a5fa", type: "dashed" }, label: { formatter: tr("Entry", "入场") } } : null,
        levels.stop != null ? { yAxis: levels.stop, lineStyle: { color: "#f87171", type: "dotted" }, label: { formatter: tr("Stop", "止损") } } : null,
        levels.target != null ? { yAxis: levels.target, lineStyle: { color: "#34d399", type: "dashed" }, label: { formatter: tr("Target", "目标") } } : null,
      ].filter(Boolean) },
    }],
  }), [bars, levels.entry, levels.stop, levels.target, locale, tr]);
  const scoreOption = useMemo(() => ({
    grid: { left: 130, right: 20, top: 18, bottom: 24 },
    xAxis: { type: "value", max: 100, axisLabel: { color: "#94a3b8" } },
    yAxis: { type: "category", data: components.map((item: Json) => item.key), axisLabel: { color: "#cbd5e1" } },
    series: [{ type: "bar", data: components.map((item: Json) => item.score), itemStyle: { color: "#f97316" }, label: { show: true, position: "right", color: "#cbd5e1" } }],
  }), [components]);
  return <div className="space-y-4">
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-lg font-semibold">{verdict}</p><p className="mt-1 text-sm text-muted-foreground">{result.summary || tr("The setup report is complete.", "分析报告已完成。")}</p><p className="mt-2 text-xs text-muted-foreground">{tr("Position context is not included in this Vibe Research run.", "本次 Vibe Research 分析不包含持仓上下文。")}</p></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{tr("Composite", "综合得分")}</p><p className="font-mono text-lg font-bold">{values.worth_buy_composite ?? "—"}</p></div>
      <div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{tr("Risk veto", "风险否决")}</p><p className="font-mono text-lg font-bold">{values.worth_buy_risk_veto ?? "—"}</p></div>
      <div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{tr("Entry setup", "入场形态")}</p><p className="text-sm font-semibold">{entry}</p></div>
    </div>
    <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
      <div><h4 className="mb-2 text-sm font-semibold">{tr("Price structure and model reference levels", "价格结构与模型参考位")}</h4>{bars.length ? <EChart option={priceOption} label={tr("Price structure and reference levels", "价格结构与参考位")} /> : <p className="text-sm text-muted-foreground">{tr("No chart data returned.", "未返回图表数据。")}</p>}</div>
      <div><h4 className="mb-2 text-sm font-semibold">{tr("Evidence scores and weighted contribution", "证据得分与加权贡献")}</h4>{components.length ? <EChart option={scoreOption} label={tr("Worth-buy evidence scores", "值得买证据得分")} /> : <p className="text-sm text-muted-foreground">{tr("No score components returned.", "未返回得分项。")}</p>}</div>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">{[[tr("Entry reference", "入场参考"), levels.entry], [tr("Stop reference", "止损参考"), levels.stop], [tr("Target reference", "目标参考"), levels.target]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono font-semibold">{value ?? "—"}</p></div>)}</div>
    <ReportTable title={tr("Risk controls", "风险控制")} rows={presentation.risk_checks} />
    <ReportTable title={tr("Technical confirmation", "技术确认")} rows={presentation.confirmation_checks} />
    <p className="text-xs text-muted-foreground">{tr("This deterministic report uses price, volume, trend and benchmark data. News/event risk, fundamental valuation and AI opinion are not calculated by this skill.", "此确定性报告使用价格、成交量、趋势与基准数据；该技能不计算新闻/事件风险、基本面估值或 AI 意见。")}</p>
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
  const regimeColors: Record<string, string> = { Bear: "#ef4444", Sideways: "#f59e0b", Bull: "#22c55e" };
  const option = useMemo(() => {
    const dates = points.map((item: Json) => String(item.observed_at).slice(0, 10));
    return {
      tooltip: { trigger: "axis" },
      grid: [{ left: 54, right: 18, top: 20, height: "48%" }, { left: 54, right: 18, top: "56%", height: "22%" }, { left: 54, right: 18, top: "84%", height: "8%" }],
      xAxis: [
        { type: "category", data: dates, axisLabel: { color: "#94a3b8", hideOverlap: true } },
        { type: "category", gridIndex: 1, data: dates, axisLabel: { show: false } },
        { type: "category", gridIndex: 2, data: dates, axisLabel: { show: false } },
      ],
      yAxis: [
        { scale: true, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } } },
        { gridIndex: 1, axisLabel: { color: "#94a3b8", formatter: (value: number) => `${value}%` }, splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } } },
        { gridIndex: 2, min: 0, max: 2, show: false },
      ],
      series: [
        { name: "Close", type: "line", showSymbol: false, data: points.map((item: Json) => item.close), lineStyle: { color: "#60a5fa", width: 2 } },
        { name: "Rolling return", type: "line", xAxisIndex: 1, yAxisIndex: 1, showSymbol: false, data: points.map((item: Json) => Number(item.rolling_return) * 100), lineStyle: { color: "#c084fc" }, markLine: { symbol: "none", data: [{ yAxis: Number(presentation.bull_threshold ?? 0.05) * 100, lineStyle: { color: "#22c55e", type: "dashed" }, label: { formatter: "Bull" } }, { yAxis: Number(presentation.bear_threshold ?? -0.05) * 100, lineStyle: { color: "#ef4444", type: "dashed" }, label: { formatter: "Bear" } }] } },
        { name: "Regime", type: "bar", xAxisIndex: 2, yAxisIndex: 2, barWidth: "100%", data: points.map((item: Json) => ({ value: item.regime === "Bull" ? 2 : item.regime === "Bear" ? 0 : 1, itemStyle: { color: regimeColors[item.regime] || "#64748b" } })) },
      ],
    };
  }, [points, presentation.bull_threshold, presentation.bear_threshold]);
  const stationaryOption = useMemo(() => ({ grid: { left: 92, right: 20, top: 18, bottom: 28 }, xAxis: { type: "value", max: 1, axisLabel: { color: "#94a3b8", formatter: (v: number) => `${Math.round(v * 100)}%` } }, yAxis: { type: "category", data: ["Bear", "Sideways", "Bull"], axisLabel: { color: "#cbd5e1" } }, series: [{ type: "bar", data: stationary, itemStyle: { color: (p: Json) => ["#ef4444", "#f59e0b", "#22c55e"][p.dataIndex] }, label: { show: true, position: "right", formatter: (p: Json) => `${(Number(p.value) * 100).toFixed(1)}%`, color: "#cbd5e1" } }] }), [stationary]);
  const persistenceOption = useMemo(() => ({ grid: { left: 130, right: 20, top: 18, bottom: 28 }, xAxis: { type: "value", max: 1, axisLabel: { color: "#94a3b8" } }, yAxis: { type: "category", data: ["Bear Persistence", "Sideways Persistence", "Bull Persistence"], axisLabel: { color: "#cbd5e1" } }, series: [{ type: "bar", data: persistence, itemStyle: { color: "#64748b" }, label: { show: true, position: "right", color: "#cbd5e1" } }] }), [persistence]);
  const regimeLabel = locale === "en" ? regime : (REGIME_ZH[regime] || regime);
  return <div className="space-y-4">
    <div className={`rounded-xl border p-4 ${regime === "Bull" ? "border-success/30 bg-success/5" : regime === "Bear" ? "border-danger/30 bg-danger/5" : "border-warning/30 bg-warning/5"}`}><p className="text-lg font-semibold">{tr("Current regime: ", "当前状态：")}{regimeLabel}</p><p className="mt-1 text-sm text-muted-foreground">{result.summary || tr("Markov regime report completed.", "Markov 状态报告已完成。")}</p><p className="mt-2 text-xs text-muted-foreground">{tr("Window", "窗口")} {presentation.window ?? 20}d · {tr("Bull", "多头")} ≥ {((presentation.bull_threshold ?? 0.05) * 100).toFixed(1)}% · {tr("Bear", "空头")} ≤ {((presentation.bear_threshold ?? -0.05) * 100).toFixed(1)}%</p></div>
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground"><label className="inline-flex items-center gap-2"><input type="checkbox" checked={showMatrix} onChange={(event) => setShowMatrix(event.target.checked)} />{tr("Transition matrix", "转移矩阵")}</label><label className="inline-flex items-center gap-2"><input type="checkbox" checked={showStationary} onChange={(event) => setShowStationary(event.target.checked)} />{tr("Stationary table", "稳态表")}</label></div>
    {points.length > 0 && <div className="relative rounded-lg border border-border/50 p-2"><EChart option={option} label="Markov price, rolling return, and regime ribbon" className="h-[470px]" />{showMatrix && <div className="absolute right-3 top-3 rounded-lg border border-border/70 bg-background/90 p-2 text-[10px] shadow-lg"><p className="mb-1 font-semibold">Transition matrix</p><table><thead><tr><th className="px-1 text-left">From \ To</th>{["Bear", "Side", "Bull"].map((name) => <th key={name} className="px-1">{name}</th>)}</tr></thead><tbody>{["Bear", "Side", "Bull"].map((name, row) => <tr key={name}><th className="px-1 text-left">{name}</th>{(matrix[row] || []).map((value: number | null, col: number) => <td key={col} className="px-1 text-right font-mono">{value == null ? "—" : `${(value * 100).toFixed(0)}%`}</td>)}</tr>)}</tbody></table></div>}</div>}
    {showStationary && <div className="overflow-x-auto rounded-lg border border-border/60"><table className="w-full text-left text-xs"><thead className="bg-muted/30 text-muted-foreground"><tr><th className="p-2">{tr("Stationary distribution", "稳态分布")}</th><th className="p-2">{tr("Probability", "概率")}</th><th className="p-2">{tr("Persistence", "持续性")}</th></tr></thead><tbody>{["Bear", "Sideways", "Bull"].map((name, index) => <tr key={name} className="border-t border-border/40"><td className="p-2">{locale === "en" ? name : REGIME_ZH[name]}</td><td className="p-2 font-mono">{stationary[index] == null ? "—" : `${(Number(stationary[index]) * 100).toFixed(1)}%`}</td><td className="p-2 font-mono">{persistence[index] == null ? "—" : `${(Number(persistence[index]) * 100).toFixed(1)}%`}</td></tr>)}</tbody></table></div>}
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{tr("Directional signal", "方向信号")}</p><p className="font-mono text-lg font-bold">{values.markov_signal ?? "—"}</p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{tr("Observed points", "观测点数")}</p><p className="text-sm">{points.length || "—"}</p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{tr("Data quality", "数据质量")}</p><p className="text-sm">{result.status || tr("unknown", "未知")}</p></div></div>
    {!points.length && <div className="grid gap-4 lg:grid-cols-2"><div><h4 className="mb-2 text-sm font-semibold">{tr("Stationary probabilities", "稳态概率")}</h4><EChart option={stationaryOption} label={tr("Markov stationary probabilities", "Markov 稳态概率")} /></div><div><h4 className="mb-2 text-sm font-semibold">{tr("Persistence", "持续性")}</h4><EChart option={persistenceOption} label={tr("Markov regime persistence", "Markov 状态持续性")} /></div></div>}
  </div>;
}

function ReportTable({ title, rows }: { title: string; rows?: Json[] }) {
  const { tr } = useLocale();
  return <section><h4 className="mb-2 text-sm font-semibold">{title}</h4><div className="overflow-x-auto rounded-lg border border-border/60"><table className="w-full text-left text-xs"><thead className="bg-muted/30 text-muted-foreground"><tr><th className="p-2">{tr("Check", "检查项")}</th><th className="p-2">{tr("Status", "状态")}</th><th className="p-2">{tr("Value", "数值")}</th></tr></thead><tbody>{(rows || []).map((row) => <tr key={row.key} className="border-t border-border/40"><td className="p-2">{row.key}</td><td className="p-2">{row.status}</td><td className="p-2 font-mono">{row.value ?? "—"}</td></tr>)}</tbody></table></div></section>;
}

export function SkillAnalysisPanel({ symbol, supported, assetType = "equity" }: { symbol: string | null; supported: boolean; assetType?: "equity" | "crypto" }) {
  const { tr } = useLocale();
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
    {skills.length > 0 && <div className="grid gap-3 md:grid-cols-2">{skills.map((skill) => <div key={skill.name} className="rounded-lg border border-border/60 p-3"><label className="flex cursor-pointer items-center gap-2 text-sm font-medium"><input type="checkbox" checked={selected.includes(skill.name)} onChange={() => toggleSkill(skill)} />{skill.name}</label><p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>{selected.includes(skill.name) && Object.entries(skill.parameters?.properties || {}).filter(([name]) => name !== "threshold").map(([name, prop]) => { const percentInput = skill.name === "markov-method" && name.endsWith("threshold"); const rawValue = parameters[skill.name]?.[name]; return <label key={name} className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{name === "bull_threshold" ? "Bull threshold (%)" : name === "bear_threshold" ? "Bear threshold (%)" : name}</span>{prop.type === "boolean" ? <input type="checkbox" checked={Boolean(rawValue)} onChange={(e) => setParameters((current) => ({ ...current, [skill.name]: { ...current[skill.name], [name]: e.target.checked } }))} /> : <input type={prop.type === "integer" || prop.type === "number" ? "number" : "text"} step={percentInput ? "0.1" : prop.type === "number" ? "0.01" : "1"} min={percentInput && prop.minimum != null ? prop.minimum * 100 : prop.minimum} max={percentInput && prop.maximum != null ? prop.maximum * 100 : prop.maximum} value={String(percentInput && rawValue != null ? Number(rawValue) * 100 : rawValue ?? "")} onChange={(e) => setParameters((current) => ({ ...current, [skill.name]: { ...current[skill.name], [name]: percentInput ? Number.parseFloat(e.target.value) / 100 : prop.type === "integer" ? Number.parseInt(e.target.value, 10) : prop.type === "number" ? Number.parseFloat(e.target.value) : e.target.value } }))} className="w-36 rounded border border-border bg-background px-2 py-1 font-mono text-foreground" />}</label>; })}</div>)}</div>}
    {run && <div className="mt-5 border-t border-border/50 pt-4"><div className="mb-3 flex flex-wrap gap-2">{run.results.map((item, index) => <button key={item.skill} onClick={() => setActive(index)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${index === active ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground"}`}>{item.skill}</button>)}</div>{current?.status === "failed" && <p className="text-sm text-danger">{current.detail || tr("Skill failed.", "技能运行失败。")}</p>}{currentReport && (currentReport.analyst === "worth-buy-stocks" ? <WorthBuyReport result={currentReport} /> : <MarkovReport result={currentReport} />)}<details className="mt-4"><summary className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground"><SlidersHorizontal className="h-3.5 w-3.5" /> {tr("Raw JSON", "原始 JSON")}</summary><pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-black/20 p-3 text-[10px]">{JSON.stringify(current?.report || {}, null, 2)}</pre></details></div>}
  </GlassCard>;
}
