"""系统 AI 对话层 —— function calling 循环（OpenAI 兼容）。

让网页内置 AI 在回答时自己调跨市场数据工具（查行情/估值/研报/新闻），
拿到客观数据再作答。兼容豆包 / DeepSeek / 任意 OpenAI 兼容端点。

合规：工具只返回客观数据；system prompt 强制中立——不荐股、不预测涨跌、
不给买卖时机，只做信息整理与多视角分析。结论由用户配置的模型给出。
"""

from __future__ import annotations

import ipaddress
import json
import os
import socket
from urllib.parse import urlparse

import requests

import ai_workflows
import cli_runtime
import tools

_TOOL_RESULT_CAP = 6000  # 单次工具结果注入上限（控 token）


def output_language_instruction(cfg: dict) -> str:
    locale = str(cfg.get("_locale", "en"))
    language = "Simplified Chinese" if locale == "zh-CN" else "English"
    return (
        f"Write all user-facing prose in {language}. Preserve ticker symbols, "
        "financial identifiers, quoted source titles and raw field names where accuracy requires it."
    )


def localized_text(cfg: dict, english: str, chinese: str) -> str:
    return chinese if str(cfg.get("_locale", "en")) == "zh-CN" else english


def _localized_messages(cfg: dict, messages: list) -> list:
    instruction = output_language_instruction(cfg)
    localized = [dict(message) for message in messages]
    for message in localized:
        if message.get("role") == "system":
            message["content"] = f"{message.get('content', '')}\n\nOutput language:\n{instruction}"
            return localized
    return [{"role": "system", "content": instruction}, *localized]


# —— 防 SSRF：用户可自带 OpenAI 兼容端点，但后端替其发请求前要挡住指向云元数据/内网的地址 ——
_PUBLIC_MODE = bool(os.environ.get("VR_API_KEY", "").strip())  # 设了鉴权≈公网部署姿态
_METADATA_NETS = [ipaddress.ip_network("169.254.0.0/16"), ipaddress.ip_network("fe80::/10")]
_PRIVATE_NETS = [ipaddress.ip_network(n) for n in
                 ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "::1/128", "fc00::/7")]


