import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { MarketHistoricalBar } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

interface Props {
  bars: MarketHistoricalBar[];
  currency: string;
}

export function PriceHistoryChart({ bars, currency }: Props) {
  const { locale, tr } = useLocale();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = echarts.init(host);
    const completeBars = bars.filter((bar) =>
      bar.open != null && bar.high != null && bar.low != null && bar.close != null,
    );
    const dates = completeBars.map((bar) => bar.date);
    const candleData = completeBars.map((bar) => [bar.open!, bar.close!, bar.low!, bar.high!]);
    const volumeData = completeBars.map((bar) => bar.volume ?? null);

    chart.setOption({
      animation: false,
      tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
      legend: { data: [`${tr("Price", "价格")} (${currency})`, tr("Volume", "成交量")], textStyle: { color: "#94a3b8" } },
      grid: [
        { left: 58, right: 18, top: 42, height: "58%" },
        { left: 58, right: 18, top: "76%", height: "14%" },
      ],
      xAxis: [
        { type: "category", data: dates, boundaryGap: true, axisLabel: { color: "#94a3b8", hideOverlap: true }, axisLine: { lineStyle: { color: "#334155" } } },
        { type: "category", gridIndex: 1, data: dates, boundaryGap: true, axisLabel: { show: false }, axisLine: { lineStyle: { color: "#334155" } } },
      ],
      yAxis: [
        { scale: true, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "rgba(148,163,184,0.12)" } } },
        { gridIndex: 1, scale: true, axisLabel: { color: "#94a3b8", formatter: (value: number) => Intl.NumberFormat(locale, { notation: "compact" }).format(value) }, splitLine: { show: false } },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1], start: 35, end: 100 },
        { type: "slider", xAxisIndex: [0, 1], bottom: 0, height: 18, borderColor: "transparent", textStyle: { color: "#94a3b8" } },
      ],
      series: [
        {
          name: `${tr("Price", "价格")} (${currency})`, type: "candlestick", data: candleData,
          itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e" },
        },
        { name: tr("Volume", "成交量"), type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: volumeData, itemStyle: { color: "rgba(243,93,43,0.45)" } },
      ],
    });

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => chart.resize());
    observer?.observe(host);
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [bars, currency, locale, tr]);

  if (!bars.length) {
    return <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">{tr("No price history", "暂无历史行情")}</div>;
  }
  return <div ref={hostRef} className="h-[420px] w-full" role="img" aria-label={tr("Daily price and volume chart", "日线价格与成交量图")} />;
}
