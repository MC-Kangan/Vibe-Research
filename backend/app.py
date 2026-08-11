"""Vibe-Research 后端 —— A股数据层 HTTP 接口（FastAPI）。

端点全部在 /api 下，前端 vite 代理 /api → localhost:8900。
只读、无状态、按用户传入代码返回客观数据。不预置标的、不建议。

启动：
    uvicorn app:app --host 127.0.0.1 --port 8900
"""

from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

import astock
import ai_workflows
import auth as auth_layer
import chat as chat_layer
import cli_runtime
import crypto_portfolio
import debate as debate_layer
import gstock
import ibkr_analytics
import market_data
import market_intelligence
import newsradar
import portfolio as pf
import market
import myreports as mr
import position_preferences
import position_service
import reflection as reflect_layer
import research as research_layer
import research_context
import research_team

app = FastAPI(title="Vibe-Research API", version="0.3.0")

# 每半小时后台刷新持仓数据
pf.start_scheduler(1800)

# CORS：默认放开（本地自托管友好）；公网部署时用 VR_ALLOW_ORIGINS 收紧成白名单。
#   例：VR_ALLOW_ORIGINS="https://myhost"  （逗号分隔多个）
_ORIGINS = [o.strip() for o in os.environ.get("VR_ALLOW_ORIGINS", "*").split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials="*" not in _ORIGINS,
)

# 可选鉴权：设了 VR_API_KEY 就要求所有 /api/* 带 `Authorization: Bearer <key>`
#   （本地自托管不设=开放；公网部署务必设，否则别人能读你的持仓/调你的后端）。
_API_KEY = os.environ.get("VR_API_KEY", "").strip()

if auth_layer.enabled():
    auth_layer.validate_configuration()


@app.middleware("http")
async def _require_api_key(request: Request, call_next):
    is_api = request.url.path.startswith("/api/")
    if (
        auth_layer.enabled()
        and is_api
        and request.method in {"POST", "PUT", "PATCH", "DELETE"}
        and auth_layer.request_uses_session(request)
        and not auth_layer.origin_allowed(request)
    ):
        return JSONResponse(
            {"detail": "Cross-origin session request rejected"},
            status_code=403,
            headers={"Cache-Control": "no-store"},
        )
    if (
        request.method != "OPTIONS"
        and is_api
        and request.url.path not in {"/api/health", "/api/auth/session", "/api/auth/login", "/api/auth/logout"}
    ):
        if _API_KEY and auth_layer.bearer_authorized(request, _API_KEY):
            return await call_next(request)
        if auth_layer.enabled() and auth_layer.session_username(request):
            return await call_next(request)
        if _API_KEY or auth_layer.enabled():
            return JSONResponse(
                {"detail": "未授权：请登录或提供有效的 API Key"},
                status_code=401,
                headers={"Cache-Control": "no-store"},
            )
    response = await call_next(request)
    if auth_layer.enabled() and is_api and request.url.path != "/api/health":
        response.headers.setdefault("Cache-Control", "no-store")
    return response

_CODE_RE = r"^\d{6}$"


def _validate(code: str) -> str:
    code = (code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "代码必须是 6 位数字")
    return code


def _validate_stock_symbol(symbol: str) -> str:
    """Return the canonical A-share, US, or explicit European symbol."""
    value = (symbol or "").strip().upper()
    if value.isdigit() and len(value) == 6:
        return value
    try:
        return market_data.resolve_symbol(value).provider_symbol
    except market_data.UnsupportedSymbolError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/health")
def health():
    return {"ok": True, "service": "vibe-research-api", "version": "0.3.0"}


class AuthLoginReq(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=1024)


@app.get("/api/auth/session")
def auth_session(request: Request):
    username = auth_layer.session_username(request)
    return {
        "data": {
            "enabled": auth_layer.enabled(),
            "authenticated": bool(username),
            "username": username,
        }
    }


@app.post("/api/auth/login")
def auth_login(req: AuthLoginReq, response: Response):
    if not auth_layer.enabled():
        raise HTTPException(404, "Application authentication is disabled")
    if not auth_layer.login_allowed():
        raise HTTPException(
            429,
            "Too many failed login attempts; try again later",
            headers={"Retry-After": "900"},
        )
    token = auth_layer.authenticate(req.username, req.password)
    if token is None:
        raise HTTPException(401, "Invalid username or password")
    username = req.username.strip()
    auth_layer.set_session_cookie(response, token)
    return {"data": {"enabled": True, "authenticated": True, "username": username}}


@app.post("/api/auth/logout")
def auth_logout(request: Request, response: Response):
    auth_layer.revoke_session(request.cookies.get(auth_layer.cookie_name(), ""))
    auth_layer.clear_session_cookie(response)
    return {"data": {"authenticated": False}}


class LLMConfig(BaseModel):
    provider: str = ""       # cli-* = 订阅接入（调本机 CLI）；其余 = API 接入
    baseURL: str = ""        # 订阅接入时留空
    apiKey: str = ""         # 订阅接入时留空
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


def _locale_text(locale: str, english: str, chinese: str) -> str:
    return chinese if locale == "zh-CN" else english


@app.get("/api/ai/workflows")
def ai_workflow_catalog():
    """Public workflow catalog for capability-aware clients."""
    return {"data": [{
        "id": profile.id,
        "label": profile.label,
        "purpose": profile.purpose,
        "tool_count": len(profile.tool_names),
        "web_search": False,
        "private_knowledge": False,
    } for profile in ai_workflows.WORKFLOWS.values()]}


