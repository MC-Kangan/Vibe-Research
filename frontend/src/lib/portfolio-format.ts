import { getLocale } from "./locale-state.ts";

export const portfolioNumber = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const portfolioSigned = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${portfolioNumber(value)}`;

export const portfolioRatioPercent = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? "—" : `${portfolioNumber(value * 100)}%`;

export const portfolioValuePercent = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${portfolioNumber(value)}%`;

export const portfolioAiNumber = (value: number | null | undefined): string => portfolioNumber(value);

export const investmentProfileContext = (items: string[]): string =>
  items.length
    ? `Investment objectives and risk preferences (user-provided):\n${items.map((item) => `- ${item}`).join("\n")}`
    : "Investment objectives and risk preferences: not configured.";

export const portfolioAiInstruction =
  "First assess whether the portfolio matches the stated objectives and risk preferences. Then analyze concentration, liquidity, and key risks, and explain possible adjustments and trade-offs. Separate facts, inferences, and missing information, and never imply that a trade was executed.";
