import { useEffect, useRef } from "react";
import { init } from "@/lib/echarts";

export function EChart({
  option,
  label,
  className = "h-64",
}: {
  option: Record<string, any>;
  label: string;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const chart = init(host.current);
    chart.setOption({ animation: false, backgroundColor: "transparent", ...option });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [option]);
  return <div ref={host} className={`${className} w-full`} role="img" aria-label={label} />;
}
