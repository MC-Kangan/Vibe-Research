export type AiWorkflowId =
  | "general"
  | "stock"
  | "portfolio"
  | "daily_review"
  | "intelligence"
  | "watchlist"
  | "sector";

export interface AiWorkflowInfo {
  label: { en: string; zh: string };
  purpose: { en: string; zh: string };
}

export const AI_WORKFLOWS: Record<AiWorkflowId, AiWorkflowInfo> = {
  general: { label: { en: "General research", zh: "通用研究" }, purpose: { en: "Use relevant Vibe data for the current page", zh: "按需调用当前页面相关的 Vibe 数据" } },
  stock: { label: { en: "Instrument research", zh: "个股研究" }, purpose: { en: "Use market-appropriate price, fundamental and event tools", zh: "按标的市场调用行情、基本面与事件工具" } },
  portfolio: { label: { en: "Portfolio analysis", zh: "组合分析" }, purpose: { en: "Review structure against holdings, goals and risk preferences", zh: "结合持仓、目标与风险偏好检查组合结构" } },
  daily_review: { label: { en: "Daily review", zh: "每日复盘" }, purpose: { en: "Organise cross-market performance, sentiment and important changes", zh: "整理跨市场表现、情绪与重要变化" } },
  intelligence: { label: { en: "Intelligence analysis", zh: "资讯分析" }, purpose: { en: "Extract events, sources and impact paths to verify", zh: "提炼事件、来源与待验证影响路径" } },
  watchlist: { label: { en: "Watchlist analysis", zh: "自选股分析" }, purpose: { en: "Compare instruments while preserving market conventions", zh: "跨标的比较并保留各自市场口径" } },
  sector: { label: { en: "Sector research", zh: "板块研究" }, purpose: { en: "Map value chains, sector evidence and research gaps", zh: "梳理产业链、板块数据与研究缺口" } },
};

export interface AiRuntimeMetadata {
  id: AiWorkflowId;
  label: string;
  purpose: string;
  mode: "controlled_tools" | "context_only";
  tools_enabled: boolean;
  tool_count: number;
  web_search: boolean;
  private_knowledge: boolean;
}
