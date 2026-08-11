import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layout = readFileSync(new URL("../src/components/layout/Layout.tsx", import.meta.url), "utf8");
const portfolio = readFileSync(new URL("../src/components/portfolio/RealPositionPanel.tsx", import.meta.url), "utf8");

test("mobile uses an accessible overlay drawer instead of a crowded bottom navigation", () => {
  assert.match(layout, /mobileOpen \? "translate-x-0" : "-translate-x-\[calc\(100%\+1rem\)\]"/);
  assert.match(layout, /aria-controls="app-navigation"/);
  assert.match(layout, /aria-expanded=\{mobileOpen\}/);
  assert.match(layout, /aria-label=\{tr\("Close navigation", "关闭导航菜单"\)\}/);
  assert.match(layout, /event\.key === "Escape"/);
  assert.doesNotMatch(layout, /overflow-x-auto/);
});

test("desktop sidebar can fully hide and expands the analysis canvas", () => {
  assert.match(layout, /md:w-0[^\n]+md:opacity-0[^\n]+md:pointer-events-none/);
  assert.match(layout, /aria-label=\{tr\("Show sidebar", "显示侧栏"\)\}/);
  assert.match(layout, /collapsed \? "max-w-\[1440px\]" : "max-w-6xl"/);
});

test("portfolio chart and controls adapt to narrow phone widths", () => {
  assert.match(portfolio, /clientWidth < 520/);
  assert.match(portfolio, /left: 42, right: 14/);
  assert.match(portfolio, /h-\[360px\][^\n]+sm:h-\[430px\]/);
  assert.match(portfolio, /min-w-0 flex-1[^\n]+sm:w-40/);
});
