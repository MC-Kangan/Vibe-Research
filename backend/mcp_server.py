"""Vibe-Research MCP server —— 把统一只读数据工具暴露给外部 agent。

传输层使用标准库 JSON-RPC over stdio，工具定义和执行统一复用 tools.py。
这是独立的高级入口；网页内 AI 仍按 ai_workflows.py 的白名单运行。

挂进 Claude Code：
    claude mcp add vibe-research -- /路径/backend/.venv/bin/python /路径/backend/mcp_server.py

合规：工具只返回客观数据，不含建议；判断由调用方 agent 给出。
"""

from __future__ import annotations

import json
import sys

import tools

SERVER_INFO = {"name": "vibe-research", "version": "0.3.0"}
DEFAULT_PROTOCOL = "2024-11-05"

# 把统一工具注册表（OpenAI 格式）转成 MCP 的 {name, description, inputSchema}
MCP_TOOLS = [
    {
        "name": t["function"]["name"],
        "description": t["function"]["description"],
        "inputSchema": t["function"]["parameters"],
    }
    for t in tools.TOOLS
]


def _send(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _result(rid, result) -> None:
    _send({"jsonrpc": "2.0", "id": rid, "result": result})


def _error(rid, code: int, message: str) -> None:
    _send({"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}})


def _handle(msg: dict) -> None:
    method = msg.get("method")
    rid = msg.get("id")

    # 通知（无 id）不回响应
    if method == "notifications/initialized":
        return

    if method == "initialize":
        params = msg.get("params") or {}
        proto = params.get("protocolVersion", DEFAULT_PROTOCOL)
        _result(rid, {
            "protocolVersion": proto,
            "capabilities": {"tools": {}},
            "serverInfo": SERVER_INFO,
        })
        return

    if method == "ping":
        _result(rid, {})
        return

    if method == "tools/list":
        _result(rid, {"tools": MCP_TOOLS})
        return

    if method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name", "")
        args = params.get("arguments") or {}
        data = tools.exec_tool(name, args)
        is_error = isinstance(data, dict) and "error" in data
        _result(rid, {
            "content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}],
            "isError": is_error,
        })
        return

    if rid is not None:
        _error(rid, -32601, f"未知方法：{method}")


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            _handle(msg)
        except Exception as e:  # noqa: BLE001 — 单条消息出错不拖垮 server
            if msg.get("id") is not None:
                _error(msg["id"], -32603, f"内部错误：{e}")


if __name__ == "__main__":
    main()
