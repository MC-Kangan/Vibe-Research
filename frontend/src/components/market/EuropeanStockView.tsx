import { BarChart3, Clock3, Database } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import type { MarketHistoricalSeries, MarketSnapshot } from "@/lib/api";
import { formatMarketPrice } from "@/lib/market-symbols";
import { cn } from "@/lib/utils";
import { PriceHistoryChart } from "./PriceHistoryChart";

interface Props {
  snapshot: MarketSnapshot;
  history: MarketHistoricalSeries;
}

const pct = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const pctColor = (value: number | null) => value != null && value > 0
  ? "text-danger"
  : value != null && value < 0 ? "text-success" : "text-muted-foreground";

function timestamp(value: string | null): string {
  if (!value) return "未知";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN");
}

export function MarketStockView({ snapshot, history }: Props) {
  const { instrument, quote } = snapshot;
  const fields = [
    { label: "现价", value: formatMarketPrice(quote.price, quote.currency), cls: pctColor(quote.change_pct) },
    { label: "涨跌幅", value: pct(quote.change_pct), cls: pctColor(quote.change_pct) },
    { label: "开盘", value: formatMarketPrice(quote.open, quote.currency) },
    { label: "最高", value: formatMarketPrice(quote.high, quote.currency) },
    { label: "最低", value: formatMarketPrice(quote.low, quote.currency) },
    { label: "昨收", value: formatMarketPrice(quote.previous_close, quote.currency) },
    { label: "交易币种", value: quote.currency },
    { label: "价格单位", value: quote.price_scale === 1 ? quote.currency : `${quote.source_price_unit} → ${quote.currency}` },
  ];

  return (
    <>
      <GlassCard glow className="mb-4">
        <div className="mb-4 flex flex-wrap items-baseline gap-2">
          <h2 className="text-xl font-bold">{instrument.name}</h2>
          <span className="font-mono text-sm text-muted-foreground">{instrument.provider_symbol}</span>
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">{instrument.mic}</span>
          <span className="ml-auto text-xs text-muted-foreground">{instrument.exchange} · {instrument.country}</span>
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
          <span className="flex items-center gap-1"><Database className="h-3 w-3" /> 数据源 {quote.source}</span>
          <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" /> 行情时间 {timestamp(quote.observed_at)}</span>
          <span>抓取时间 {timestamp(quote.fetched_at)}</span>
          <span className="font-mono">{instrument.instrument_id}</span>
        </div>
      </GlassCard>

      <GlassCard className="mb-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-primary" /> 日线行情 · {history.range}
        </h3>
        <p className="mb-2 text-[11px] text-muted-foreground/60">价格已统一为 {quote.currency}；缺失值不会填成零。拖动底部区间可缩放。</p>
        <PriceHistoryChart bars={history.bars} currency={quote.currency} />
      </GlassCard>

      <p className="text-xs text-muted-foreground/60">
        美股/欧洲行情来自 Yahoo chart 数据源，仅限个人研究使用 · 公告、监管文件和个股新闻源尚未接入；缺失项不会由 AI 猜测。
      </p>
    </>
  );
}
