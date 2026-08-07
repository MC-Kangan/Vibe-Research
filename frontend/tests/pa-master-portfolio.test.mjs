import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/portfolio/PaMasterPortfolioPanel.tsx", import.meta.url),
  "utf8",
);

test("PA Master ratios render as percentages", () => {
  assert.match(source, /const fmtPercent/);
  assert.match(source, /fmtPercent\(value\)/);
  assert.match(source, /fmtPercent\(item\.portfolio_weight\)/);
  assert.doesNotMatch(source, /fmt\(item\.portfolio_weight/);
});

test("PA Master panel shows authoritative position freshness", () => {
  assert.match(source, /last_positions_refreshed_at/);
  assert.match(source, /Positions refreshed:/);
  assert.doesNotMatch(source, /Live read-only view/);
});
