export type AiWorkflowId =
  | "general"
  | "stock"
  | "portfolio"
  | "daily_review"
  | "intelligence"
  | "watchlist"
  | "sector";

export interface AiWorkflowInfo {
  label: string;
  purpose: string;
}

export const AI_WORKFLOWS: Record<AiWorkflowId, AiWorkflowInfo> = {
  general: { label: "通用研究", purpose: "按需调用当前页面相关的 Vibe 数据" },
  stock: { label: "个股研究", purpose: "按标的市场调用行情、基本面与事件工具" },
  portfolio: { label: "组合分析", purpose: "结合持仓、目标与风险偏好检查组合结构" },
  daily_review: { label: "每日复盘", purpose: "整理跨市场表现、情绪与重要变化" },
  intelligence: { label: "资讯分析", purpose: "提炼事件、来源与待验证影响路径" },
  watchlist: { label: "自选股分析", purpose: "跨标的比较并保留各自市场口径" },
  sector: { label: "板块研究", purpose: "梳理产业链、板块数据与研究缺口" },
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
