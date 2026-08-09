import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layout = readFileSync(new URL("../src/components/layout/Layout.tsx", import.meta.url), "utf8");
const portfolio = readFileSync(new URL("../src/components/portfolio/RealPositionPanel.tsx", import.meta.url), "utf8");

test("mobile uses a bottom navigation instead of consuming the content width", () => {
  assert.match(layout, /flex h-\[100dvh\] flex-col md:flex-row/);
  assert.match(layout, /order-2[^\n]+md:order-none/);
  assert.match(layout, /overflow-x-auto[^\n]+md:block/);
  assert.match(layout, /pb-\[env\(safe-area-inset-bottom\)\]/);
});

test("portfolio chart and controls adapt to narrow phone widths", () => {
  assert.match(portfolio, /clientWidth < 520/);
  assert.match(portfolio, /left: 42, right: 14/);
  assert.match(portfolio, /h-\[360px\][^\n]+sm:h-\[430px\]/);
  assert.match(portfolio, /min-w-0 flex-1[^\n]+sm:w-40/);
});