@app.post("/api/chat")
def chat(req: ChatReq):
    """系统 AI 对话，**流式** NDJSON（每行一个事件 {type: tool|delta|done|error}）。

    - API 接入：OpenAI 兼容 function-calling，边流答案边推工具调用事件。
    - 订阅接入（provider=cli-*）：调本机已登录的 CLI，stdout 边出边流（数据靠 context）。
    配置错误（缺 key / 未装 CLI）走 HTTP 400；运行时错误走流内 error 事件。用户配置随请求传入，后端不持久化。
    """
    if not req.messages:
        raise HTTPException(400, _locale_text(req.locale, "messages cannot be empty", "messages 不能为空"))
    if not req.llm.model:
        raise HTTPException(400, _locale_text(req.locale, "Choose a model in AI Setup first.", "缺少模型配置，请先在「接入 AI」里选择"))
    try:
        ai_workflows.get_workflow(req.workflow)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    is_cli = req.llm.provider.startswith("cli-")
    if is_cli:
        kind = req.llm.provider[4:]
        if not cli_runtime.detect_cli(kind):
            raise HTTPException(400, _locale_text(req.locale, f"The local {kind} command was not found. Install and authenticate it, or use API access.", f"未检测到「{kind}」对应的本机命令。请先安装并登录该 CLI，或改用「API 接入」。"))
    elif not req.llm.apiKey or not req.llm.baseURL:
        raise HTTPException(400, _locale_text(req.locale, "Enter a Base URL and API key in AI Setup.", "缺少 Base URL 或 API Key，请先在「接入 AI」里填写"))

    cfg = req.llm.model_dump()
    cfg["_locale"] = req.locale
    messages = [message.model_dump() for message in req.messages]

    def gen():
        try:
            events = (chat_layer.run_chat_cli_stream if is_cli else chat_layer.run_chat_stream)(
                cfg, messages, req.context, req.workflow,
            )
            for ev in events:
                yield json.dumps(ev, ensure_ascii=False) + "\n"
        except Exception as e:  # noqa: BLE001 — 运行时错误以流内事件上报，不中断连接
            yield json.dumps({"type": "error", "message": _locale_text(req.locale, f"Chat failed: {e}", f"对话失败：{e}")}, ensure_ascii=False) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")


def _check_llm(llm: LLMConfig, locale: Literal["en", "zh-CN"] = "en") -> dict:
    """校验模型配置并返回 cfg（chat / debate / reflect 三个流式端点共用）。

    配置问题走 HTTP 400（前端能弹提示引导去「接入 AI」页），运行时错误留给流内 error 事件。
    """
    if not llm.model:
        raise HTTPException(400, _locale_text(locale, "Choose a model in AI Setup first.", "缺少模型配置，请先在「接入 AI」里选择"))
    if llm.provider.startswith("cli-"):
        kind = llm.provider[4:]
        if not cli_runtime.detect_cli(kind):
            raise HTTPException(400, _locale_text(locale, f"The local {kind} command was not found. Install and authenticate it, or use API access.", f"未检测到「{kind}」对应的本机命令。请先安装并登录该 CLI，或改用「API 接入」。"))
    elif not llm.apiKey or not llm.baseURL:
        raise HTTPException(400, _locale_text(locale, "Enter a Base URL and API key in AI Setup.", "缺少 Base URL 或 API Key，请先在「接入 AI」里填写"))
    cfg = llm.model_dump()
    cfg["_locale"] = locale
    return cfg


def _ndjson(events):
    """把事件生成器包成 NDJSON 流；运行时异常转成流内 error 事件，不中断连接。"""
    def gen():
        try:
            for ev in events():
                yield json.dumps(ev, ensure_ascii=False) + "\n"
        except Exception as e:  # noqa: BLE001
            yield json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")


class ResearchContextIn(BaseModel):
    name: str = Field(max_length=160)
    content: str = Field(max_length=research_context.MAX_ITEM_CHARS)


class DebateReq(BaseModel):
    code: str
    rounds: int = 1
    asset_type: str = "equity"
    llm: LLMConfig
    locale: Literal["en", "zh-CN"] = "en"
    additional_contexts: list[ResearchContextIn] = Field(default_factory=list, max_length=research_context.MAX_ITEMS)


@app.post("/api/debate")
def debate(req: DebateReq):
    """多空辩论：后端先拉客观事实底稿，再让多方 / 空方 / 中立主持依次发言，**流式** NDJSON。

    刻意不产出买卖结论——终点是「分歧点 + 验证清单」，判断留给用户自己。
    """
    if req.asset_type == "crypto":
        code = market_data.resolve_crypto_symbol(req.code).removesuffix("-USD")
    elif req.asset_type == "equity":
        code = _validate_stock_symbol(req.code)
    else:
        raise HTTPException(400, _locale_text(req.locale, "asset_type must be equity or crypto", "asset_type 仅支持 equity 或 crypto"))
    cfg = _check_llm(req.llm, req.locale)
    rounds = 2 if req.rounds >= 2 else 1
    try:
        contexts = research_context.normalize([item.model_dump() for item in req.additional_contexts])
    except research_context.ResearchContextError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _ndjson(lambda: debate_layer.run_debate_stream(cfg, code, rounds, req.asset_type, contexts))


class ResearchFileIn(BaseModel):
    name: str = Field(max_length=160)
    content_b64: str = Field(max_length=14_100_000)


class ResearchFilesIn(BaseModel):
    files: list[ResearchFileIn] = Field(min_length=1, max_length=research_context.MAX_ITEMS)


