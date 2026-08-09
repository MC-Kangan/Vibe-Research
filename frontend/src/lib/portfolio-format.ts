export const portfolioNumber = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const portfolioSigned = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${portfolioNumber(value)}`;

export const portfolioRatioPercent = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? "—" : `${portfolioNumber(value * 100)}%`;

export const portfolioValuePercent = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${portfolioNumber(value)}%`;

export const portfolioAiNumber = (value: number | null | undefined): string => portfolioNumber(value);

export const investmentProfileContext = (items: string[]): string =>
  items.length
    ? `投资目标与风险偏好（用户自述）：\n${items.map((item) => `- ${item}`).join("\n")}`
    : "投资目标与风险偏好：用户尚未设置。";

export const portfolioAiInstruction =
  "请先根据上述目标和风险偏好评估当前组合是否匹配，再分析集中度、流动性和主要风险，提出可能的调整方向与取舍；区分事实、推断和缺失信息，不要暗示已执行任何交易。";
