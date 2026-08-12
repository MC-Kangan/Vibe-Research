import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BarChart3, BookOpen, Loader2, Play } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { EChart } from "@/components/ui/EChart";
import {
  api,
  ApiError,
  type PortfolioResearchCandidate,
  type PortfolioResearchPresentation,
  type PortfolioResearchResponse,
} from "@/lib/api";

type Method = "equal_weight" | "inverse_volatility" | "risk_parity" | "max_diversification";
type Json = Record<string, any>;

// Financial skill terminology stays canonical English across app locales.
const tr = (english: string, _chinese: string): string => english;

function pct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(2)}%`;
}

function num(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

export function PortfolioResearchPanel() {
  const [candidates, setCandidates] = useState<PortfolioResearchCandidate[]>([]);
  const [sourceGaps, setSourceGaps] = useState<Array<{ source: string; detail: string }>>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [method, setMethod] = useState<Method>("risk_parity");
  const [lookback, setLookback] = useState(120);
  const [result, setResult] = useState<PortfolioResearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.portfolioResearchCandidates().then((universe) => {
      setCandidates(universe.items);
      setSourceGaps(universe.gaps);
      setSelected(universe.items.slice(0, 6).map((item) => item.key));
    }).catch((reason) => setError(reason instanceof ApiError ? reason.message : tr("Unable to load portfolio research universe", "无法加载组合研究标的")));
  }, [tr]);

  const chosen = candidates.filter((item) => selected.includes(item.key));
  const run = async () => {
    if (chosen.length < 2) return;
    setLoading(true); setError(null); setResult(null);
    try { setResult(await api.runPortfolioResearch(chosen, method, lookback)); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : tr("Portfolio research failed", "组合研究失败")); }
    finally { setLoading(false); }
  };
  const correlation = result?.results.find((item) => item.analyst === "correlation-analysis")?.presentation;
  const allocation = result?.results.find((item) => item.analyst === "asset-allocation")?.presentation;

  return <GlassCard className="mt-5" glow>
    <div className="flex flex-wrap items-start gap-3">
      <div><h2 className="flex items-center gap-2 font-semibold"><BarChart3 className="h-4 w-4 text-primary" />{tr("Portfolio skills", "组合技能")}</h2><p className="mt-1 text-xs text-muted-foreground">{tr("Correlation analysis and long-only allocation scenarios from normalized daily prices.", "基于规范化日线的相关性分析与只做多配置情景。")}</p></div>
      <button onClick={run} disabled={loading || chosen.length < 2} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/25 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{tr("Run portfolio analysis", "运行组合分析")}</button>
    </div>
    {sourceGaps.length > 0 && <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning"><p className="font-medium">{tr("Portfolio source gaps", "组合数据源缺口")}</p><ul className="mt-1 list-disc space-y-1 pl-4">{sourceGaps.map((gap) => <li key={`${gap.source}:${gap.detail}`}><strong>{gap.source}:</strong> {gap.detail}</li>)}</ul></div>}
    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
      <div><p className="mb-2 text-xs font-medium text-muted-foreground">{tr("Select 2–9 portfolio instruments", "选择 2–9 个组合标的")}</p>{candidates.length ? <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{candidates.map((item) => { const checked = selected.includes(item.key); return <label key={item.key} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs ${checked ? "border-primary/40 bg-primary/5" : "border-border/50"}`}><input type="checkbox" className="mt-0.5" checked={checked} disabled={!checked && selected.length >= 9} onChange={() => setSelected((current) => checked ? current.filter((key) => key !== item.key) : [...current, item.key])} /><span><strong>{item.symbol}</strong><span className="ml-1 text-muted-foreground">{item.label}</span><span className="block text-[10px] text-muted-foreground/70">{item.market} · {item.source}</span></span></label>; })}</div> : <p className="rounded-lg border border-border/50 p-3 text-xs text-muted-foreground">{tr("Add at least two supported stock or crypto holdings first.", "请先添加至少两个受支持的股票或加密货币持仓。")}</p>}</div>
      <div className="grid content-start gap-2 sm:grid-cols-2 lg:w-56 lg:grid-cols-1"><label className="text-xs text-muted-foreground">{tr("Allocation method", "配置方法")}<select value={method} onChange={(event) => setMethod(event.target.value as Method)} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground"><option value="risk_parity">Risk parity</option><option value="inverse_volatility">Inverse volatility</option><option value="max_diversification">Maximum diversification</option><option value="equal_weight">Equal weight</option></select></label><label className="text-xs text-muted-foreground">{tr("Lookback", "回看期")}<select value={lookback} onChange={(event) => setLookback(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground"><option value={60}>60 days</option><option value={120}>120 days</option><option value={252}>252 days</option></select></label></div>
    </div>
    {error && <p className="mt-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning"><AlertCircle className="h-4 w-4" />{error}</p>}
    {result && <div className="mt-5 border-t border-border/50 pt-5">
      {correlation && allocation ? <PortfolioResults correlation={correlation} allocation={allocation} /> : <div className="space-y-2 text-sm text-warning"><p>{tr("TradeAgent returned a partial portfolio report.", "TradeAgent 返回了部分组合报告。")}</p>{result.results.map((item) => <div key={item.analyst} className="rounded-lg border border-warning/30 p-3"><p className="font-medium text-foreground">{item.analyst}</p><p className="mt-1">{item.summary}</p>{item.limitations?.length ? <p className="mt-1 text-xs">{tr("Limitations", "限制")}：{item.limitations.join(", ")}</p> : null}</div>)}</div>}
    </div>}
    <details className="mt-4 rounded-lg border border-border/50"><summary className="flex cursor-pointer items-center gap-2 p-3 text-sm font-semibold"><BookOpen className="h-4 w-4 text-primary" />{tr("How to read these skills", "如何解读这些技能")}</summary><div className="space-y-3 border-t border-border/50 p-3 text-xs leading-5 text-muted-foreground"><p><strong className="text-foreground">Correlation analysis.</strong> {tr("Values near +1 moved together, near 0 had little linear relationship, and near −1 moved in opposite directions. Historical correlation can change sharply during stress.", "接近 +1 表示同向，接近 0 表示线性关系较弱，接近 −1 表示反向；历史相关性在压力期可能快速变化。")}</p><p><strong className="text-foreground">Asset allocation.</strong> {tr("Equal weight ignores risk; inverse volatility gives calmer assets more capital; risk parity aims to balance risk contribution; maximum diversification seeks the strongest volatility-adjusted diversification.", "等权不考虑风险；逆波动率给低波动资产更多资金；风险平价力求均衡风险贡献；最大分散化追求更高的波动调整后分散效果。")}</p><p>{tr("These are mathematical scenarios from historical prices—not personalized targets, forecasts, or rebalancing instructions. Cash, tax, liquidity, FX, expected returns, and transaction costs are not modeled in this release.", "这些是基于历史价格的数学情景，并非个性化目标、预测或再平衡指令。本版未建模现金、税务、流动性、汇率、预期收益和交易成本。")}</p></div></details>
  </GlassCard>;
}

