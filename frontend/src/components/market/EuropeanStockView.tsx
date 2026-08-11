import { BarChart3, Clock3, Database, FileText, Newspaper, TrendingUp } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import type {
  MarketEarnings, MarketHistoricalSeries, MarketNews, MarketSnapshot, SecFacts, SecFilings,
} from "@/lib/api";
import { formatMarketPrice } from "@/lib/market-symbols";
import { cn } from "@/lib/utils";
import { PriceHistoryChart } from "./PriceHistoryChart";
import { useLocale } from "@/lib/i18n";

interface Props {
  snapshot: MarketSnapshot;
  history: MarketHistoricalSeries;
  news: MarketNews | null;
  earnings: MarketEarnings | null;
  filings: SecFilings | null;
  secFacts: SecFacts | null;
  sourceGaps: string[];
}

const pct = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const pctColor = (value: number | null) => value != null && value > 0
  ? "text-success"
  : value != null && value < 0 ? "text-danger" : "text-muted-foreground";

function timestamp(value: string | null, locale: string, unknown: string): string {
  if (!value) return unknown;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(locale);
}

const factLabels: Record<string, string> = {
  revenue: "营收", net_income: "净利润", diluted_eps: "摊薄 EPS", assets: "总资产",
  liabilities: "总负债", cash: "现金及等价物", operating_cash_flow: "经营现金流",
};
const factLabelsEn: Record<string, string> = {
  revenue: "Revenue", net_income: "Net income", diluted_eps: "Diluted EPS", assets: "Total assets",
  liabilities: "Total liabilities", cash: "Cash and equivalents", operating_cash_flow: "Operating cash flow",
};
const periodLabels: Record<string, string> = {
  instant: "时点", quarterly: "单季", year_to_date: "年初至今", annual: "全年", duration: "期间",
};
const periodLabelsEn: Record<string, string> = {
  instant: "Point in time", quarterly: "Quarter", year_to_date: "Year to date", annual: "Annual", duration: "Period",
};

const factValue = (value: number | null, unit: string) => {
  if (value == null) return "—";
  if (unit === "USD" && Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)} bn USD`;
  if (unit === "USD" && Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)} mn USD`;
  return `${value.toLocaleString()} ${unit}`;
};