@app.post("/api/research-context/extract")
def research_context_extract(request: ResearchFilesIn):
    """Extract transient research text in memory; never stores uploaded files."""
    try:
        return {"data": research_context.extract_files([item.model_dump() for item in request.files])}
    except research_context.ResearchContextError as exc:
        raise HTTPException(400, str(exc)) from exc


class ResearchTeamReq(BaseModel):
    code: str
    asset_type: Literal["equity", "crypto"] = "equity"
    llm: LLMConfig
    locale: Literal["en", "zh-CN"] = "en"
    additional_contexts: list[ResearchContextIn] = Field(default_factory=list, max_length=research_context.MAX_ITEMS)
    position_instrument_key: str | None = Field(default=None, max_length=64)


@app.post("/api/research-team")
def research_team_run(request: ResearchTeamReq):
    position_text = ""
    position_context = None
    code = request.code
    if request.position_instrument_key:
        try:
            provider_symbol, position_text, position_context = research_team.resolve_position(request.position_instrument_key)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if code.strip().upper() != provider_symbol:
            raise HTTPException(400, _locale_text(request.locale, "The research symbol must match the selected IBKR position symbol.", "研究代码必须与所选 IBKR 持仓的行情代码一致"))
        code = provider_symbol
    if request.asset_type == "crypto":
        code = market_data.resolve_crypto_symbol(code).removesuffix("-USD")
    else:
        code = _validate_stock_symbol(code)
    try:
        contexts = research_context.normalize([item.model_dump() for item in request.additional_contexts])
    except research_context.ResearchContextError as exc:
        raise HTTPException(400, str(exc)) from exc
    cfg = _check_llm(request.llm, request.locale)
    response = _ndjson(lambda: research_team.run_stream(cfg, code, request.asset_type, contexts, position_text))
    if position_context:
        response.headers["X-Vibe-Position-Context"] = "selected-only"
    return response


class ReflectReq(BaseModel):
    source: str
    title: str = ""
    llm: LLMConfig
    locale: Literal["en", "zh-CN"] = "en"


@app.post("/api/reflect")
def reflect(req: ReflectReq):
    """反思：对一段已写好的分析做推理审计（哪些有数据支撑、最脆弱一环、验证清单），流式 NDJSON。"""
    if not (req.source or "").strip():
        raise HTTPException(400, _locale_text(req.locale, "source cannot be empty", "source 不能为空"))
    cfg = _check_llm(req.llm, req.locale)
    return _ndjson(lambda: reflect_layer.run_reflection_stream(cfg, req.source, req.title))


class HoldingIn(BaseModel):
    code: str
    shares: float
    cost: float
    include_in_total: bool = False


@app.get("/api/portfolio")
def portfolio_get():
    """持仓 + 实时盈亏（浮动盈亏红涨绿跌）。"""
    try:
        return {"data": pf.get_portfolio()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"持仓读取异常：{e}") from e


class PositionRefreshIn(BaseModel):
    confirm_empty: bool = False


class PositionMappingIn(BaseModel):
    instrument_key: str
    provider_symbol: str
    price_multiplier: float = 1.0


class PositionPreferencesIn(BaseModel):
    items: list[str] = Field(default_factory=list, max_length=20)


@app.get("/api/positions/current")
def positions_current():
    """Return the last normalized real-position snapshot without broker I/O."""
    return {"data": position_service.get_current()}


@app.get("/api/positions/preferences")
def positions_preferences_get():
    return {"data": position_preferences.get()}


@app.put("/api/positions/preferences")
def positions_preferences_put(request: PositionPreferencesIn):
    try:
        return {"data": position_preferences.save(request.items)}
    except position_preferences.PositionPreferenceError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/positions/refresh")
def positions_refresh(request: PositionRefreshIn):
    """Perform an explicit read-only IBKR Flex current-position refresh."""
    try:
        return {"data": position_service.refresh(confirm_empty=request.confirm_empty)}
    except position_service.PositionServiceError as exc:
        message = str(exc)
        status = 429 if "cooling down" in message else 409 if "confirm_empty" in message else 503
        raise HTTPException(status, message) from exc


@app.post("/api/positions/refresh-all", status_code=202)
def positions_refresh_all():
    """Queue the current-position and history Flex imports as one read-only job."""
    if not ibkr_analytics.configured():
        raise HTTPException(503, "IBKR Flex current-position query is not configured")
    return {"data": ibkr_analytics.start_refresh()}


@app.get("/api/positions/refresh-status")
def positions_refresh_status(job_id: str | None = None):
    return {"data": ibkr_analytics.refresh_status(job_id)}


