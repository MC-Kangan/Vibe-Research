import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const daily = readFileSync(new URL("../src/pages/DailyReview.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../src/pages/StockData.tsx", import.meta.url), "utf8");
const portfolio = readFileSync(new URL("../src/pages/Portfolio.tsx", import.meta.url), "utf8");
const cryptoPortfolio = readFileSync(new URL("../src/components/portfolio/CryptoPortfolioPanel.tsx", import.meta.url), "utf8");
const debate = readFileSync(new URL("../src/pages/Debate.tsx", import.meta.url), "utf8");

test("crypto is a first-class selectable daily-review market", () => {
  assert.match(daily, /option value="Crypto">加密市场/);
  assert.match(daily, /api\.cryptoOverview\(\)/);
});

test("instrument data and debate use explicit asset selection", () => {
  assert.match(detail, /股票.*加密货币/s);
  assert.match(detail, /api\.marketSnapshot\(c, "crypto"\)/);
  assert.match(debate, /assetType === "crypto"/);
});

test("portfolio exposes overview stock and crypto top-level tabs", () => {
  assert.match(portfolio, /\['overview', '总览'\]/);
  assert.match(portfolio, /\['stocks', '股票'\]/);
  assert.match(portfolio, /\['crypto', '加密货币'\]/);
});

test("manual crypto CSV renders validated rows before commit", () => {
  assert.match(cryptoPortfolio, /preview\.map/);
  assert.match(cryptoPortfolio, /钱包.*资产.*数量.*单位成本.*成本币种/s);
});
