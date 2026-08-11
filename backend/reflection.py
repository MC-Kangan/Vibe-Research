"""反思层 —— 对一段已经写好的分析做「推理审计」。

投研里最贵的错误不是算错数字，是**把推测当成了事实**、并在此之上继续推理。
这个模块不产出新观点，只回头审一遍已有的分析：哪些话有数据撑着、哪些是脑补、
一旦结论错了最可能错在哪一环、什么信号出现就说明它站不住。

产物是「怎么继续验证」，不是「结论对不对」——所以它天然不涉及荐股，
也正好补上「多空辩论」之后、「沉淀成研究记录」之前缺的那一步。
"""

from __future__ import annotations

import chat
import cli_runtime

MAX_SOURCE_CHARS = 12000  # 待审文本上限，超出截断（反思本身不该把上下文吃光）

REFLECT_PROMPT = """You are a rigorous **research auditor**. Audit the reasoning in the supplied investment analysis; do not rewrite it or decide whether its conclusion is correct.

Use five specific sections tied to the original text:
1. **Supported claims**: judgements genuinely grounded in specific data (quote the claim and identify its evidence).
2. **Unsupported claims**: speculation, analogy, convention or emotion presented as fact. Identify each original claim.
3. **Data-use issues**: wrong definitions, isolated figures without comparable periods or peers, survivorship bias, correlation treated as causation, or inconsistent dates. State "none found" when appropriate.
4. **Weakest link**: if the analysis proves wrong, what is the most likely failure point and why?
5. **Verification checklist**: 3-5 executable checks specifying the data, source and expected timing.

Mandatory:
- Do not add your own investment judgement, recommendation, target price or rating.
- Challenge plausible-sounding claims that lack evidence.
- Write concise bullets in the runtime-selected output language.
"""


def run_reflection_stream(cfg: dict, source: str, title: str = ""):
    """对一段分析做反思，yield NDJSON 事件（delta / done / error）。"""
    text = (source or "").strip()
    if not text:
        yield {"type": "error", "message": chat.localized_text(cfg, "There is no content to audit.", "没有可反思的内容")}
        return
    truncated = len(text) > MAX_SOURCE_CHARS
    if truncated:
        text = text[:MAX_SOURCE_CHARS]
        yield {"type": "status", "message": chat.localized_text(cfg, f"The source is long; auditing the first {MAX_SOURCE_CHARS} characters.", f"原文较长，已截取前 {MAX_SOURCE_CHARS} 字进行审计")}

    header = f"Analysis to audit{(': ' + title) if title else ''}:\n"
    messages = [
        {"role": "system", "content": REFLECT_PROMPT},
        {"role": "user", "content": header + text + "\n\nBegin the audit."},
    ]

    provider = str(cfg.get("provider", ""))
    buf: list[str] = []
    try:
        if provider.startswith("cli-"):
            system = f"{REFLECT_PROMPT}\n\n{chat.output_language_instruction(cfg)}"
            content = cli_runtime.run_cli(provider[4:], system, messages[-1]["content"])
            buf.append(content)
            yield {"type": "delta", "text": content}
        else:
            resp = chat._call_llm_stream(cfg, messages, use_tools=False)
            for delta in chat._iter_sse_deltas(resp):
                piece = delta.get("content")
                if piece:
                    buf.append(piece)
                    yield {"type": "delta", "text": piece}
    except Exception as e:  # noqa: BLE001 — 运行时错误以流内事件上报
        yield {"type": "error", "message": chat.localized_text(cfg, f"Audit failed: {e}", f"反思失败：{e}")}
        return

    yield {"type": "done", "content": "".join(buf).strip(), "truncated": truncated}
