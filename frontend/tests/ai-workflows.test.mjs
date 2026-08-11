import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("every Ask AI entry point declares a controlled workflow", () => {
  const files = [
    "../src/pages/Portfolio.tsx",
    "../src/pages/DailyReview.tsx",
    "../src/pages/Watchlist.tsx",
    "../src/pages/StockData.tsx",
    "../src/pages/SectorDetail.tsx",
    "../src/components/portfolio/RealPositionPanel.tsx",
  ];
  for (const file of files) {
    const source = read(file);
    const entries = [...source.matchAll(/<AskAiButton\b[\s\S]*?\/>/g)];
    assert.ok(entries.length > 0, `${file} should contain an AskAiButton`);
    for (const entry of entries) assert.match(entry[0], /workflow="[a-z_]+"/);
  }
});

test("AI client sends workflow and exposes runtime capability metadata", () => {
  const llm = read("../src/lib/llm.ts");
  const panel = read("../src/components/ui/AskAiButton.tsx");
  assert.match(llm, /JSON\.stringify\(\{ workflow, messages, context, llm, locale \}\)/);
  assert.match(llm, /ev\.type === "meta"/);
  assert.match(panel, /General web search disabled/);
  assert.match(panel, /Page context only/);
  assert.match(panel, /Controlled Vibe data tools/);
});
