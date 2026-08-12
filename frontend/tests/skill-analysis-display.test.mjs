import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/components/market/SkillAnalysisPanel.tsx", import.meta.url), "utf8");

test("skill catalog renders the three reusable price-series reports", () => {
  assert.match(source, /function PriceSeriesReport/);
  assert.match(source, /return <PriceSeriesReport result=\{result\} \/>/);
  assert.doesNotMatch(source, /analyst === "worth-buy-stocks" \? <WorthBuyReport[^:]+: <MarkovReport/);
});

test("Markov, worth-buy, and generic skill metrics use two-decimal formatters", () => {
  assert.match(source, /number\.toFixed\(2\)/);
  assert.match(source, /\(number \* 100\)\.toFixed\(2\)/);
  assert.match(source, /formatSkillNumber\(values\.worth_buy_composite\)/);
  assert.match(source, /formatSkillNumber\(values\.markov_signal\)/);
  assert.match(source, /formatMetric\(item\.metric, item\.value\)/);
  assert.match(source, /formatCandlestickTooltip/);
  assert.match(source, /name: "Close"[^\n]+valueFormatter: \(value: unknown\) => formatSkillNumber\(value\)/);
  assert.match(source, /name: "Rolling return"[^\n]+valueFormatter: \(value: unknown\) => `\$\{formatSkillNumber\(value\)\}%`/);
});

test("financial skill reports remain canonical English across app locales", () => {
  assert.doesNotMatch(source, /useLocale/);
  assert.doesNotMatch(source, /SKILL_GUIDES_ZH/);
  assert.match(source, /const tr = \(english: string, _chinese: string\): string => english/);
  assert.match(source, /tr\("Skills analysis", "技能分析"\)/);
  assert.match(source, /tr\("Run analysis", "运行分析"\)/);
  assert.match(source, /tr\("Raw JSON", "原始 JSON"\)/);
  assert.doesNotMatch(source, /"volatility_regime_percentile", "on_balance_volume_trend_20"/);
});

test("every financial skill exposes an expandable interpretation guide", () => {
  for (const skill of [
    "fundamental",
    "filings",
    "worth-buy-stocks",
    "markov-method",
    "technical-basic",
    "risk-analysis",
    "volatility-regime",
  ]) assert.match(source, new RegExp(`"${skill}"\\s*:`));
  assert.match(source, /How to read this skill/);
  assert.match(source, /What it measures/);
  assert.match(source, /How to interpret it/);
  assert.match(source, /function ProviderEvidenceReport/);
});

test("price-series skills render purpose-built explanatory charts", () => {
  assert.match(source, /function PriceSeriesVisual/);
  assert.match(source, /Normalized technical indicators/);
  assert.match(source, /Risk magnitude comparison/);
  assert.match(source, /Volatility percentile/);
});

test("SEC-backed skills are gated by backend instrument capabilities", () => {
  assert.match(source, /skill\.name === "fundamental"/);
  assert.match(source, /capabilities\.includes\("sec-facts"\)/);
  assert.match(source, /skill\.name === "filings"/);
});

test("skills with unconfigured providers remain visible but cannot be selected", () => {
  assert.match(source, /disabled=\{skill\.available === false\}/);
  assert.match(source, /Provider required:/);
  assert.match(source, /skill\.missing_capabilities/);
});