def _ip_blocked(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False  # 非字面 IP（域名）——交给 _check_base_url 决定是否解析核对
    if any(ip in n for n in _METADATA_NETS):  # 云元数据 / 链路本地：SSRF 头号目标，始终禁
        return True
    if _PUBLIC_MODE and any(ip in n for n in _PRIVATE_NETS):  # 公网姿态再禁内网 / 本机
        return True
    return False


def _check_base_url(url: str) -> None:
    """挡住把用户自带 baseURL 指向云元数据 / 内网的 SSRF。
    本地单用户（未设 VR_API_KEY）放行 127.0.0.1 等本机地址（方便接本机 Ollama / 网关），只挡 169.254 元数据；
    公网部署（设了 VR_API_KEY）额外禁内网，并解析域名核对，防 DNS 指向内网。"""
    p = urlparse(url or "")
    if p.scheme not in ("http", "https"):
        raise RuntimeError("Base URL 必须以 http:// 或 https:// 开头")
    host = p.hostname or ""
    if not host:
        raise RuntimeError("Base URL 缺少主机名")
    if _ip_blocked(host):
        raise RuntimeError("Base URL 指向了不允许的地址（云元数据 / 内网）")
    if _PUBLIC_MODE:  # 公网姿态：域名也解析核对，防 DNS rebinding 指向内网
        try:
            infos = socket.getaddrinfo(host, None)
        except socket.gaierror as e:
            raise RuntimeError("Base URL 域名无法解析") from e
        for info in infos:
            if _ip_blocked(info[4][0]):
                raise RuntimeError("Base URL 解析到了不允许的内网地址")


def _call_llm(cfg: dict, messages: list, use_tools: bool, tool_defs: list[dict] | None = None) -> dict:
    _check_base_url(cfg.get("baseURL", ""))
    base = cfg["baseURL"].rstrip("/")
    if not base.endswith(("/v1", "/v3", "/api/v3")):
        # 多数 OpenAI 兼容端点需要 /v1；已带版本段则不动。
        base = base + "/v1"
    payload = {"model": cfg["model"], "messages": _localized_messages(cfg, messages), "temperature": 0.3}
    if use_tools:
        payload["tools"] = tool_defs or []
        payload["tool_choice"] = "auto"
    r = requests.post(
        f"{base}/chat/completions",
        headers={"Authorization": f"Bearer {cfg['apiKey']}", "Content-Type": "application/json"},
        json=payload,
        timeout=90,
    )
    if r.status_code != 200:
        raise RuntimeError(f"模型接口 HTTP {r.status_code}: {r.text[:300]}")
    return r.json()


# ---------------------------------------------------------------------------
# 流式版：yield 事件字典 {type: tool|delta|done|error}，供 /api/chat 以 NDJSON 推给前端
# ---------------------------------------------------------------------------

def _resolve_base(cfg: dict) -> str:
    base = cfg["baseURL"].rstrip("/")
    if not base.endswith(("/v1", "/v3", "/api/v3")):
        base = base + "/v1"
    return base


def _call_llm_stream(cfg: dict, messages: list, use_tools: bool, tool_defs: list[dict] | None = None):
    _check_base_url(cfg.get("baseURL", ""))
    payload = {"model": cfg["model"], "messages": _localized_messages(cfg, messages), "temperature": 0.3, "stream": True}
    if use_tools:
        payload["tools"] = tool_defs or []
        payload["tool_choice"] = "auto"
    r = requests.post(
        f"{_resolve_base(cfg)}/chat/completions",
        headers={"Authorization": f"Bearer {cfg['apiKey']}", "Content-Type": "application/json"},
        json=payload, timeout=120, stream=True,
    )
    if r.status_code != 200:
        raise RuntimeError(f"模型接口 HTTP {r.status_code}: {r.text[:300]}")
    return r


def _iter_sse_deltas(resp):
    """解析上游 SSE 流，逐个 yield choices[0].delta。

    按字节缓冲、只解码「完整行」——`\\n` 是 ASCII(0x0A)不会落在多字节 UTF-8 字符内部，
    故按 `\\n` 切分再解码，避免 iter_lines(decode_unicode=True) 在网络分块处切断中文导致乱码。
    """
    buf = b""
    for chunk in resp.iter_content(chunk_size=None):
        if not chunk:
            continue
        buf += chunk
        while b"\n" in buf:
            raw, buf = buf.split(b"\n", 1)
            line = raw.decode("utf-8", errors="replace").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                return
            try:
                j = json.loads(data)
            except json.JSONDecodeError:
                continue
            choices = j.get("choices") or []
            if choices:
                yield choices[0].get("delta") or {}


def run_chat_stream(cfg: dict, user_messages: list, context: str, workflow_id: str):
    """API 接入流式：function-calling 循环，边流答案边推工具调用事件。"""
    profile = ai_workflows.get_workflow(workflow_id)
    tool_defs = ai_workflows.tool_definitions(profile)
    allowed_tools = set(profile.tool_names)
    yield {"type": "meta", "workflow": profile.public_metadata(str(cfg.get("provider", "")))}
    messages = [{"role": "system", "content": profile.system_prompt(context)}]
    messages.extend(user_messages)
    trace: list[dict] = []

    for rnd in range(1, profile.max_rounds + 1):
        resp = _call_llm_stream(cfg, messages, use_tools=bool(tool_defs), tool_defs=tool_defs)
        content_parts: list[str] = []
        tool_acc: dict[int, dict] = {}
        for delta in _iter_sse_deltas(resp):
            if delta.get("content"):
                content_parts.append(delta["content"])
                yield {"type": "delta", "text": delta["content"]}
            for tc in (delta.get("tool_calls") or []):
                idx = tc.get("index")
                if idx is None:
                    # 非标「OpenAI 兼容」网关可能不带 index：有 id 按 id 归位（新 id 开新槽），
                    # 无 id 则续拼最后一个调用，避免多个调用的 arguments 串到一起
                    tc_id = tc.get("id") or ""
                    idx = next((k for k, v in tool_acc.items() if tc_id and v["id"] == tc_id), None)
                    if idx is None:
                        idx = len(tool_acc) if (tc_id or not tool_acc) else max(tool_acc)
                acc = tool_acc.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                if tc.get("id"):
                    acc["id"] = tc["id"]
                fn = tc.get("function") or {}
                if fn.get("name"):
                    acc["name"] = fn["name"]
                if fn.get("arguments"):
                    acc["arguments"] += fn["arguments"]

        if not tool_acc:  # 本轮是纯答案（已流完）→ 结束
            yield {"type": "done", "trace": trace, "rounds": rnd}
            return

        # 有工具调用：回填 assistant 消息 + 执行工具 + 推事件
        messages.append({
            "role": "assistant",
            "content": "".join(content_parts) or None,
            "tool_calls": [{
                "id": tool_acc[i]["id"], "type": "function",
                "function": {"name": tool_acc[i]["name"], "arguments": tool_acc[i]["arguments"]},
            } for i in sorted(tool_acc)],
        })
        for i in sorted(tool_acc):
            a = tool_acc[i]
            try:
                args = json.loads(a["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            if a["name"] in allowed_tools:
                yield {"type": "tool", "tool": a["name"], "args": args}
                result = tools.exec_tool(a["name"], args)
                trace.append({"tool": a["name"], "args": args})
            else:
                result = {"error": f"工具 {a['name']} 未获当前工作流授权"}
            messages.append({
                "role": "tool", "tool_call_id": a["id"],
                "content": json.dumps(result, ensure_ascii=False)[:_TOOL_RESULT_CAP],
            })

    # 超过最大轮数：不带工具收尾（非流式一次拿完再吐）
    data = _call_llm(cfg, messages, use_tools=False)
    yield {"type": "delta", "text": data["choices"][0]["message"].get("content") or ""}
    yield {"type": "done", "trace": trace, "rounds": profile.max_rounds}


def run_chat_cli_stream(cfg: dict, user_messages: list, context: str, workflow_id: str):
    """订阅接入流式：CLI stdout 边出边推 delta。"""
    provider = str(cfg.get("provider", ""))
    kind = provider[4:] if provider.startswith("cli-") else provider
    profile = ai_workflows.get_workflow(workflow_id)
    yield {"type": "meta", "workflow": profile.public_metadata(provider)}
    system = f"{profile.system_prompt(context, tools_available=False)}\n\n{output_language_instruction(cfg)}"
    user = "\n\n".join(m.get("content", "") for m in user_messages if m.get("content")) or "(no question)"
    for chunk in cli_runtime.run_cli_stream(kind, system, user):
        yield {"type": "delta", "text": chunk}
    yield {"type": "done", "trace": [], "rounds": 1}
