export const EUROPEAN_SUFFIXES = [
  ".L", ".DE", ".F", ".AS", ".PA", ".BR", ".MI", ".MC", ".LS", ".SW",
  ".ST", ".CO", ".OL", ".HE", ".VI", ".IR", ".WA", ".PR", ".BD", ".IS",
] as const;

export type StockDataRoute = "a-share" | "market" | "global";

export function isAShareSymbol(symbol: string): boolean {
  return /^\d{6}$/.test(symbol.trim());
}

export function isEuropeanSymbol(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{0,18}\.[A-Z]{1,2}$/.test(normalized)
    && EUROPEAN_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function isUSSymbol(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  return /^[A-Z][A-Z0-9-]{0,9}$/.test(normalized)
    || /^[A-Z][A-Z0-9]{0,8}\.[A-Z]$/.test(normalized);
}

export function normalizeStockSymbol(symbol: string): string | null {
  const normalized = symbol.trim().toUpperCase();
  if (isAShareSymbol(normalized) || isEuropeanSymbol(normalized)) return normalized;
  const classShare = normalized.match(/^([A-Z][A-Z0-9]{0,8})\.([A-Z])$/);
  if (classShare) return `${classShare[1]}-${classShare[2]}`;
  return isUSSymbol(normalized) ? normalized : null;
}

export function isSupportedStockSymbol(symbol: string): boolean {
  return normalizeStockSymbol(symbol) !== null;
}

export function stockDataRoute(symbol: string): StockDataRoute {
  if (isAShareSymbol(symbol)) return "a-share";
  if (isEuropeanSymbol(symbol) || isUSSymbol(symbol)) return "market";
  return "global";
}

export function formatMarketPrice(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      minimumFractionDigits: value >= 100 ? 2 : 4,
      maximumFractionDigits: value >= 100 ? 2 : 4,
    }).format(value);
  } catch {
    return `${value.toFixed(value >= 100 ? 2 : 4)} ${currency}`;
  }
}
