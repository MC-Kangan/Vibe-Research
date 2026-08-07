import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { ApiError, api, type PaMasterPortfolio } from "@/lib/api";

const numberValue = (value: string | null | undefined) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const fmt = (value: string | null | undefined, digits = 2) => {
  const number = numberValue(value);
  return number == null ? "—" : number.toLocaleString("zh-CN", { maximumFractionDigits: digits });
};
const fmtPercent = (value: string | null | undefined, digits = 1) => {
  const number = numberValue(value);
  return number == null ? "—" : `${(number * 100).toLocaleString("zh-CN", { maximumFractionDigits: digits })}%`;
};
const fmtTime = (value: string | null | undefined) => {
  if (!value) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString("zh-CN");
};
const signed = (value: string | null | undefined) => {
  const number = numberValue(value);
  return number == null ? "—" : `${number > 0 ? "+" : ""}${fmt(value)}`;
};
const pnlClass = (value: string | null | undefined) => {
  const number = numberValue(value);
  return number == null ? "text-muted-foreground" : number > 0 ? "text-success" : number < 0 ? "text-danger" : "text-muted-foreground";
};

function Status({ data }: { data: PaMasterPortfolio }) {
  if (data.status === "disabled") return <p className="text-sm text-muted-foreground">PA Master overlay is not configured.</p>;
  if (data.status === "unavailable") return <p className="flex items-center gap-2 text-sm text-warning"><AlertCircle className="h-4 w-4" />{data.detail || "PA Master is unavailable."}</p>;
  return data.detail ? <p className="text-xs text-warning">部分数据不可用：{data.detail}</p> : null;
}

export function PaMasterPortfolioPanel() {
  const [data, setData] = useState<PaMasterPortfolio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.paMasterPortfolio());
      setError(null);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "PA Master overlay unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const summary = data?.summary;
  const allocations = data?.allocations || [];
  const positions = data?.positions || [];
  const totalWeight = allocations.reduce((sum, item) => sum + (numberValue(item.portfolio_weight) || 0), 0);
  const colors = ["#60a5fa", "#34d399", "#f59e0b", "#f472b6", "#a78bfa", "#fb7185"];

  return <GlassCard className="mb-6" glow>
    <div className="mb-4 flex flex-wrap items-start gap-3">
      <div>
        <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" />PA Master 持仓（只读）</h3>
        <p className="mt-1 text-xs text-muted-foreground">Read-only PA Master snapshot. It does not modify or replace local holdings.</p>
      </div>
      <button onClick={load} disabled={loading} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}刷新 PA Master
      </button>
    </div>
    {error && <p className="mb-3 flex items-center gap-2 text-sm text-warning"><AlertCircle className="h-4 w-4" />{error}</p>}
    {data && <Status data={data} />}
    {data && (data.status === "available" || data.status === "partial") && <>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[["Reporting NAV", summary?.nav], ["Coverage", summary?.reporting_coverage], ["Positions", String(positions.length)]].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{label}{label === "Reporting NAV" && summary?.reporting_currency ? ` · ${summary.reporting_currency}` : ""}</p><p className="mt-1 font-mono text-lg font-bold">{label === "Positions" ? value : label === "Coverage" ? fmtPercent(value) : fmt(value)}</p></div>)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Positions refreshed: {fmtTime(data.freshness?.last_positions_refreshed_at)}</p>
      {allocations.length > 0 && <div className="mt-5"><h4 className="mb-2 text-sm font-semibold">Allocation</h4><div className="flex h-3 overflow-hidden rounded-full bg-muted/40">{allocations.map((item, index) => <div key={`${item.symbol}-${index}`} title={`${item.symbol} ${fmtPercent(item.portfolio_weight)}`} style={{ width: `${Math.min(100, Math.max(0, ((numberValue(item.portfolio_weight) || 0) / (totalWeight || 1)) * 100))}%`, backgroundColor: colors[index % colors.length] }} />)}</div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{allocations.map((item, index) => <span key={`${item.symbol}-legend`}><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />{item.symbol} {fmtPercent(item.portfolio_weight)}</span>)}</div></div>}
      {positions.length > 0 && <div className="mt-5 overflow-x-auto"><h4 className="mb-2 text-sm font-semibold">Position Details</h4><table className="w-full text-sm"><thead><tr className="border-b border-border/50 text-left text-xs text-muted-foreground">{["Symbol", "Qty", "Avg cost", "Last", "Unrealized P&L", "Currency / Venue"].map((heading) => <th key={heading} className="whitespace-nowrap px-2 py-2 font-medium">{heading}</th>)}</tr></thead><tbody>{positions.map((item, index) => <tr key={`${item.account_ref}-${item.instrument_id || item.symbol}-${index}`} className="border-b border-border/30"><td className="px-2 py-2.5"><span className="font-medium">{item.name || item.symbol}</span><span className="ml-1.5 font-mono text-xs text-muted-foreground/60">{item.symbol}</span></td><td className="px-2 py-2.5 font-mono">{fmt(item.quantity)}</td><td className="px-2 py-2.5 font-mono">{fmt(item.average_cost, 4)}</td><td className="px-2 py-2.5 font-mono">{fmt(item.latest_price, 4)}</td><td className={`px-2 py-2.5 font-mono ${pnlClass(item.unrealized_pnl)}`}>{signed(item.unrealized_pnl)}</td><td className="px-2 py-2.5 text-xs text-muted-foreground">{item.currency}{item.venue ? ` · ${item.venue}` : ""}</td></tr>)}</tbody></table></div>}
      {allocations.length === 0 && positions.length === 0 && <p className="mt-4 text-sm text-muted-foreground">PA Master has no open positions available.</p>}
    </>}
    <p className="mt-4 text-[11px] text-muted-foreground/60">PA Master data is read on demand. IBKR refresh and local portfolio editing remain separate.</p>
  </GlassCard>;
}
