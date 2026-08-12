import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("English is the default and the selected locale is persisted", () => {
  const i18n = read("../src/lib/i18n.tsx");
  const localeState = read("../src/lib/locale-state.ts");
  const html = read("../index.html");
  assert.match(localeState, /storageGet\(LOCALE_KEY\) === "zh-CN" \? "zh-CN" : "en"/);
  assert.match(i18n, /setCurrentLocale\(next\)/);
  assert.match(localeState, /storageSet\(LOCALE_KEY, locale\)/);
  assert.match(i18n, /document\.documentElement\.lang = locale/);
  assert.match(html, /<html lang="en">/);
});

test("language changes do not invalidate data-loader callback dependencies", () => {
  const i18n = read("../src/lib/i18n.tsx");
  assert.match(i18n, /const tr = useCallback\([^\n]+, \[\]\);/);
  assert.match(i18n, /translate\(getLocale\(\), english, chinese\)/);
});

test("the app shell exposes one global English and Chinese toggle", () => {
  const main = read("../src/main.tsx");
  const layout = read("../src/components/layout/Layout.tsx");
  assert.match(main, /<LocaleProvider>/);
  assert.match(layout, /setLocale\(locale === "en" \? "zh-CN" : "en"\)/);
  assert.match(layout, /中文/);
  assert.match(layout, /EN/);
});

test("all AI entry paths send the selected output locale", () => {
  const llm = read("../src/lib/llm.ts");
  const agents = read("../src/lib/agents.ts");
  assert.match(llm, /JSON\.stringify\(\{ workflow, messages, context, llm, locale \}\)/);
  assert.ok((agents.match(/locale: getLocale\(\)/g) || []).length >= 3);
});

test("Chinese dossier labels cover every canonical backend section title", () => {
  const backendDebate = read("../../backend/debate.py");
  const frontendDebate = read("../src/pages/Debate.tsx");
  const titles = [...backendDebate.matchAll(/^\s*\("query_[^"]+", \{.*?\}, "([^"]+)"/gm)].map((match) => match[1]);
  assert.ok(titles.length > 10);
  for (const title of titles) assert.match(frontendDebate, new RegExp(`"${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
});

test("high-traffic routes participate in the global locale", () => {
  for (const file of [
    "../src/pages/DailyReview.tsx",
    "../src/pages/Portfolio.tsx",
    "../src/pages/StockData.tsx",
    "../src/pages/Intel.tsx",
    "../src/pages/Watchlist.tsx",
    "../src/pages/Debate.tsx",
    "../src/pages/Settings.tsx",
  ]) {
    assert.match(read(file), /useLocale/);
  }
});

test("portfolio AI context remains canonical English", () => {
  const portfolio = read("../src/pages/Portfolio.tsx");
  const realPositions = read("../src/components/portfolio/RealPositionPanel.tsx");
  const watchlist = read("../src/pages/Watchlist.tsx");
  const formatting = read("../src/lib/portfolio-format.ts");
  assert.match(portfolio, /My locally recorded positions/);
  assert.match(realPositions, /Market-data validation/);
  assert.match(watchlist, /My local watchlist/);
  assert.doesNotMatch(watchlist, /我的自选股（本地）/);
  assert.match(formatting, /Investment objectives and risk preferences/);
});

test("English financial amounts use millions instead of Chinese hundred-millions", () => {
  const stockData = read("../src/pages/StockData.tsx");
  assert.match(stockData, /v \/ 1e6/);
  assert.match(stockData, /Million \$\{curOf\(market\)\}/);
  assert.match(stockData, /val\.mcap_yi \* 100, " Million CNY"/);
  assert.match(stockData, /locale === "en" \? 1e6 : 1e8/);
});

test("shared API failures and research uploads use the selected locale", () => {
  const api = read("../src/lib/api.ts");
  const backend = read("../../backend/api/ai_routes.py");
  assert.match(api, /translate\(getLocale\(\), "Cannot reach the backend/);
  assert.match(api, /API_ERROR_MESSAGES/);
  assert.match(api, /invalid_stock_symbol:/);
  assert.match(api, /payload\?\.code/);
  assert.match(api, /files, locale: getLocale\(\)/);
  assert.match(backend, /exc\.localized\(request\.locale\)/);
});

test("shared number formatting follows the active locale", () => {
  const marketSymbols = read("../src/lib/market-symbols.ts");
  const portfolioFormatting = read("../src/lib/portfolio-format.ts");
  assert.match(marketSymbols, /Intl\.NumberFormat\(getLocale\(\)/);
  assert.match(portfolioFormatting, /toLocaleString\(getLocale\(\)/);
  assert.doesNotMatch(marketSymbols, /Intl\.NumberFormat\("zh-CN"/);
  assert.doesNotMatch(portfolioFormatting, /toLocaleString\("zh-CN"/);
});
