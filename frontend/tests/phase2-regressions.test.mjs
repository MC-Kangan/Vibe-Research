import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const intelSource = readFileSync(new URL("../src/pages/Intel.tsx", import.meta.url), "utf8");
const dailyReviewSource = readFileSync(new URL("../src/pages/DailyReview.tsx", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("watchlist intelligence uses a stable loader dependency", () => {
  assert.match(intelSource, /const load = useCallback\(async \(cs: string\[\]\) =>/);
  assert.match(intelSource, /\}, \[kind\]\);\s+\n\s*useEffect\([^\n]+\[load\]\)/);
});

test("AI daily review receives breadth, movers, and sector proxies", () => {
  assert.match(dailyReviewSource, /Watchlist breadth \(not the full market\)/);
  assert.match(dailyReviewSource, /Largest watchlist moves/);
  assert.match(dailyReviewSource, /US sector ETF proxies/);
  assert.match(dailyReviewSource, /European sector ETF proxies/);
  assert.match(dailyReviewSource, /Cross-market overview \(watchlist breadth and sector ETF proxies/);
});

test("headline percentages are rounded and event probability is clearly planned", () => {
  assert.match(dailyReviewSource, /const pctText = .*toFixed\(2\)/);
  assert.match(dailyReviewSource, /\{pctText\(item\.change_pct\)\}/);
  assert.match(intelSource, /事件概率（规划中）/);
  assert.match(intelSource, /目前尚未接入任何市场/);
  assert.match(indexSource, /US, European, Chinese equities/);
});

test("daily review defaults to one selectable US market layout", () => {
  assert.match(dailyReviewSource, /useState<MarketFocus>\("US"\)/);
  assert.match(dailyReviewSource, /aria-label=\{tr\("Select review market", "选择复盘市场"\)\}/);
  assert.match(dailyReviewSource, /<option value="US">\{tr\("United States", "美国"\)\}<\/option>/);
  assert.match(dailyReviewSource, /<option value="Europe">\{tr\("Europe", "欧洲"\)\}<\/option>/);
  assert.match(dailyReviewSource, /<option value="CN">\{tr\("A-shares", "A股"\)\}<\/option>/);
  assert.match(dailyReviewSource, /api\.marketMood\(market\)/);
  assert.match(dailyReviewSource, /marketFocus === "CN" && <>/);
});
