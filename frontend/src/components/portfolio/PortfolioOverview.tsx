import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { api, ApiError, type PortfolioSummary } from "@/lib/api";
import { GlassCard } from "@/components/ui/GlassCard";
import { portfolioNumber } from "@/lib/portfolio-format";
import { storageGet, storageSet } from "@/lib/storage";
import { useLocale } from "@/lib/i18n";

export function PortfolioOverview() {
  const { locale, tr } = useLocale();
  const [currency, setCurrency] = useState(() => storageGet("vr-reporting-currency") || "AUTO");
  const [data, setData] = useState<PortfolioSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    storageSet("vr-reporting-currency", currency);
    setData(null); setError(null);
    api.portfolioSummary(currency === "AUTO" ? undefined : currency).then(setData).catch((reason) => setError(reason instanceof ApiError ? reason.message : tr("Unable to load overview", "总览加载失败")));
  }, [currency, tr]);
  return <>
    <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-semibold">{tr("Cross-asset overview", "跨资产总览")}</h2><p className="text-xs text-muted-foreground">{tr("Aggregated from normalized positions without double-counting IBKR NAV.", "由规范化持仓逐项汇总，不会把 IBKR NAV 与持仓重复相加。")}</p></div><select value={currency} onChange={(event) => setCurrency(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="AUTO">{tr("Auto currency", "自动币种")}</option><option value="USD">USD</option><option value="GBP">GBP</option><option value="EUR">EUR</option><option value="CNY">CNY</option></select></div>
    {error && <p className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning"><AlertCircle className="h-4 w-4" />{error}</p>}
    {!data && !error ? <GlassCard><p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{tr("Loading", "加载中")}</p></GlassCard> : data && <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{[
        [tr("Total assets", "总资产"), data.total], [tr("Equities", "股票"), data.stock], [tr("Crypto", "加密货币"), data.crypto], [tr("Cash", "现金"), data.cash],
      ].map(([label, value]) => <GlassCard key={String(label)} className="p-3"><p className="text-xs text-muted-foreground">{label} · {data.reporting_currency}</p><p className="mt-1 font-mono text-xl font-bold">{portfolioNumber(value as number)}</p></GlassCard>)}</div>
      <GlassCard className="mb-4"><div className="flex h-4 overflow-hidden rounded-full bg-muted/40"><div className="bg-sky-500" style={{ width: `${data.weights.stock * 100}%` }} /><div className="bg-primary" style={{ width: `${data.weights.crypto * 100}%` }} /><div className="bg-emerald-500" style={{ width: `${data.weights.cash * 100}%` }} /></div><div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground"><span>{tr("Equities", "股票")} {(data.weights.stock * 100).toFixed(1)}%</span><span>{tr("Crypto", "加密")} {(data.weights.crypto * 100).toFixed(1)}%</span><span>{tr("Cash", "现金")} {(data.weights.cash * 100).toFixed(1)}%</span><span>{tr("Including cash-like crypto", "其中类现金加密资产")} {portfolioNumber(data.cash_like_crypto)} {data.reporting_currency}</span></div></GlassCard>
      {data.gaps.length > 0 && <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">{tr("Excluded items or data gaps", "未计入或数据缺口")}：{data.gaps.join(locale === "en" ? "; " : "；")}</p>}
    </>}
  </>;
}