@app.get("/api/positions/analytics")
def positions_analytics(range_name: str = Query("3m", alias="range")):
    try:
        return {"data": ibkr_analytics.analytics(range_name)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/positions/instruments")
def positions_instruments(status: str = Query("all")):
    if status not in {"all", "open", "closed"}:
        raise HTTPException(400, "status must be all, open, or closed")
    return {"data": ibkr_analytics.list_instruments(status)}


@app.get("/api/positions/chart")
def positions_chart(
    instrument_key: str = Query(..., min_length=8, max_length=64),
    range_name: str = Query("3m", alias="range"),
):
    try:
        return {"data": ibkr_analytics.chart(instrument_key, range_name)}
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/positions/mappings")
def positions_mapping(request: PositionMappingIn):
    try:
        return {"data": ibkr_analytics.save_mapping(request.instrument_key, request.provider_symbol, request.price_multiplier)}
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/portfolio/holding")
def portfolio_add(h: HoldingIn):
    """加一笔持仓（同代码按加权平均成本合并）。存本地，不上传。"""
    code = _validate_stock_symbol(h.code)
    if h.shares <= 0:
        raise HTTPException(400, "数量必须大于 0")
    # 成本价不限正负：融券 / 返息 / 摊薄后为负成本等情形按结果计算，用户想怎么输就怎么输。
    return {"data": pf.add_holding(code, h.shares, h.cost, h.include_in_total)}


class HoldingTotalIn(BaseModel):
    include_in_total: bool


@app.put("/api/portfolio/holding/total")
def portfolio_holding_total(request: HoldingTotalIn, code: str = Query(...)):
    try:
        return {"data": pf.set_holding_in_total(_validate_stock_symbol(code), request.include_in_total)}
    except KeyError as exc:
        raise HTTPException(404, "未找到该手工股票持仓") from exc


@app.delete("/api/portfolio/holding")
def portfolio_remove(code: str = Query(...)):
    return {"data": pf.remove_holding(_validate_stock_symbol(code))}


# ---- 我的研报（用户上传自己的研报，存本地、不上传、不进开源仓库）----

class ReportIn(BaseModel):
    name: str
    content_b64: str


@app.get("/api/myreports")
def myreports_list():
    return {"data": mr.list_reports()}


@app.post("/api/myreports")
def myreports_upload(r: ReportIn):
    """上传一份研报（base64）→ 存本地 + 按文件名自动打行业标签。"""
    try:
        return {"data": mr.save_report(r.name, r.content_b64)}
    except mr.ReportError as e:
        raise HTTPException(400, str(e)) from e


@app.get("/api/myreports/file/{rid}")
def myreports_file(rid: str):
    """下载/预览某份研报原文件。"""
    hit = mr.report_path(rid)
    if not hit:
        raise HTTPException(404, "研报不存在")
    path, name = hit
    return FileResponse(str(path), filename=name)


@app.delete("/api/myreports/{rid}")
def myreports_delete(rid: str):
    return {"data": {"ok": mr.delete_report(rid)}}


class CloseIn(BaseModel):
    code: str
    date: str
    price: float
    shares: float
    cost: float


@app.post("/api/portfolio/close")
def portfolio_close(c: CloseIn):
    """记一笔已清仓（已实现盈亏）。存本地。"""
    code = _validate_stock_symbol(c.code)
    if c.price <= 0 or c.shares <= 0:
        raise HTTPException(400, "清仓价与股数必须大于 0")
    # 买入成本不限正负（同持仓录入）：按 (清仓价 - 成本) × 股数 的结果计算已实现盈亏。
    date = (c.date or "").strip()
    if not date:
        raise HTTPException(400, "请填清仓日期")
    from datetime import datetime
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "清仓日期格式应为 YYYY-MM-DD") from None
    return {"data": pf.close_position(code, date, c.price, c.shares, c.cost)}


@app.delete("/api/portfolio/close")
def portfolio_close_remove(index: int = Query(...)):
    return {"data": pf.remove_closed(index)}


@app.post("/api/portfolio/refresh")
def portfolio_refresh():
    """手动刷新：立即重拉行情算盈亏。"""
    try:
        return {"data": pf.get_portfolio()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"刷新失败：{e}") from e


class ManualCryptoIn(BaseModel):
    wallet_label: str = Field(min_length=1, max_length=80)
    asset: str = Field(min_length=2, max_length=16)
    quantity: float = Field(ge=0)
    unit_cost: float | None = Field(default=None, ge=0)
    cost_currency: str = Field(default="USD", min_length=3, max_length=3)


class CryptoCsvIn(BaseModel):
    content: str = Field(max_length=1_000_000)


@app.get("/api/portfolio/crypto")
def crypto_portfolio_get(reporting_currency: str = Query("USD", min_length=3, max_length=3)):
    return {"data": crypto_portfolio.get_crypto_portfolio(reporting_currency)}


@app.get("/api/positions/crypto/current")
def crypto_positions_current():
    return {"data": crypto_portfolio.get_coinbase_snapshot()}


@app.post("/api/positions/crypto/refresh")
def crypto_positions_refresh():
    try:
        return {"data": crypto_portfolio.refresh_coinbase()}
    except crypto_portfolio.CryptoPortfolioError as exc:
        raise HTTPException(503, str(exc)) from exc


@app.post("/api/portfolio/crypto/manual")
def crypto_manual_upsert(request: ManualCryptoIn):
    try:
        return {"data": crypto_portfolio.upsert_manual(request.model_dump())}
    except crypto_portfolio.CryptoPortfolioError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.delete("/api/portfolio/crypto/manual")
def crypto_manual_remove(wallet_label: str = Query(...), asset: str = Query(...)):
    return {"data": crypto_portfolio.remove_manual(wallet_label, asset)}


@app.post("/api/portfolio/crypto/import/preview")
def crypto_csv_preview(request: CryptoCsvIn):
    try:
        return {"data": {"rows": crypto_portfolio.parse_csv(request.content)}}
    except crypto_portfolio.CryptoPortfolioError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/portfolio/crypto/import")
def crypto_csv_commit(request: CryptoCsvIn):
    try:
        return {"data": crypto_portfolio.commit_csv(request.content)}
    except crypto_portfolio.CryptoPortfolioError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/portfolio/summary")
def portfolio_summary(reporting_currency: str | None = Query(default=None, min_length=3, max_length=3)):
    return {"data": crypto_portfolio.combined_summary(reporting_currency)}


@app.get("/api/radar")
def radar():
    """资讯雷达：12 赛道公开 RSS 资讯（读缓存，无缓存返回赛道骨架）。"""
    try:
        return {"data": newsradar.get_radar(force=False)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"资讯雷达异常：{e}") from e


