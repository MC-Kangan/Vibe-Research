import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overview = readFileSync(new URL("../src/components/portfolio/PortfolioOverview.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/components/portfolio/PortfolioResearchPanel.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
const sharedChart = readFileSync(new URL("../src/components/ui/EChart.tsx", import.meta.url), "utf8");

test("portfolio overview exposes the portfolio-scoped research panel", () => {
  assert.match(overview, /PortfolioResearchPanel/);
  assert.match(panel, /Correlation analysis/);
  assert.match(panel, /Asset allocation/);
});

test("portfolio research visualizes the matrix and allocation scenario", () => {
  assert.match(panel, /Correlation heatmap/);
  assert.match(panel, /Scenario weights/);
  assert.match(panel, /Risk contribution/);
  assert.match(panel, /How to read these skills/);
  assert.match(panel, /Portfolio source gaps/);
  assert.match(panel, /item\.limitations/);
  assert.match(panel, /components\/ui\/EChart/);
  assert.match(sharedChart, /from "@\/lib\/echarts"/);
  assert.match(sharedChart, /const chart = init\(host\.current\)/);
  assert.doesNotMatch(sharedChart, /import \* as echarts/);
  assert.doesNotMatch(panel, /useLocale/);
  assert.match(panel, /const tr = \(english: string, _chinese: string\): string => english/);
});

test("portfolio research uses its additive API instead of the single-symbol route", () => {
  assert.match(api, /portfolioResearchCandidates/);
  assert.match(api, /runPortfolioResearch/);
  assert.match(api, /\/research\/portfolio\/run/);
  assert.match(api, /PortfolioResearchUniverse/);
});
