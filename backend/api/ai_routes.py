from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import ai_workflows
import chat as chat_layer
import cli_runtime
import debate as debate_layer
import market_data
import reflection as reflection_layer
import research_context
import research_team
from api.validation import validate_stock_symbol


router = APIRouter(prefix="/api", tags=["ai"])


class LLMConfig(BaseModel):
    provider: str = ""
    baseURL: str = ""
    apiKey: str = ""
    model: str


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=50_000)


class ChatReq(BaseModel):
    messages: list[ChatMessage] = Field(max_length=40)
    context: str = Field(default="", max_length=150_000)
    workflow: str = Field(max_length=32)
    locale: Literal["en", "zh-CN"] = "en"
    llm: LLMConfig


class ResearchContextIn(BaseModel):
    name: str = Field(max_length=160)
    content: str = Field(max_length=research_context.MAX_ITEM_CHARS)


SkillName = Literal[
    "worth-buy-stocks",
    "markov-method",
    "technical-basic",
    "risk-analysis",
    "volatility-regime",
]


class DebateReq(BaseModel):
    code: str
    rounds: int = 1
    asset_type: str = "equity"
    llm: LLMConfig
    locale: Literal["en", "zh-CN"] = "en"
    additional_contexts: list[ResearchContextIn] = Field(default_factory=list, max_length=research_context.MAX_ITEMS)
    research_skills: list[SkillName] = Field(default_factory=list, max_length=5)
    research_skill_parameters: dict[str, dict] = Field(default_factory=dict)


class ResearchFileIn(BaseModel):
    name: str = Field(max_length=160)
    content_b64: str = Field(max_length=14_100_000)


class ResearchFilesIn(BaseModel):
    files: list[ResearchFileIn] = Field(min_length=1, max_length=research_context.MAX_ITEMS)
    locale: Literal["en", "zh-CN"] = "en"


class ResearchTeamReq(BaseModel):
    code: str
    asset_type: Literal["equity", "crypto"] = "equity"
    llm: LLMConfig
    locale: Literal["en", "zh-CN"] = "en"
    additional_contexts: list[ResearchContextIn] = Field(default_factory=list, max_length=research_context.MAX_ITEMS)
    position_instrument_key: str | None = Field(default=None, max_length=64)
    include_position_preferences: bool = False
    research_skills: list[SkillName] = Field(default_factory=list, max_length=5)
    research_skill_parameters: dict[str, dict] = Field(default_factory=dict)


class ReflectReq(BaseModel):
    source: str
    title: str = ""
    llm: LLMConfig
    locale: Literal["en", "zh-CN"] = "en"


def locale_text(locale: str, english: str, chinese: str) -> str:
    return chinese if locale == "zh-CN" else english


def check_llm(llm: LLMConfig, locale: Literal["en", "zh-CN"] = "en") -> dict:
    if not llm.model:
        raise HTTPException(400, locale_text(locale, "Choose a model in AI Setup first.", "缺少模型配置，请先在「接入 AI」里选择"))
    if llm.provider.startswith("cli-"):
        kind = llm.provider[4:]
        if not cli_runtime.detect_cli(kind):
            raise HTTPException(400, locale_text(locale, f"The local {kind} command was not found. Install and authenticate it, or use API access.", f"未检测到「{kind}」对应的本机命令。请先安装并登录该 CLI，或改用「API 接入」。"))
    elif not llm.apiKey or not llm.baseURL:
        raise HTTPException(400, locale_text(locale, "Enter a Base URL and API key in AI Setup.", "缺少 Base URL 或 API Key，请先在「接入 AI」里填写"))
    cfg = llm.model_dump()
    cfg["_locale"] = locale
    return cfg


def ndjson(events):
    def generate():
        try:
            for event in events():
                yield json.dumps(event, ensure_ascii=False) + "\n"
        except Exception as exc:  # noqa: BLE001
            yield json.dumps({"type": "error", "message": str(exc)}, ensure_ascii=False) + "\n"
    return StreamingResponse(generate(), media_type="application/x-ndjson")


