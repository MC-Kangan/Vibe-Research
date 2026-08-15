import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/lib/ndjson.ts", import.meta.url), "utf8");

test("structured API validation errors are rendered as readable messages", () => {
  assert.match(source, /function errorDetailMessage/);
  assert.match(source, /Array\.isArray\(detail\)/);
  assert.match(source, /typeof item\.msg === "string"/);
  assert.doesNotMatch(source, /new ApiError\(detail\?\.detail \|\|/);
});
