from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import astock
import crypto_portfolio
import gstock
import instrument_overview
import market
import market_data
import market_intelligence
import newsradar
from api.validation import validate_stock_symbol


router = APIRouter(tags=["market-data"])
_validate_stock_symbol = validate_stock_symbol


@router.get("/api/instruments/overview")
def instrument_overview_get(
    symbol: str = Query(..., min_length=1, max_length=24),
    asset_type: str = Query("equity"),
):
    """Resolve the market server-side and return partial-safe core dashboard data."""
    try:
        return {"data": instrument_overview.get_overview(symbol, asset_type)}
    except market_data.MarketDataError as exc:
        raise _market_data_http_error(exc) from exc


@router.get("/api/radar")
def radar():
    """资讯雷达：12 赛道公开 RSS 资讯（读缓存，无缓存返回赛道骨架）。"""
    try:
        return {"data": newsradar.get_radar(force=False)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"资讯雷达异常：{e}") from e


@router.post("/api/radar/refresh")
def radar_refresh():
    """强制重抓全部 RSS 源（耗时约 20-40s），更新缓存。"""
    try:
        return {"data": newsradar.fetch_radar()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"资讯雷达刷新失败：{e}") from e


@router.get("/api/market/overview")
def market_overview():
    """市场情绪 + 板块资金流（板块/大盘级，全站共享缓存 5 分钟）。"""
    try:
        return {"data": market.get_overview()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"市场总览异常：{e}") from e


@router.get("/api/market/emotion")
def market_emotion():
    """短线情绪：连板梯队 / 最高连板 / 炸板率 / 封板率 / 晋级率 / 涨跌停家数。

    含连板梯队个股清单（code/name/连板数等）——2026-07-05 起如实展示客观公开榜单（东财同款），
    只呈现事实，不附推荐/评分/预测/买卖时机。全站共享缓存 5 分钟。
    """
    try:
        return {"data": market.get_short_term_emotion()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"短线情绪异常：{e}") from e


@router.get("/api/market/turnover-top")
def market_turnover_top():
    """全市场成交额榜 Top20（客观公开榜单数据，非推荐/非预测/不评分）。全站共享缓存 5 分钟。"""
    try:
        return {"data": market.get_turnover_top()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"成交额榜异常：{e}") from e


@router.get("/api/global/indices")
def global_indices():
    """全球指数快照（道指 / 标普500 / 纳斯达克 / 恒生 / 恒生科技）—— A 股看隔夜外围脸色。缓存 5 分钟。"""
    try:
        return {"data": market.get_global_indices()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"全球指数异常：{e}") from e


@router.get("/api/market-data/benchmarks")
def market_data_benchmarks():
    """US/European headline benchmark snapshots for the primary landing view."""
    return {"data": market_data.get_benchmarks()}


@router.get("/api/market-data/overview")
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


@router.get("/api/market-data/mood")
def market_data_mood(market_name: str = Query("US", alias="market")):
    """Cached daily mood statistics for the US or EURO STOXX 50 basket."""
    if market_name not in {"US", "Europe"}:
        raise HTTPException(400, "market 仅支持 US 或 Europe")
    return {"data": market_data.get_market_mood(market_name)}


@router.get("/api/market-data/crypto/overview")
def market_data_crypto_overview():
    """BTC plus large-cap altcoins with market-wide crypto context."""
    return {"data": market_data.get_crypto_overview()}


@router.get("/api/market-data/crypto/context")
def market_data_crypto_context(symbol: str = Query(..., min_length=2, max_length=16)):
    return {"data": market_data.get_crypto_asset_context(symbol)}


