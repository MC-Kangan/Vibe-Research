from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

import crypto_portfolio
import ibkr_analytics
import portfolio
import position_preferences
import position_service
from api.validation import validate_stock_symbol
from api.errors import ApiProblem


router = APIRouter(prefix="/api", tags=["positions"])


class HoldingIn(BaseModel):
    code: str
    shares: float
    cost: float
    include_in_total: bool = False


class HoldingTotalIn(BaseModel):
    include_in_total: bool


class CloseIn(BaseModel):
    code: str
    date: str
    price: float
    shares: float
    cost: float


class PositionRefreshIn(BaseModel):
    confirm_empty: bool = False


class PositionMappingIn(BaseModel):
    instrument_key: str
    provider_symbol: str
    price_multiplier: float = 1.0


class PositionPreferencesIn(BaseModel):
    items: list[str] = Field(default_factory=list, max_length=20)


class ManualCryptoIn(BaseModel):
    wallet_label: str = Field(min_length=1, max_length=80)
    asset: str = Field(min_length=2, max_length=16)
    quantity: float = Field(ge=0)
    unit_cost: float | None = Field(default=None, ge=0)
    cost_currency: str = Field(default="USD", min_length=3, max_length=3)


class CryptoCsvIn(BaseModel):
    content: str = Field(max_length=1_000_000)


@router.get("/portfolio")
def portfolio_get():
    try:
        return {"data": portfolio.get_portfolio()}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"持仓读取异常：{exc}") from exc


@router.post("/portfolio/holding")
def portfolio_add(request: HoldingIn):
    code = validate_stock_symbol(request.code)
    if request.shares <= 0:
        raise ApiProblem(400, "holding_quantity_invalid", "Holding quantity must be greater than zero.")
    return {"data": portfolio.add_holding(code, request.shares, request.cost, request.include_in_total)}


@router.put("/portfolio/holding/total")
def portfolio_holding_total(request: HoldingTotalIn, code: str = Query(...)):
    try:
        return {"data": portfolio.set_holding_in_total(validate_stock_symbol(code), request.include_in_total)}
    except KeyError as exc:
        raise ApiProblem(404, "manual_holding_not_found", "The manual stock holding was not found.") from exc


@router.delete("/portfolio/holding")
def portfolio_remove(code: str = Query(...)):
    return {"data": portfolio.remove_holding(validate_stock_symbol(code))}


@router.post("/portfolio/close")
def portfolio_close(request: CloseIn):
    code = validate_stock_symbol(request.code)
    if request.price <= 0 or request.shares <= 0:
        raise ApiProblem(400, "close_position_values_invalid", "Close price and quantity must be greater than zero.")
    date = (request.date or "").strip()
    if not date:
        raise ApiProblem(400, "close_date_required", "Close date is required.")
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise ApiProblem(400, "close_date_invalid", "Close date must use YYYY-MM-DD format.") from None
    return {"data": portfolio.close_position(code, date, request.price, request.shares, request.cost)}


@router.delete("/portfolio/close")
def portfolio_close_remove(index: int = Query(...)):
    return {"data": portfolio.remove_closed(index)}


@router.post("/portfolio/refresh")
def portfolio_refresh():
    try:
        return {"data": portfolio.get_portfolio()}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"刷新失败：{exc}") from exc


@router.get("/positions/current")
def positions_current():
    return {"data": position_service.get_current()}


@router.get("/positions/preferences")
def positions_preferences_get():
    return {"data": position_preferences.get()}


@router.put("/positions/preferences")
def positions_preferences_put(request: PositionPreferencesIn):
    try:
        return {"data": position_preferences.save(request.items)}
    except position_preferences.PositionPreferenceError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/positions/refresh")
def positions_refresh(request: PositionRefreshIn):
    try:
        return {"data": position_service.refresh(confirm_empty=request.confirm_empty)}
    except position_service.PositionServiceError as exc:
        message = str(exc)
        status = 429 if "cooling down" in message else 409 if "confirm_empty" in message else 503
        raise HTTPException(status, message) from exc


@router.post("/positions/refresh-all", status_code=202)
def positions_refresh_all():
    if not ibkr_analytics.configured():
        raise ApiProblem(503, "ibkr_not_configured", "IBKR Flex current-position import is not configured.")
    return {"data": ibkr_analytics.start_refresh()}


@router.get("/positions/refresh-status")
def positions_refresh_status(job_id: str | None = None):
    return {"data": ibkr_analytics.refresh_status(job_id)}


@router.get("/positions/analytics")
def positions_analytics(range_name: str = Query("3m", alias="range")):
    try:
        return {"data": ibkr_analytics.analytics(range_name)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/positions/instruments")
def positions_instruments(status: str = Query("all")):
    if status not in {"all", "open", "closed"}:
        raise HTTPException(400, "status must be all, open, or closed")
    return {"data": ibkr_analytics.list_instruments(status)}


@router.get("/positions/chart")
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


@router.post("/positions/mappings")
def positions_mapping(request: PositionMappingIn):
    try:
        return {"data": ibkr_analytics.save_mapping(
            request.instrument_key,
            request.provider_symbol,
            request.price_multiplier,
        )}
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/portfolio/crypto")
def crypto_portfolio_get(reporting_currency: str = Query("USD", min_length=3, max_length=3)):
    return {"data": crypto_portfolio.get_crypto_portfolio(reporting_currency)}


@router.get("/positions/crypto/current")
def crypto_positions_current():
    return {"data": crypto_portfolio.get_coinbase_snapshot()}


@router.post("/positions/crypto/refresh")
def crypto_positions_refresh():
    try:
        return {"data": crypto_portfolio.refresh_coinbase()}
    except crypto_portfolio.CryptoPortfolioError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.post("/portfolio/crypto/manual")
def crypto_manual_upsert(request: ManualCryptoIn):
    try:
        return {"data": crypto_portfolio.upsert_manual(request.model_dump())}
    except crypto_portfolio.CryptoPortfolioError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/portfolio/crypto/manual")
def crypto_manual_remove(wallet_label: str = Query(...), asset: str = Query(...)):
    return {"data": crypto_portfolio.remove_manual(wallet_label, asset)}


@router.post("/portfolio/crypto/import/preview")
def crypto_csv_preview(request: CryptoCsvIn):
    try:
        return {"data": {"rows": crypto_portfolio.parse_csv(request.content)}}
    except crypto_portfolio.CryptoPortfolioError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/portfolio/crypto/import")
def crypto_csv_commit(request: CryptoCsvIn):
    try:
        return {"data": crypto_portfolio.commit_csv(request.content)}
    except crypto_portfolio.CryptoPortfolioError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/portfolio/summary")
def portfolio_summary(reporting_currency: str | None = Query(default=None, min_length=3, max_length=3)):
    return {"data": crypto_portfolio.combined_summary(reporting_currency)}
