import assert from "node:assert/strict";
import test from "node:test";

import {
  formatMarketPrice,
  isEuropeanSymbol,
  isUSSymbol,
  normalizeStockSymbol,
} from "../src/lib/market-symbols.ts";

test("supported European suffixes are explicit and case-insensitive", () => {
  for (const symbol of ["VOD.L", "sap.de", "ASML.AS", "MC.PA", "NESN.SW", "ENI.MI", "NOVO-B.CO"]) {
    assert.equal(isEuropeanSymbol(symbol), true, symbol);
  }
  for (const symbol of ["VOD", "ABC.US", ".L", "BAD SYMBOL.L"]) {
    assert.equal(isEuropeanSymbol(symbol), false, symbol);
  }
});

test("US symbols and class shares normalize consistently", () => {
  assert.equal(isUSSymbol("aapl"), true);
  assert.equal(normalizeStockSymbol(" brk.b "), "BRK-B");
  assert.equal(normalizeStockSymbol("sap.de"), "SAP.DE");
  assert.equal(normalizeStockSymbol("BAD SYMBOL"), null);
});

test("normalized UK prices are formatted as GBP, never GBp", () => {
  const formatted = formatMarketPrice(1.1725, "GBP");
  assert.match(formatted, /1\.1725/);
  assert.doesNotMatch(formatted, /GBp/);
});

test("missing prices are shown honestly", () => {
  assert.equal(formatMarketPrice(null, "EUR"), "—");
});