function PortfolioResults({ correlation, allocation }: { correlation: PortfolioResearchPresentation; allocation: PortfolioResearchPresentation }) {
  const labels = correlation.assets.map((item) => item.instrument.symbol);
  const heatmapOption = useMemo(() => ({ tooltip: { formatter: (item: Json) => `${labels[item.value[1]]} / ${labels[item.value[0]]}: ${Number(item.value[2]).toFixed(2)}` }, grid: { left: 82, right: 55, top: 20, bottom: 55 }, xAxis: { type: "category", data: labels, axisLabel: { color: "#94a3b8", rotate: 30 } }, yAxis: { type: "category", data: labels, axisLabel: { color: "#94a3b8" } }, visualMap: { min: -1, max: 1, calculable: false, orient: "horizontal", left: "center", bottom: 0, textStyle: { color: "#94a3b8" }, inRange: { color: ["#2563eb", "#111827", "#ef4444"] } }, series: [{ type: "heatmap", label: { show: true, color: "#e2e8f0", formatter: (item: Json) => Number(item.value[2]).toFixed(2) }, data: correlation.correlation_matrix.flatMap((row, y) => row.map((value, x) => [x, y, value])) }] }), [correlation, labels]);
  const allocationOption = useMemo(() => ({ tooltip: { trigger: "axis", valueFormatter: (value: number) => `${value.toFixed(2)}%` }, legend: { data: ["Scenario weights", "Risk contribution"], textStyle: { color: "#94a3b8" } }, grid: { left: 85, right: 25, top: 42, bottom: 28 }, xAxis: { type: "value", axisLabel: { color: "#94a3b8", formatter: (value: number) => `${value.toFixed(0)}%` }, splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } } }, yAxis: { type: "category", data: allocation.assets.map((item) => item.instrument.symbol), axisLabel: { color: "#cbd5e1" } }, series: [{ name: "Scenario weights", type: "bar", data: allocation.assets.map((item) => Number(item.weight) * 100), itemStyle: { color: "#f97316" } }, { name: "Risk contribution", type: "bar", data: allocation.assets.map((item) => Number(item.risk_contribution) * 100), itemStyle: { color: "#60a5fa" } }] }), [allocation]);
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3"><Metric label={tr("Portfolio volatility", "组合波动率")} value={pct(allocation.portfolio_volatility)} /><Metric label={tr("Diversification ratio", "分散化比率")} value={num(allocation.diversification_ratio)} /><Metric label={tr("Effective assets", "有效资产数")} value={num(allocation.effective_asset_count)} /></div>
    <div className="grid gap-5 xl:grid-cols-2"><div><h3 className="mb-1 text-sm font-semibold">{tr("Correlation analysis", "相关性分析")}</h3><p className="mb-2 text-xs text-muted-foreground">{tr("Correlation heatmap", "相关性热力图")} · {correlation.aligned_return_count} aligned returns</p><EChart option={heatmapOption} label="Correlation heatmap" className="h-72" /></div><div><h3 className="mb-1 text-sm font-semibold">{tr("Asset allocation", "资产配置")}</h3><p className="mb-2 text-xs text-muted-foreground">{allocation.method?.split("_").join(" ")} · {allocation.aligned_return_count} aligned returns</p><EChart option={allocationOption} label="Scenario weights and risk contribution" className="h-72" /></div></div>
    <div className="overflow-x-auto rounded-lg border border-border/50"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-muted/30 text-muted-foreground"><tr><th className="p-2">Asset</th><th className="p-2">Annualized volatility</th><th className="p-2">Scenario weight</th><th className="p-2">Risk contribution</th></tr></thead><tbody>{allocation.assets.map((item) => <tr key={`${item.instrument.market}:${item.instrument.symbol}`} className="border-t border-border/40"><td className="p-2 font-medium">{item.instrument.symbol}<span className="ml-1 text-muted-foreground">{item.instrument.market}</span></td><td className="p-2 font-mono">{pct(item.annualized_volatility)}</td><td className="p-2 font-mono">{pct(item.weight)}</td><td className="p-2 font-mono">{pct(item.risk_contribution)}</td></tr>)}</tbody></table></div>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-lg font-semibold">{value}</p></div>;
}
