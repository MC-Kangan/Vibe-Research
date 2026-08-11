import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contextTray = readFileSync(new URL("../src/components/research/ContextTray.tsx", import.meta.url), "utf8");
const debatePage = readFileSync(new URL("../src/pages/Debate.tsx", import.meta.url), "utf8");
const agents = readFileSync(new URL("../src/lib/agents.ts", import.meta.url), "utf8");

test("supplemental context works on LAN HTTP and bounds each upload batch", () => {
  assert.doesNotMatch(contextTray, /crypto\.randomUUID/);
  assert.match(contextTray, /nextContextId\(\)/);
  assert.match(contextTray, /25 \* 1024 \* 1024/);
  assert.doesNotMatch(contextTray, /Promise\.all\(/);
});

test("research output is only saveable after the server terminal event", () => {
  assert.match(agents, /case "done":\s*h\.onDone\?\.\(\)/);
  assert.match(debatePage, /const finished = completed &&/);
  assert.match(debatePage, /setCompleted\(true\)/);
});

test("position context preview exposes the actual saved preferences", () => {
  assert.match(debatePage, /preferences\.items\.map/);
  assert.match(debatePage, /投资目标与风险偏好/);
});
