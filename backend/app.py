"""Vibe-Research 后端 —— A股数据层 HTTP 接口（FastAPI）。

端点全部在 /api 下，前端 vite 代理 /api → localhost:8900。
只读、无状态、按用户传入代码返回客观数据。不预置标的、不建议。

启动：
    uvicorn app:app --host 127.0.0.1 --port 8900
"""

from __future__ import annotations

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import auth as auth_layer
from api.a_share_routes import router as a_share_router
from api.ai_routes import router as ai_router
from api.auth_routes import router as auth_router
from api.market_routes import router as market_router
from api.position_routes import router as position_router
from api.report_routes import router as report_router
from api.research_routes import router as research_router
from api.errors import ApiProblem

app = FastAPI(title="Vibe-Research API", version="0.3.0")
app.include_router(report_router)
app.include_router(research_router)
app.include_router(position_router)
app.include_router(auth_router)
app.include_router(ai_router)
app.include_router(market_router)
app.include_router(a_share_router)


@app.exception_handler(ApiProblem)
async def api_problem_handler(_request: Request, exc: ApiProblem):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "code": exc.code, "params": exc.params},
        headers=exc.headers,
    )

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
                {"detail": "Authentication is required", "code": "authentication_required", "params": {}},
                status_code=401,
                headers={"Cache-Control": "no-store"},
            )
    response = await call_next(request)
    if auth_layer.enabled() and is_api and request.url.path != "/api/health":
        response.headers.setdefault("Cache-Control", "no-store")
    return response

@app.get("/api/health")
def health():
    return {"ok": True, "service": "vibe-research-api", "version": "0.3.0"}