@router.get("/api/data-sources/status")
def data_sources_status():
    """Configuration status only; never returns provider credentials."""
    return {"data": {
        "yahoo": {"configured": True, "coverage": "US/Europe quotes and daily history"},
        "yahoo_company_news": {"configured": True, "coverage": "Best-effort no-key US/Europe company-news fallback"},
        "sec_edgar": {"configured": bool(os.environ.get("VR_SEC_USER_AGENT", "").strip()), "coverage": "US filings and selected XBRL facts"},
        "finnhub": {"configured": bool(os.environ.get("VR_FINNHUB_API_KEY", "").strip()), "coverage": "Company news and earnings where Finnhub's configured plan provides coverage"},
        "europe_filings": {"configured": False, "coverage": "European regulatory filings not yet connected"},
        "coinbase_market": {"configured": True, "coverage": "Public USD spot quotes and daily candles"},
        "coinbase_account": {"configured": crypto_portfolio.coinbase_configured(), "coverage": "Read-only Coinbase balances"},
        "coingecko": {"configured": bool(os.environ.get("VR_COINGECKO_API_KEY", "").strip()), "coverage": "Crypto market rank, breadth, dominance and metadata"},
    }}


class IntelligenceFeedReq(BaseModel):
    symbols: list[str]
    kinds: list[str] = ["filings", "news", "earnings"]
    limit_per_symbol: int = 5


@router.post("/api/intelligence/feed")
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


@router.get("/api/global/stock")
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


@router.get("/api/global/hk/cashflow")
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


@router.get("/api/market-data/snapshot")
def market_data_snapshot(
    symbol: str = Query(..., min_length=1, max_length=24),
    asset_type: str = Query("equity"),
):
    """美股或欧洲原生上市股票快照；欧洲要求显式交易所后缀。"""
    try:
        return {"data": market_data.get_snapshot(symbol) if asset_type == "equity" else market_data.get_snapshot(symbol, asset_type)}
    except market_data.MarketDataError as exc:
        raise _market_data_http_error(exc) from exc


@router.get("/api/market-data/bars")
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


@router.get("/api/market-data/news")
def market_data_news(
    symbol: str = Query(..., min_length=1, max_length=24),
    days: int = Query(30, ge=1, le=365),
):
    """Company news via configured Finnhub, with an explicit Yahoo Search fallback."""
    try:
        return {"data": market_data.get_company_news(symbol, days=days)}
    except market_data.MarketDataError as exc:
        raise _market_data_http_error(exc) from exc


@router.get("/api/market-data/earnings")
def market_data_earnings(symbol: str = Query(..., min_length=1, max_length=24)):
    """Finnhub historical earnings and estimates for coverage validation."""
    try:
        return {"data": market_data.get_earnings(symbol)}
    except market_data.MarketDataError as exc:
        raise _market_data_http_error(exc) from exc


@router.get("/api/market-data/filings")
def market_data_filings(symbol: str = Query(..., min_length=1, max_length=24)):
    """Authoritative SEC EDGAR filings for US issuers."""
    try:
        return {"data": market_data.get_filings(symbol)}
    except market_data.MarketDataError as exc:
        raise _market_data_http_error(exc) from exc


@router.get("/api/market-data/sec-facts")
def market_data_sec_facts(symbol: str = Query(..., min_length=1, max_length=24)):
    """Selected latest company facts from SEC XBRL companyfacts."""
    try:
        return {"data": market_data.get_company_facts(symbol)}
    except market_data.MarketDataError as exc:
        raise _market_data_http_error(exc) from exc


@router.get("/api/indices")
def indices():
    """A股大盘指数实时行情（上证/深证成指/创业板指/沪深300）。仅标准库。"""
    try:
        return {"data": astock.index_quote()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"指数行情异常：{e}") from e


@router.get("/api/quote")
def quote(codes: str = Query(..., description="逗号分隔的 6 位代码")):
    """实时行情：现价/涨跌/PE/PB/市值/换手/涨跌停。仅标准库，永远可用。"""
    lst = [c.strip() for c in codes.split(",") if c.strip()]
    if not lst or any(not c.isdigit() or len(c) != 6 for c in lst):
        raise HTTPException(400, "codes 必须是逗号分隔的 6 位数字")
    try:
        return {"data": astock.tencent_quote(lst)}
    except Exception as e:  # noqa: BLE001 — 边界统一兜底
        raise HTTPException(502, f"行情源异常：{e}") from e


@router.get("/api/quotes")
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