@app.post("/api/radar/refresh")
def radar_refresh():
    """强制重抓全部 RSS 源（耗时约 20-40s），更新缓存。"""
    try:
        return {"data": newsradar.fetch_radar()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"资讯雷达刷新失败：{e}") from e


@app.get("/api/market/overview")
def market_overview():
    """市场情绪 + 板块资金流（板块/大盘级，全站共享缓存 5 分钟）。"""
    try:
        return {"data": market.get_overview()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"市场总览异常：{e}") from e


@app.get("/api/market/emotion")
def market_emotion():
    """短线情绪：连板梯队 / 最高连板 / 炸板率 / 封板率 / 晋级率 / 涨跌停家数。

    含连板梯队个股清单（code/name/连板数等）——2026-07-05 起如实展示客观公开榜单（东财同款），
    只呈现事实，不附推荐/评分/预测/买卖时机。全站共享缓存 5 分钟。
    """
    try:
        return {"data": market.get_short_term_emotion()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"短线情绪异常：{e}") from e


@app.get("/api/market/turnover-top")
def market_turnover_top():
    """全市场成交额榜 Top20（客观公开榜单数据，非推荐/非预测/不评分）。全站共享缓存 5 分钟。"""
    try:
        return {"data": market.get_turnover_top()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"成交额榜异常：{e}") from e


@app.get("/api/global/indices")
def global_indices():
    """全球指数快照（道指 / 标普500 / 纳斯达克 / 恒生 / 恒生科技）—— A 股看隔夜外围脸色。缓存 5 分钟。"""
    try:
        return {"data": market.get_global_indices()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"全球指数异常：{e}") from e


@app.get("/api/market-data/benchmarks")
def market_data_benchmarks():
    """US/European headline benchmark snapshots for the primary landing view."""
    return {"data": market_data.get_benchmarks()}


@app.get("/api/market-data/overview")
def market_data_overview(symbols: str = Query("", max_length=1000)):
    """US/European overview plus watchlist-derived breadth and movers."""
    raw = [item.strip() for item in symbols.split(",") if item.strip()]
    if len(raw) > 30:
        raise HTTPException(400, "symbols 最多包含 30 个股票代码")
    try:
        canonical = list(dict.fromkeys(_validate_stock_symbol(item) for item in raw))
    except HTTPException:
        raise
    return {"data": market_data.get_market_overview(canonical)}


@app.get("/api/market-data/mood")
def market_data_mood(market_name: str = Query("US", alias="market")):
    """Cached daily mood statistics for the US or EURO STOXX 50 basket."""
    if market_name not in {"US", "Europe"}:
        raise HTTPException(400, "market 仅支持 US 或 Europe")
    return {"data": market_data.get_market_mood(market_name)}


@app.get("/api/market-data/crypto/overview")
def market_data_crypto_overview():
    """BTC plus large-cap altcoins with market-wide crypto context."""
    return {"data": market_data.get_crypto_overview()}


@app.get("/api/market-data/crypto/context")
def market_data_crypto_context(symbol: str = Query(..., min_length=2, max_length=16)):
    return {"data": market_data.get_crypto_asset_context(symbol)}


@app.get("/api/data-sources/status")
def data_sources_status():
    """Configuration status only; never returns provider credentials."""
    return {"data": {
        "yahoo": {"configured": True, "coverage": "US/Europe quotes and daily history"},
        "sec_edgar": {"configured": bool(os.environ.get("VR_SEC_USER_AGENT", "").strip()), "coverage": "US filings and selected XBRL facts"},
        "finnhub": {"configured": bool(os.environ.get("VR_FINNHUB_API_KEY", "").strip()), "coverage": "US/Europe company news and earnings trial"},
        "europe_filings": {"configured": False, "coverage": "European regulatory filings not yet connected"},
        "coinbase_market": {"configured": True, "coverage": "Public USD spot quotes and daily candles"},
        "coinbase_account": {"configured": crypto_portfolio.coinbase_configured(), "coverage": "Read-only Coinbase balances"},
        "coingecko": {"configured": bool(os.environ.get("VR_COINGECKO_API_KEY", "").strip()), "coverage": "Crypto market rank, breadth, dominance and metadata"},
    }}


class IntelligenceFeedReq(BaseModel):
    symbols: list[str]
    kinds: list[str] = ["filings", "news", "earnings"]
    limit_per_symbol: int = 5


@app.post("/api/intelligence/feed")
def intelligence_feed(req: IntelligenceFeedReq):
    """Normalized watchlist filings/news/earnings feed across supported markets."""
    if not req.symbols or len(req.symbols) > 30:
        raise HTTPException(400, "symbols 必须包含 1-30 个股票代码")
    if not any(kind in {"filings", "news", "earnings"} for kind in req.kinds):
        raise HTTPException(400, "kinds 必须包含 filings、news 或 earnings")
    try:
        symbols = [_validate_stock_symbol(symbol) for symbol in req.symbols]
    except HTTPException:
        raise
    return {"data": market_intelligence.collect(symbols, req.kinds, req.limit_per_symbol)}


class ResearchRunReq(BaseModel):
    symbol: str
    skills: list[str]
    asset_type: str = "equity"
    skill_parameters: dict[str, dict] = Field(default_factory=dict)


