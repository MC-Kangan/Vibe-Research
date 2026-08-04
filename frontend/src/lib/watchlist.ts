// 关注股票（自选股）—— 只存本地 localStorage，不上传、不进仓库。

import { normalizeStockSymbol } from "@/lib/market-symbols";

const KEY = "vr-watchlist";

export function loadWatch(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v)
      ? Array.from(new Set(v.map((c) => typeof c === "string" ? normalizeStockSymbol(c) : null).filter((c): c is string => Boolean(c))))
      : [];
  } catch {
    return [];
  }
}

export function saveWatch(codes: string[]) {
  // localStorage 在隐私模式 / 嵌入式浏览器 / 配额写满时会抛异常。
  // 存不下就算了——自选丢失总好过整页崩掉（读取侧同样是 try/catch 兜底）。
  try {
    localStorage.setItem(KEY, JSON.stringify(codes));
  } catch {
    /* 存储不可用：本次会话内仍可正常使用，只是关掉页面后不保留 */
  }
}

// 按常见分隔符批量解析；欧洲股票必须保留 Yahoo 交易所后缀。
export function parseSymbols(raw: string): string[] {
  const tokens = raw.split(/[\s,，;；、]+/).filter(Boolean);
  return Array.from(new Set(tokens.map(normalizeStockSymbol).filter((c): c is string => Boolean(c))));
}

// 保留旧导出，避免外部调用方断裂。
export const parseCodes = parseSymbols;

// 把用户输入的一串代码并入已有自选，返回去重后的新列表 + 实际新增数量。
export function addCodes(existing: string[], raw: string): { next: string[]; added: number } {
  const incoming = parseSymbols(raw).filter((c) => !existing.includes(c));
  return { next: [...existing, ...incoming], added: incoming.length };
}
