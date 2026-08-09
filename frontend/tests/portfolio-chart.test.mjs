import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/portfolio/RealPositionPanel.tsx", import.meta.url),
  "utf8",
);

test("IBKR refresh actions have one clear full-sync primary action", () => {
  assert.match(source, /onClick=\{refreshAll\}[^\n]+\{activeJob \? "同步中" : "同步 IBKR"\}/);
  assert.match(source, /onClick=\{refresh\}[^\n]+仅更新持仓<\/button>/);
  assert.doesNotMatch(source, /刷新当前 \+ 历史/);
});

test("portfolio candles use green for up and red for down", () => {
  assert.match(source, /color: "#22c55e", color0: "#ef4444", borderColor: "#22c55e", borderColor0: "#ef4444"/);
});

test("volume is displayed in millions and the cost label stays inside the chart", () => {
  assert.match(source, /\(bar\.volume \|\| 0\) \/ 1_000_000/);
  assert.match(source, /name: "成交量（百万）"/);
  assert.match(source, /position: "insideEndTop"/);
  assert.match(source, /right: 76/);
});

test("execution markers use outlined directional arrows distinct from candles", () => {
  assert.match(source, /name: "买入"[^\n]+symbol: "path:\/\/M0,-8 L8,8 L-8,8 Z"[^\n]+color: "#14b8a6"[^\n]+borderWidth: 2/);
  assert.match(source, /name: "卖出"[^\n]+symbol: "path:\/\/M0,8 L8,-8 L-8,-8 Z"[^\n]+color: "#f97316"[^\n]+borderWidth: 2/);
  assert.doesNotMatch(source, /symbolRotate/);
});

test("AI position context requires exchange-aware provider symbols", () => {
  assert.match(source, /查询实时价格时必须使用下方“行情代码”/);
  assert.match(source, /instrument\?\.provider_symbol/);
  assert.match(source, /交易所\$\{item\.venue/);
});