@app.get("/api/research/skills")
def research_skills():
    """Return the read-only TradeAgent skills exposed in Vibe Research."""
    if not research_layer.configured():
        return {"configured": False, "status": "disabled", "skills": []}
    try:
        skills = research_layer.list_skills()
    except research_layer.ResearchClientError as exc:
        return {"configured": True, "status": "unavailable", "detail": str(exc), "skills": []}
    return {"configured": True, "status": "available", "skills": skills}


@app.post("/api/research/run")
def research_run(req: ResearchRunReq):
    """Fetch one shared price dossier, then run selected TradeAgent skills."""
    skills = list(dict.fromkeys(item.strip() for item in req.skills if item.strip()))
    if not skills:
        raise HTTPException(422, "请选择至少一个分析技能")
    if any(skill not in research_layer.ALLOWED_SKILLS for skill in skills):
        raise HTTPException(422, "包含未启用的分析技能")
    if not research_layer.configured():
        raise HTTPException(503, "TradeAgent is not configured")
    try:
        research_layer.validate_skill_support(skills, req.asset_type)
        inputs = research_layer.build_run_inputs(req.symbol, skills, req.skill_parameters, req.asset_type)
    except research_layer.UnsupportedSkillAssetError as exc:
        raise HTTPException(422, str(exc)) from exc
    except research_layer.ResearchClientError as exc:
        raise HTTPException(502, str(exc)) from exc
    results_by_skill = {}
    with ThreadPoolExecutor(max_workers=len(skills)) as executor:
        futures = {
            executor.submit(
                research_layer.run_skill,
                skill=skill,
                symbol=inputs["symbol"],
                market=inputs["market"],
                skill_parameters={skill: req.skill_parameters.get(skill, {})},
                price_series=inputs["price_series"],
                asset_type=inputs.get("asset_type", req.asset_type),
            ): skill
            for skill in skills
        }
        for future in as_completed(futures):
            skill = futures[future]
            try:
                results_by_skill[skill] = {"skill": skill, "status": "complete", "report": future.result()}
            except research_layer.ResearchClientError as exc:
                results_by_skill[skill] = {"skill": skill, "status": "failed", "detail": str(exc)}
    results = [results_by_skill[skill] for skill in skills]
    return {"symbol": inputs["symbol"], "market": inputs["market"], "results": results}


@app.get("/api/global/stock")
def global_stock(symbol: str = Query(..., min_length=1, max_length=16)):
    """美股 / 港股个股聚合：行情 + 关键财务指标（东财域内源）。symbol 如 AAPL / BABA / 00700。"""
    try:
        data = gstock.us_hk_stock(symbol.strip())
        if not data:
            raise HTTPException(404, f"未找到美股/港股代码「{symbol}」")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"美港股查询异常：{e}") from e


@app.get("/api/global/hk/cashflow")
def global_hk_cashflow(symbol: str = Query(..., min_length=1, max_length=16)):
    """港股现金流量表（东财域内源 RPT_HKSK_FN_CASHFLOW）：经营/投资/筹资/净增加，多期。symbol 如 00700。"""
    try:
        data = gstock.hk_cashflow(symbol.strip())
        if not data:
            raise HTTPException(404, f"未找到港股「{symbol}」的现金流数据（仅港股支持）")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"港股现金流查询异常：{e}") from e


def _market_data_http_error(exc: market_data.MarketDataError) -> HTTPException:
    """Map provider-neutral errors without leaking upstream request details."""
    if isinstance(exc, market_data.UnsupportedSymbolError):
        return HTTPException(400, str(exc))
    if isinstance(exc, market_data.InstrumentNotFoundError):
        return HTTPException(404, str(exc))
    if isinstance(exc, market_data.ProviderConfigurationError):
        return HTTPException(503, str(exc))
    if isinstance(exc, market_data.ProviderTimeoutError):
        return HTTPException(504, str(exc))
    return HTTPException(502, str(exc))


@app.get("/api/market-data/snapshot")
def market_data_snapshot(
    symbol: str = Query(..., min_length=1, max_length=24),
    asset_type: str = Query("equity"),
):
    """美股或欧洲原生上市股票快照；欧洲要求显式交易所后缀。"""
    try:
        return {"data": market_data.get_snapshot(symbol) if asset_type == "equity" else market_data.get_snapshot(symbol, asset_type)}
    except market_data.MarketDataError as exc:
        raise _market_data_http_error(exc) from exc


@app.get("/api/market-data/bars")
def market_data_bars(
    symbol: str = Query(..., min_length=1, max_length=24),
    range_: str = Query("1y", alias="range"),
    interval: str = Query("1d"),
    asset_type: str = Query("equity"),
):
    """美股/欧洲股票日线 OHLCV；价格已归一为交易币种主单位。"""
    try:
        return {"data": market_data.get_bars(symbol, range_, interval) if asset_type == "equity" else market_data.get_bars(symbol, range_, interval, asset_type)}
    except market_data.MarketDataError as exc:
        raise _market_data_http_error(exc) from exc


@app.get("/api/market-data/news")
def market_data_news(
    symbol: str = Query(..., min_length=1, max_length=24),
    days: int = Query(30, ge=1, le=365),
):
    """Finnhub company news; optional and enabled with VR_FINNHUB_API_KEY."""
    try:
        return {"data": market_data.get_company_news(symbol, days=days)}
    except market_data.MarketDataError as exc:
        raise _market_data_http_error(exc) from exc


@app.get("/api/market-data/earnings")
def market_data_earnings(symbol: str = Query(..., min_length=1, max_length=24)):
    """Finnhub historical earnings and estimates for coverage validation."""
    try:
        return {"data": market_data.get_earnings(symbol)}
    except market_data.MarketDataError as exc:
        raise _market_data_http_error(exc) from exc


