import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

test("the existing markdown stack renders common AI response formatting", () => {
  const markdown = "## Risk\n\n- **High volatility**\n\n> Verify independently";
  const html = renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown),
  );

  assert.match(html, /<h2>Risk<\/h2>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<strong>High volatility<\/strong>/);
  assert.match(html, /<blockquote>/);
});

test("all AI markdown uses the consent-gated renderer", async () => {
  const paths = [
    "../src/components/ui/AskAiButton.tsx",
    "../src/pages/Debate.tsx",
    "../src/pages/Intel.tsx",
    "../src/pages/DailyReview.tsx",
    "../src/pages/Notes.tsx",
  ];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /import \{ SafeMarkdown \} from "@\/components\/ui\/SafeMarkdown";/);
    assert.doesNotMatch(source, /import ReactMarkdown from "react-markdown";/);
  }
});

test("the shared markdown renderer requires consent before remote images load", async () => {
  const source = await readFile(
    new URL("../src/components/ui/SafeMarkdown.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /import ReactMarkdown, \{ type Components \} from "react-markdown";/);
  assert.match(source, /import remarkGfm from "remark-gfm";/);
  assert.match(source, /isRemoteImage/);
  assert.match(source, /setApproved\(true\)/);
  assert.match(source, /referrerPolicy="no-referrer"/);
  assert.match(source, /components=\{MARKDOWN_COMPONENTS\}/);
});
