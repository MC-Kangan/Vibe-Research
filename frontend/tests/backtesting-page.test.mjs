import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/pages/Backtesting.tsx", import.meta.url), "utf8");
const router = readFileSync(new URL("../src/router.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");

test("backtesting playground uses the dedicated typed endpoint", () => {
  assert.match(router, /path: "\/backtesting"/);
  assert.match(api, /runBacktest/);
  assert.match(api, /"\/research\/backtest"/);
  assert.match(page, /api\.runBacktest/);
});

test("backtesting defaults and boundaries remain explicit", () => {
  assert.match(page, /useState\(1000\)/);
  assert.match(page, /useState\(1\)/);
  assert.match(page, /minimum_holding_days/);
  assert.match(page, /Advanced assumptions and strategy parameters/);
  assert.match(page, /sma_crossover/);
  assert.match(page, /macd_crossover/);
  assert.match(page, /rsi_mean_reversion/);
  assert.match(page, /markov_regime/);
  assert.match(page, /min_train: 200/);
  assert.match(page, /USD-quoted US stocks and crypto only/);
  assert.match(api, /payload\?\.code === "backtest_input_invalid"/);
});

test("backtest charts display fills, indicators, equity, and open positions", () => {
  assert.match(page, /markPoint/);
  assert.match(page, /indicator_series/);
  assert.match(page, /Equity and drawdown/);
  assert.match(page, /open_position/);
  assert.equal((page.match(/legend: \{ type: "scroll", top: 4/g) || []).length, 3);
  assert.equal((page.match(/top: 64/g) || []).length, 3);
});