@app.get("/api/market-data/filings")
def market_data_filings(symbol: str = Query(..., min_length=1, max_length=24)):
    """Authoritative SEC EDGAR filings for US issuers."""
    try:
        return {"data": market_data.get_filings(symbol)}
    except market_data.MarketDataError as exc:
        raise _market_data_http_error(exc) from exc


@app.get("/api/market-data/sec-facts")
def market_data_sec_facts(symbol: str = Query(..., min_length=1, max_length=24)):
    """Selected latest company facts from SEC XBRL companyfacts."""
    try:
        return {"data": market_data.get_company_facts(symbol)}
    except market_data.MarketDataError as exc:
        raise _market_data_http_error(exc) from exc


@app.get("/api/indices")
def indices():
    """A股大盘指数实时行情（上证/深证成指/创业板指/沪深300）。仅标准库。"""
    try:
        return {"data": astock.index_quote()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"指数行情异常：{e}") from e


@app.get("/api/quote")
def quote(codes: str = Query(..., description="逗号分隔的 6 位代码")):
    """实时行情：现价/涨跌/PE/PB/市值/换手/涨跌停。仅标准库，永远可用。"""
    lst = [c.strip() for c in codes.split(",") if c.strip()]
    if not lst or any(not c.isdigit() or len(c) != 6 for c in lst):
        raise HTTPException(400, "codes 必须是逗号分隔的 6 位数字")
    try:
        return {"data": astock.tencent_quote(lst)}
    except Exception as e:  # noqa: BLE001 — 边界统一兜底
        raise HTTPException(502, f"行情源异常：{e}") from e


@app.get("/api/quotes")
def universal_quotes(symbols: str = Query(..., min_length=1, max_length=1000)):
    """A 股、美股和欧洲股票的批量行情；单个上游失败不会拖垮整批。"""
    raw = [item.strip() for item in symbols.split(",") if item.strip()]
    if not raw or len(raw) > 50:
        raise HTTPException(400, "symbols 必须包含 1-50 个逗号分隔的股票代码")
    canonical = list(dict.fromkeys(_validate_stock_symbol(item) for item in raw))
    a_codes = [item for item in canonical if item.isdigit() and len(item) == 6]
    market_symbols = [item for item in canonical if item not in a_codes]
    result: dict[str, dict] = {}

    if a_codes:
        try:
            for code, quote_data in astock.tencent_quote(a_codes).items():
                result[code] = {**quote_data, "currency": "CNY", "source": "tencent", "market": "CN"}
        except Exception:
            pass

    def fetch_market(symbol: str):
        return symbol, market_data.get_snapshot(symbol)

    with ThreadPoolExecutor(max_workers=min(8, len(market_symbols) or 1)) as executor:
        futures = [executor.submit(fetch_market, symbol) for symbol in market_symbols]
        for future in as_completed(futures):
            try:
                symbol, snapshot = future.result()
            except market_data.MarketDataError:
                continue
            quote_data = snapshot.quote
            instrument = snapshot.instrument
            result[symbol] = {
                "name": instrument.name,
                "price": quote_data.price,
                "last_close": quote_data.previous_close,
                "change_pct": quote_data.change_pct,
                "pe_ttm": None,
                "pb": None,
                "mcap_yi": None,
                "turnover_pct": None,
                "limit_up": None,
                "limit_down": None,
                "currency": quote_data.currency,
                "source": quote_data.source,
                "market": "US" if instrument.country == "US" else "EU",
            }
    return {"data": result}


import time as _time
_PCT_CACHE: dict = {}


@app.get("/api/valuation/percentile")
def valuation_percentile(code: str = Query(...)):
    """PE-TTM / PB 历史分位（近5年）。全站缓存 30 分钟/代码（历史序列日频、变化慢）。"""
    code = _validate(code)
    hit = _PCT_CACHE.get(code)
    if hit and _time.time() - hit[0] < 1800:
        return {"data": hit[1]}
    try:
        data = astock.valuation_percentile(code)
        _PCT_CACHE[code] = (_time.time(), data)
        return {"data": data}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"估值分位异常：{e}") from e


_ANN_CACHE: dict = {}


@app.get("/api/announcements")
def announcements(code: str = Query(...)):
    """个股近期公告（东财，仅 requests）。缓存 15 分钟/代码。"""
    code = _validate(code)
    hit = _ANN_CACHE.get(code)
    if hit and _time.time() - hit[0] < 900:
        return {"data": hit[1]}
    try:
        data = astock.announcements(code)
        _ANN_CACHE[code] = (_time.time(), data)
        return {"data": data}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"公告源异常：{e}") from e


_FIN_CACHE: dict = {}


@app.get("/api/financials")
def financials(code: str = Query(...)):
    """财务关键指标（同花顺财务摘要，最新报告期）。缓存 30 分钟/代码。"""
    code = _validate(code)
    hit = _FIN_CACHE.get(code)
    if hit and _time.time() - hit[0] < 1800:
        return {"data": hit[1]}
    try:
        data = astock.financials(code)
        _FIN_CACHE[code] = (_time.time(), data)
        return {"data": data}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"财务摘要异常：{e}") from e


@app.get("/api/valuation")
def valuation(code: str = Query(...)):
    """完整估值：行情 + 一致预期 + 前向PE/PEG/消化年数。"""
    code = _validate(code)
    try:
        return {"data": astock.full_valuation(code)}
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"估值计算异常：{e}") from e


