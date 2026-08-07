import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { ApiError, api, type RealPositionSnapshot } from "@/lib/api";

const numberValue = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? null : value;
const fmt = (value: number | null | undefined, digits = 2) => numberValue(value)?.toLocaleString("zh-CN", { maximumFractionDigits: digits }) || "—";
const signed = (value: number | null | undefined) => numberValue(value) == null ? "—" : `${value! > 0 ? "+" : ""}${fmt(value)}`;
const pnlClass = (value: number | null | undefined) => value == null ? "text-muted-foreground" : value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-muted-foreground";
const percent = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;

export function RealPositionPanel() {
  const [data, setData] = useState<RealPositionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.realPositions()); setError(null); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : "真实持仓不可用"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setLoading(true); setError(null);
    try {
      setData(await api.refreshRealPositions());
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && window.confirm("IBKR 返回空持仓。确认用空快照替换当前真实持仓吗？")) {
        try { setData(await api.refreshRealPositions(true)); }
        catch (retryReason) { setError(retryReason instanceof ApiError ? retryReason.message : "IBKR 刷新失败"); }
      } else setError(reason instanceof ApiError ? reason.message : "IBKR 刷新失败");
    } finally { setLoading(false); }
  };

  const positions = data?.positions || [];
  const allocations = useMemo(() => {
    const valued = positions.filter((item) => item.reporting_market_value != null).slice(0, 8);
    const grossExposure = valued.reduce(
      (sum, item) => sum + Math.abs(item.reporting_market_value || 0),
      0,
    );
    return valued.map((item) => ({
      ...item,
      exposureSide: (item.reporting_market_value || 0) < 0 ? "Short" : "Long",
      weight: grossExposure ? Math.abs(item.reporting_market_value || 0) / grossExposure : null,
    }));
  }, [positions]);
  const aiContext = data?.status === "available"
    ? `我的真实 IBKR 持仓（只在用户点击后发送）：\n${positions.map((item) => `${item.name}(${item.symbol}) 数量${item.quantity ?? "—"} 成本${item.average_cost ?? "—"} 现价${item.latest_price ?? "—"} 浮盈${item.unrealized_pnl ?? "—"} ${item.currency}`).join("\n")}`
    : "真实 IBKR 持仓尚未加载。";

  return <GlassCard className="mb-5" glow>
    <div className="mb-4 flex flex-wrap items-start gap-3">
      <div><h2 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="h-5 w-5 text-primary" />真实持仓（IBKR Flex）</h2><p className="mt-1 text-xs text-muted-foreground">Vibe Research 本地快照；刷新是只读 IBKR 查询，不提交订单。</p></div>
      <div className="ml-auto flex items-center gap-2">
        {data?.status === "available" && <AskAiButton context={aiContext} label="让 AI 看真实持仓" suggestions={["我的持仓集中在哪些方向", "结构上有什么风险", "帮我梳理一下"]} />}
        <button onClick={refresh} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}从 IBKR 刷新</button>
      </div>
    </div>
    {error && <p className="mb-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning"><AlertCircle className="h-4 w-4" />{error}</p>}
    {data?.status === "not_configured" && <p className="text-sm text-muted-foreground">尚未配置 IBKR Flex。设置 Vibe 的 Flex token 和 query ID 后即可刷新。</p>}
    {data?.status === "empty" && <p className="text-sm text-muted-foreground">IBKR 快照为空；点击刷新获取当前账户状态。</p>}
    {data?.status === "available" && <>
      <div className="grid gap-3 sm:grid-cols-4">
        {[['NAV', fmt(data.summary.nav), data.summary.reporting_currency || ""], ['覆盖率', percent(data.summary.reporting_coverage), ""], ['持仓数', String(positions.length), ""], ['报告日期', data.report_date || "—", ""]].map(([label, value, suffix]) => <div key={String(label)} className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{label}{suffix ? ` · ${suffix}` : ""}</p><p className="mt-1 font-mono text-lg font-bold">{value}</p></div>)}
      </div>
      {allocations.length > 0 && <div className="mt-4">
        <h3 className="mb-2 text-sm font-semibold">Gross Exposure Allocation</h3>
        <div className="flex h-3 overflow-hidden rounded-full bg-muted/40">
          {allocations.map((item, index) => <div
            key={`${item.account_ref}-${item.symbol}-${index}`}
            title={`${item.exposureSide} ${item.symbol} ${percent(item.weight)}`}
            style={{ width: `${(item.weight || 0) * 100}%`, backgroundColor: ["#60a5fa", "#34d399", "#f59e0b", "#f472b6", "#a78bfa", "#fb7185"][index % 6] }}
          />)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {allocations.map((item, index) => <span key={`${item.account_ref}-${item.symbol}-${index}`}>{item.exposureSide} · {item.symbol} {percent(item.weight)}</span>)}
        </div>
      </div>}
      <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border/50 text-left text-xs text-muted-foreground">{["账户", "名称", "数量", "成本", "IBKR标记", "折算市值", "未实现盈亏（本币）", "本币 / 交易所"].map((heading) => <th key={heading} className="whitespace-nowrap px-2 py-2 font-medium">{heading}</th>)}</tr></thead><tbody>{positions.map((item) => <tr key={`${item.account_ref}-${item.symbol}`} className="border-b border-border/30"><td className="px-2 py-2 text-xs text-muted-foreground">{item.account_label}</td><td className="px-2 py-2"><span className="font-medium">{item.name}</span><span className="ml-1.5 font-mono text-xs text-muted-foreground/60">{item.symbol}</span></td><td className="px-2 py-2 font-mono">{fmt(item.quantity)}</td><td className="px-2 py-2 font-mono">{fmt(item.average_cost, 4)}</td><td className="px-2 py-2 font-mono">{fmt(item.latest_price, 4)}</td><td className="px-2 py-2 font-mono">{fmt(item.reporting_market_value ?? item.market_value)} <span className="text-[10px] text-muted-foreground">{item.reporting_currency || item.currency}</span></td><td className={`px-2 py-2 font-mono ${pnlClass(item.unrealized_pnl)}`}>{signed(item.unrealized_pnl)}</td><td className="px-2 py-2 text-xs text-muted-foreground">{item.currency}{item.venue ? ` · ${item.venue}` : ""}</td></tr>)}</tbody></table></div>
      {data.warnings.length > 0 && <p className="mt-3 text-xs text-warning">{data.warnings.join("；")}</p>}
      <p className="mt-3 text-[11px] text-muted-foreground/60">最后刷新：{data.refreshed_at ? new Date(data.refreshed_at).toLocaleString("zh-CN") : "—"} · 数据源：IBKR Flex</p>
    </>}
  </GlassCard>;
}
