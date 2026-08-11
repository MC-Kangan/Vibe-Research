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

test("API credentials are blocked on insecure non-loopback origins", () => {
  const llm = read("../src/lib/llm.ts");
  const agents = read("../src/lib/agents.ts");
  const settings = read("../src/pages/Settings.tsx");
  assert.match(llm, /window\.isSecureContext/);
  assert.match(llm, /\["localhost", "127\.0\.0\.1", "::1"\]/);
  assert.match(llm, /API mode requires HTTPS on a LAN address/);
  assert.match(agents, /apiCredentialsAllowedOnOrigin\(\)/);
  assert.match(settings, /apiCredentialsAllowedOnOrigin\(\)/);
});