@app.get("/api/reports")
def reports(code: str = Query(...), pages: int = Query(2, ge=1, le=5)):
    """个股研报列表（东财，含 PDF 链接）。仅需 requests。"""
    code = _validate(code)
    try:
        rows = astock.eastmoney_reports(code, max_pages=pages)
        for r in rows:
            r["pdfUrl"] = astock.pdf_url(r.get("infoCode", "")) if r.get("infoCode") else None
        return {"data": rows}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"研报源异常：{e}") from e


@app.get("/api/news")
def news(code: str = Query(...), limit: int = Query(20, ge=1, le=50)):
    """个股新闻（东财，需 akshare）。"""
    code = _validate(code)
    try:
        return {"data": astock.stock_news(code, limit=limit)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"新闻源异常：{e}") from e


@app.get("/api/info")
def info(code: str = Query(...)):
    """个股基本面：行业/股本/上市时间（需 akshare）。"""
    code = _validate(code)
    try:
        return {"data": astock.individual_info(code)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"基本面源异常：{e}") from e


@app.get("/api/disclosure")
def disclosure(code: str = Query(...)):
    """巨潮公告列表（需 akshare）。"""
    code = _validate(code)
    try:
        return {"data": astock.disclosure(code)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"公告源异常：{e}") from e


@app.get("/api/kline")
def kline(code: str = Query(...), category: int = Query(4), offset: int = Query(60, ge=1, le=800)):
    """K线（需 mootdx）。category 4=日 5=周 6=月 11=60分钟。"""
    code = _validate(code)
    try:
        return {"data": astock.kline(code, category=category, offset=offset)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"K线源异常：{e}") from e


@app.get("/api/finance")
def finance(code: str = Query(...)):
    """季报财务快照（需 mootdx）。"""
    code = _validate(code)
    try:
        return {"data": astock.finance(code)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"财务源异常：{e}") from e


# ---------------------------------------------------------------------------
# 资金面 / 筹码 / 信号（东财数据中心，v3.3 并入）—— 均为「用户查的那只股」的公开数据。
# 东财有 1s 限流，这些多为日/季级静态数据，统一走 30 分钟缓存，进一步降低被封风险。
# ---------------------------------------------------------------------------

_DC_CACHE: dict = {}  # key=(endpoint, code) -> (ts, data)


def _cached(endpoint: str, code: str, ttl: int, fetch):
    key = (endpoint, code)
    hit = _DC_CACHE.get(key)
    if hit and _time.time() - hit[0] < ttl:
        return hit[1]
    data = fetch()
    _DC_CACHE[key] = (_time.time(), data)
    return data


@app.get("/api/margin")
def margin(code: str = Query(...)):
    """融资融券明细（东财，日级）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("margin", code, 1800, lambda: astock.margin_trading(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"融资融券异常：{e}") from e


@app.get("/api/block-trade")
def block_trade(code: str = Query(...)):
    """大宗交易（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("block", code, 1800, lambda: astock.block_trade(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"大宗交易异常：{e}") from e


@app.get("/api/holders")
def holders(code: str = Query(...)):
    """股东户数变化（东财，季度级）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("holders", code, 1800, lambda: astock.holder_num_change(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"股东户数异常：{e}") from e


@app.get("/api/dividend")
def dividend(code: str = Query(...)):
    """分红送转历史（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("dividend", code, 1800, lambda: astock.dividend_history(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"分红送转异常：{e}") from e


@app.get("/api/fund-flow")
def fund_flow(code: str = Query(...)):
    """个股资金流（东财 push2his，120 日主力净流入）。缓存 15 分钟。
    注：push2his 对部分大陆住宅 IP 有间歇风控，可能返回空（非代码问题）。"""
    code = _validate(code)
    try:
        return {"data": _cached("fundflow", code, 900, lambda: astock.stock_fund_flow_120d(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"资金流异常：{e}") from e


@app.get("/api/dragon-tiger")
def dragon_tiger(code: str = Query(...)):
    """龙虎榜：该股近期上榜记录 + 买卖席位 + 机构净买（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("dt", code, 1800, lambda: astock.dragon_tiger_board(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"龙虎榜异常：{e}") from e


@app.get("/api/lockup")
def lockup(code: str = Query(...)):
    """限售解禁日历：历史解禁 + 未来 90 天待解禁（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("lockup", code, 1800, lambda: astock.lockup_expiry(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"解禁日历异常：{e}") from e


@app.get("/api/blocks")
def blocks(code: str = Query(...)):
    """个股所属板块/概念归属（东财 slist）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("blocks", code, 1800, lambda: astock.concept_blocks(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"板块归属异常：{e}") from e


@app.get("/api/hot-concepts")
def hot_concepts(code: str = Query(...)):
    """个股当下被市场归到哪些概念在炒（东财热门概念命中）。缓存 15 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("hotcon", code, 900, lambda: astock.hot_concepts(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"热门概念异常：{e}") from e


@app.get("/api/investor-qa")
def investor_qa(code: str = Query(...)):
    """互动易问答（巨潮）：投资者提问 + 公司回复。缓存 15 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("irm", code, 900, lambda: astock.investor_qa(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"互动易异常：{e}") from e


@app.get("/api/industry")
def industry(top: int = Query(20, ge=5, le=50)):
    """全行业涨跌幅排名（东财行业板块，板块级、零个股名单）。缓存 5 分钟。"""
    key = ("industry", str(top))
    hit = _DC_CACHE.get(key)
    if hit and _time.time() - hit[0] < 300:
        return {"data": hit[1]}
    try:
        data = astock.industry_comparison(top_n=top)
        _DC_CACHE[key] = (_time.time(), data)
        return {"data": data}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"行业排名异常：{e}") from e