@router.get("/ai/workflows")
def workflow_catalog():
    return {"data": [{
        "id": profile.id,
        "label": profile.label,
        "purpose": profile.purpose,
        "tool_count": len(profile.tool_names),
        "web_search": False,
        "private_knowledge": False,
    } for profile in ai_workflows.WORKFLOWS.values()]}


@router.post("/chat")
def chat(request: ChatReq):
    if not request.messages:
        raise HTTPException(400, locale_text(request.locale, "messages cannot be empty", "messages 不能为空"))
    try:
        ai_workflows.get_workflow(request.workflow)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    cfg = check_llm(request.llm, request.locale)
    is_cli = request.llm.provider.startswith("cli-")
    messages = [message.model_dump() for message in request.messages]

    def generate():
        try:
            events = (chat_layer.run_chat_cli_stream if is_cli else chat_layer.run_chat_stream)(
                cfg, messages, request.context, request.workflow,
            )
            for event in events:
                yield json.dumps(event, ensure_ascii=False) + "\n"
        except Exception as exc:  # noqa: BLE001
            message = locale_text(request.locale, f"Chat failed: {exc}", f"对话失败：{exc}")
            yield json.dumps({"type": "error", "message": message}, ensure_ascii=False) + "\n"
    return StreamingResponse(generate(), media_type="application/x-ndjson")


@router.post("/debate")
def debate(request: DebateReq):
    if request.asset_type == "crypto":
        code = market_data.resolve_crypto_symbol(request.code).removesuffix("-USD")
    elif request.asset_type == "equity":
        code = validate_stock_symbol(request.code)
    else:
        raise HTTPException(400, locale_text(request.locale, "asset_type must be equity or crypto", "asset_type 仅支持 equity 或 crypto"))
    cfg = check_llm(request.llm, request.locale)
    try:
        contexts = research_context.normalize([item.model_dump() for item in request.additional_contexts])
    except research_context.ResearchContextError as exc:
        raise HTTPException(400, exc.localized(request.locale)) from exc
    return ndjson(lambda: debate_layer.run_debate_stream(
        cfg, code, 2 if request.rounds >= 2 else 1, request.asset_type, contexts,
        list(dict.fromkeys(request.research_skills)), request.research_skill_parameters,
    ))


@router.post("/research-context/extract")
def extract_research_context(request: ResearchFilesIn):
    try:
        return {"data": research_context.extract_files([item.model_dump() for item in request.files])}
    except research_context.ResearchContextError as exc:
        raise HTTPException(400, exc.localized(request.locale)) from exc


@router.post("/research-team")
def run_research_team(request: ResearchTeamReq):
    position_text = ""
    position_context = None
    code = request.code
    if request.position_instrument_key:
        try:
            provider_symbol, position_text, position_context = research_team.resolve_position(
                request.position_instrument_key, request.include_position_preferences,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if code.strip().upper() != provider_symbol:
            raise HTTPException(400, locale_text(request.locale, "The research symbol must match the selected IBKR position symbol.", "研究代码必须与所选 IBKR 持仓的行情代码一致"))
        code = provider_symbol
    code = (
        market_data.resolve_crypto_symbol(code).removesuffix("-USD")
        if request.asset_type == "crypto"
        else validate_stock_symbol(code)
    )
    try:
        contexts = research_context.normalize([item.model_dump() for item in request.additional_contexts])
    except research_context.ResearchContextError as exc:
        raise HTTPException(400, exc.localized(request.locale)) from exc
    response = ndjson(lambda: research_team.run_stream(
        check_llm(request.llm, request.locale), code, request.asset_type, contexts, position_text,
        list(dict.fromkeys(request.research_skills)), request.research_skill_parameters,
    ))
    if position_context:
        response.headers["X-Vibe-Position-Context"] = "selected-only"
    return response


@router.post("/reflect")
def reflect(request: ReflectReq):
    if not (request.source or "").strip():
        raise HTTPException(400, locale_text(request.locale, "source cannot be empty", "source 不能为空"))
    cfg = check_llm(request.llm, request.locale)
    return ndjson(lambda: reflection_layer.run_reflection_stream(cfg, request.source, request.title))