export function MarketStockView({ snapshot, history, news, earnings, filings, secFacts, sourceGaps }: Props) {
  const { locale, tr } = useLocale();
  const { instrument, quote } = snapshot;
  const crypto = instrument.asset_type === "crypto";
  const fields = [
    { label: tr("Price", "现价"), value: formatMarketPrice(quote.price, quote.currency), cls: pctColor(quote.change_pct) },
    { label: tr("Change", "涨跌幅"), value: pct(quote.change_pct), cls: pctColor(quote.change_pct) },
    { label: tr("Open", "开盘"), value: formatMarketPrice(quote.open, quote.currency) },
    { label: tr("High", "最高"), value: formatMarketPrice(quote.high, quote.currency) },
    { label: tr("Low", "最低"), value: formatMarketPrice(quote.low, quote.currency) },
    { label: tr("Previous close", "昨收"), value: formatMarketPrice(quote.previous_close, quote.currency) },
    { label: tr("Trading currency", "交易币种"), value: quote.currency },
    { label: tr("Price unit", "价格单位"), value: quote.price_scale === 1 ? quote.currency : `${quote.source_price_unit} → ${quote.currency}` },
  ];

  return (
    <>
      <GlassCard glow className="mb-4">
        <div className="mb-4 flex flex-wrap items-baseline gap-2">
          <h2 className="text-xl font-bold">{instrument.name}</h2>
          <span className="font-mono text-sm text-muted-foreground">{instrument.provider_symbol}</span>
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">{instrument.mic}</span>
          <span className="ml-auto text-xs text-muted-foreground">{instrument.exchange}{instrument.country ? ` · ${instrument.country}` : ""}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {fields.map((field) => (
            <div key={field.label} className="rounded-lg bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">{field.label}</p>
              <p className={cn("mt-0.5 font-mono text-base font-bold", field.cls)}>{field.value}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><Database className="h-3 w-3" /> {tr("Source", "数据源")} {quote.source}</span>
          <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" /> {tr("Market time", "行情时间")} {timestamp(quote.observed_at, locale, tr("Unknown", "未知"))}</span>
          <span>{tr("Fetched", "抓取时间")} {timestamp(quote.fetched_at, locale, tr("Unknown", "未知"))}</span>
          <span className="font-mono">{instrument.instrument_id}</span>
        </div>
      </GlassCard>

      <GlassCard className="mb-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-primary" /> {tr("Daily prices", "日线行情")} · {history.range}
        </h3>
        <p className="mb-2 text-[11px] text-muted-foreground/60">{tr(`Prices are normalized to ${quote.currency}; missing values are never replaced with zero. Drag the lower range to zoom.`, `价格已统一为 ${quote.currency}；缺失值不会填成零。拖动底部区间可缩放。`)}</p>
        <PriceHistoryChart bars={history.bars} currency={quote.currency} />
      </GlassCard>

      {secFacts && Object.keys(secFacts.facts).length > 0 && (
        <GlassCard className="mb-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <Database className="h-4 w-4 text-primary" /> {tr("Latest SEC company facts", "SEC 最新公司事实")}
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(secFacts.facts).map(([key, fact]) => (
              <div key={key} className="rounded-lg bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{(locale === "en" ? factLabelsEn[key] : factLabels[key]) || fact.label || key}</p>
                <p className="mt-0.5 font-mono text-sm font-bold">{factValue(fact.val, fact.unit)}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {fact.start ? `${fact.start} → ${fact.end || "—"}` : fact.end || "—"} · {(locale === "en" ? periodLabelsEn[fact.period_type || ""] : periodLabels[fact.period_type || ""]) || tr("Unknown period", "期间未知")} · {fact.form || "—"}
                </p>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {earnings && earnings.items.length > 0 && (
        <GlassCard className="mb-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <TrendingUp className="h-4 w-4 text-primary" /> {tr("Earnings actuals and estimates", "Earnings 实际值与预期")}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="text-muted-foreground"><tr><th className="pb-2">{tr("Period", "报告期")}</th><th>{tr("Actual EPS", "实际 EPS")}</th><th>{tr("Estimated EPS", "预期 EPS")}</th><th>Surprise</th></tr></thead>
              <tbody>{earnings.items.slice(0, 8).map((item, index) => (
                <tr key={`${item.period}-${index}`} className="border-t border-border/40">
                  <td className="py-2 font-mono">{item.period || `${item.year ?? "—"} Q${item.quarter ?? "—"}`}</td>
                  <td className="font-mono">{item.actual ?? "—"}</td><td className="font-mono">{item.estimate ?? "—"}</td>
                  <td className={cn("font-mono", pctColor(item.surprise_pct))}>{pct(item.surprise_pct)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {filings && filings.items.length > 0 && (
        <GlassCard className="mb-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <FileText className="h-4 w-4 text-primary" /> {tr("SEC filings", "SEC 监管文件")}
          </h3>
          <div className="divide-y divide-border/40">
            {filings.items.slice(0, 10).map((item) => (
              <div key={item.accession_number} className="flex items-start gap-3 py-2 text-xs">
                <span className="w-14 shrink-0 font-mono font-semibold text-primary">{item.form || "—"}</span>
                <div className="min-w-0 flex-1">
                  {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="font-medium hover:text-primary">{item.primaryDocDescription || item.primary_document}</a> : <span>{item.primaryDocDescription || item.primary_document}</span>}
                  <p className="text-[10px] text-muted-foreground">{tr("Filed", "提交")} {item.filingDate || "—"} · {tr("Period", "报告期")} {item.reportDate || "—"}</p>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {news && news.items.length > 0 && (
        <GlassCard className="mb-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <Newspaper className="h-4 w-4 text-primary" /> {tr("Company news", "公司新闻")}
          </h3>
          <div className="divide-y divide-border/40">
            {news.items.slice(0, 10).map((item, index) => (
              <div key={`${item.url}-${index}`} className="py-2 text-xs">
                {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="font-medium hover:text-primary">{item.headline || "Untitled"}</a> : <span className="font-medium">{item.headline || "Untitled"}</span>}
                <p className="mt-0.5 text-[10px] text-muted-foreground">{item.source || "Finnhub"}{item.published_at ? ` · ${new Date(item.published_at * 1000).toLocaleString(locale)}` : ""}</p>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      <p className="text-xs text-muted-foreground/60">
        {crypto ? tr("Prices come from the Coinbase USD spot market with UTC daily boundaries; traditional company fundamentals, filings, and earnings do not apply.", "行情来自 Coinbase USD 现货市场，日线以 UTC 为边界；传统公司基本面、监管文件与 earnings 不适用。") : tr("Prices come from Yahoo Chart. SEC data applies only to US filers. News and earnings use the Finnhub trial tier; European coverage is still being validated.", "行情来自 Yahoo chart；SEC 数据仅适用于美国申报公司；新闻与 earnings 使用 Finnhub trial，欧洲覆盖仍在验证。")}
        {sourceGaps.length > 0 && <> {tr("Gaps in this request", "本次缺口")}：{sourceGaps.join(locale === "en" ? "; " : "；")}。</>}
      </p>
    </>
  );
}
