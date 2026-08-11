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

test("position preferences are optional and transparently previewed", () => {
  assert.match(debatePage, /includePreferences/);
  assert.match(agents, /include_position_preferences/);
  assert.match(debatePage, /未包含/);
  assert.match(debatePage, /preferences\.items\.map/);
  assert.match(debatePage, /投资目标与风险偏好/);
});

test("pre-run guidance distinguishes automatic data from useful uploads", () => {
  assert.match(debatePage, /Vibe 会自动获取/);
  assert.match(debatePage, /建议补充/);
  assert.match(debatePage, /不要上传 API key/);
});

test("approved TradeAgent skills are selected once and sent to both research modes", () => {
  assert.match(debatePage, /selectedResearchSkills/);
  assert.match(debatePage, /只计算一次/);
  assert.match(debatePage, /共享底稿/);
  assert.match(agents, /research_skills: researchSkills/);
  assert.match(agents, /research_skill_parameters: researchSkillParameters/);
});

test("skill defaults are persisted but remain optional per run", () => {
  assert.match(debatePage, /researchSkillDefaults/);
  assert.match(debatePage, /saveResearchSkillDefaults/);
  assert.match(debatePage, /将当前选择设为默认/);
  assert.match(debatePage, /默认技能只会预先勾选，不会被强制运行/);
  assert.match(debatePage, /未选择的技能不会运行/);
  assert.doesNotMatch(debatePage, /Promise\.all\(\[api\.researchSkills\(\), api\.researchSkillDefaults\(\)\]\)/);
  assert.match(debatePage, /请重启 Vibe 后端以启用默认技能保存/);
});
