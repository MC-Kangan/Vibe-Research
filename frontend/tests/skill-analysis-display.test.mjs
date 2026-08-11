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
