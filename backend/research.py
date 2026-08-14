"""Small read-only bridge from Vibe market data to TradeAgent skills."""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

import requests

import astock
import instrument_overview
import market_data
import tools as data_tools
from market_data.yahoo import YahooProvider

ALLOWED_SKILLS = {
    "fundamental",
    "filings",
    "worth-buy-stocks",
    "markov-method",
    "technical-basic",
    "risk-analysis",
    "volatility-regime",
    "correlation-analysis",
    "asset-allocation",
    "backtesting",
}
PORTFOLIO_SKILLS = {"correlation-analysis", "asset-allocation"}
INSTRUMENT_SKILLS = ALLOWED_SKILLS - PORTFOLIO_SKILLS - {"backtesting"}
PRICE_SERIES_SKILLS = {
    "worth-buy-stocks",
    "markov-method",
    "technical-basic",
    "risk-analysis",
    "volatility-regime",
    "backtesting",
}
DEFAULT_SKILL_ASSET_TYPES = {
    "fundamental": ("equity",),
    "filings": ("equity",),
    "worth-buy-stocks": ("equity",),
    "markov-method": ("equity", "crypto"),
    "technical-basic": ("equity", "crypto"),
    "risk-analysis": ("equity", "crypto"),
    "volatility-regime": ("equity", "crypto"),
    "correlation-analysis": ("equity", "crypto"),
    "asset-allocation": ("equity", "crypto"),
    "backtesting": ("equity", "crypto"),
}
_A_SHARE_BENCHMARKS = {"CSI300": ("000300", "SSE"), "CSI500": ("000905", "SSE")}
_EU_INDEXES = {"SXXP": ("^STOXX", "INDEX"), "SX5E": ("^STOXX50E", "INDEX")}


class ResearchClientError(RuntimeError):
    """Safe error raised for TradeAgent configuration or transport failures."""


class UnsupportedSkillAssetError(ResearchClientError):
    """Selected skills cannot operate on the requested asset type."""


class BacktestInputError(ResearchClientError):
    """The requested backtest cannot be evaluated against available bars."""


def configured() -> bool:
    return (
        os.environ.get("VR_TRADE_RESEARCH_ENABLED", "false").strip().lower()
        in {"1", "true", "yes", "on"}
        and bool(os.environ.get("VR_TRADE_RESEARCH_BASE_URL", "").strip())
        and bool(os.environ.get("VR_TRADE_RESEARCH_API_TOKEN", "").strip())
    )


def _base_url() -> str:
    return os.environ.get("VR_TRADE_RESEARCH_BASE_URL", "").strip().rstrip("/")


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {os.environ.get('VR_TRADE_RESEARCH_API_TOKEN', '').strip()}"
    }


def _timeout() -> float:
    try:
        return max(
            3.0,
            min(
                float(os.environ.get("VR_TRADE_RESEARCH_TIMEOUT_SECONDS", "30")), 120.0
            ),
        )
    except ValueError:
        return 30.0


def list_skills() -> list[dict[str, Any]]:
    if not configured():
        raise ResearchClientError("TradeAgent is not configured")
    try:
        response = requests.get(
            f"{_base_url()}/skills", headers=_headers(), timeout=_timeout()
        )
    except requests.RequestException as exc:
        raise ResearchClientError("TradeAgent is unreachable") from exc
    if response.status_code in {401, 403}:
        raise ResearchClientError("TradeAgent authentication failed")
    if response.status_code >= 400:
        raise ResearchClientError(f"TradeAgent returned status {response.status_code}")
    payload = response.json()
    if not isinstance(payload, list):
        raise ResearchClientError("TradeAgent returned an invalid skills payload")
    result = []
    for item in payload:
        if isinstance(item, dict) and item.get("name") in ALLOWED_SKILLS:
            name = str(item["name"])
            declared = item.get("supported_asset_types")
            supported = (
                [value for value in declared if value in {"equity", "crypto"}]
                if isinstance(declared, list)
                else list(DEFAULT_SKILL_ASSET_TYPES[name])
            )
            result.append({**item, "supported_asset_types": supported})
    return result


def validate_skill_support(
    skills: list[str], asset_type: str, catalog: list[dict[str, Any]] | None = None
) -> None:
    if asset_type not in {"equity", "crypto"}:
        raise UnsupportedSkillAssetError("asset_type must be equity or crypto")
    available = catalog if catalog is not None else list_skills()
    support_by_name = {
        str(item.get("name")): item.get("supported_asset_types", [])
        for item in available
        if isinstance(item, dict)
    }
    unsupported = [
        skill for skill in skills if asset_type not in support_by_name.get(skill, [])
    ]
    if unsupported:
        raise UnsupportedSkillAssetError(
            f"Skills do not support {asset_type}: {', '.join(unsupported)}"
        )
    unavailable = {
        str(item.get("name")): item.get("missing_capabilities", [])
        for item in available
        if isinstance(item, dict) and item.get("available") is False
    }
    selected_unavailable = [skill for skill in skills if skill in unavailable]
    if selected_unavailable:
        details = ", ".join(
            f"{skill} ({'/'.join(map(str, unavailable[skill])) or 'provider'})"
            for skill in selected_unavailable
        )
        raise ResearchClientError(f"Skill providers are not configured: {details}")


def run_analysis(
    *,
    skills: list[str],
    symbol: str,
    market: str,
    skill_parameters: dict[str, dict[str, Any]],
    price_series: list[dict[str, Any]],
    scope: str = "instrument",
    portfolio_instruments: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    if not skills or any(skill not in ALLOWED_SKILLS for skill in skills):
        raise ResearchClientError("Selected skills are not enabled")
    request = {
        "instrument": {"symbol": symbol, "market": market},
        "analysts": skills,
        "skill_parameters": skill_parameters,
        "price_series": price_series,
        "scope": scope,
        "portfolio_instruments": portfolio_instruments or [],
    }
    try:
        response = requests.post(
            f"{_base_url()}/analyze",
            json=request,
            headers={**_headers(), "Content-Type": "application/json"},
            timeout=_timeout(),
        )
    except requests.RequestException as exc:
        raise ResearchClientError("TradeAgent is unreachable") from exc
    if response.status_code in {401, 403}:
        raise ResearchClientError("TradeAgent authentication failed")
    if response.status_code == 503:
        raise ResearchClientError("TradeAgent capability is unavailable")
    if response.status_code >= 400:
        try:
            detail = response.json().get("detail")
        except (TypeError, ValueError):
            detail = None
        raise ResearchClientError(
            str(detail or f"TradeAgent returned status {response.status_code}")
        )
    payload = response.json()
    if not isinstance(payload, dict):
        raise ResearchClientError("TradeAgent returned an invalid report payload")
    return payload


def _split_full_report(
    report: dict[str, Any], selected: list[str]
) -> list[dict[str, Any]]:
    """Preserve the UI's one-report-per-skill shape from one batch report."""
    report_results = report.get("results")
    if not isinstance(report_results, list):
        raise ResearchClientError("TradeAgent returned an invalid report payload")
    by_skill = {
        str(item.get("analyst")): item
        for item in report_results
        if isinstance(item, dict) and item.get("analyst")
    }
    shared = {key: value for key, value in report.items() if key != "results"}
    return [
        (
            {
                "skill": skill,
                "status": "complete",
                "report": {**shared, "results": [by_skill[skill]]},
            }
            if skill in by_skill
            else {
                "skill": skill,
                "status": "failed",
                "detail": "TradeAgent did not return a result for the selected skill",
            }
        )
        for skill in selected
    ]


def run_skills_full(
    *,
    symbol: str,
    skills: list[str],
    parameters: dict[str, dict[str, Any]] | None = None,
    asset_type: str = "equity",
) -> dict[str, Any]:
    """Prepare market evidence once and return full per-skill UI reports."""
    selected = list(dict.fromkeys(skills))
    if not selected:
        return {"symbol": symbol, "market": "", "results": []}
    unknown = [skill for skill in selected if skill not in ALLOWED_SKILLS]
    if unknown:
        raise ResearchClientError(
            f"Selected skills are not enabled: {', '.join(unknown)}"
        )
    if not configured():
        raise ResearchClientError("TradeAgent is not configured")

    skill_parameters = parameters or {}
    validate_skill_support(selected, asset_type, list_skills())
    inputs = build_run_inputs(symbol, selected, skill_parameters, asset_type)
    report = run_analysis(
        skills=selected,
        symbol=inputs["symbol"],
        market=inputs["market"],
        skill_parameters=skill_parameters,
        price_series=inputs["price_series"],
    )
    return {
        "symbol": inputs["symbol"],
        "market": inputs["market"],
        "asset_type": asset_type,
        "results": _split_full_report(report, selected),
    }


def run_portfolio_analysis(
    *,
    instruments: list[dict[str, str]],
    method: str = "risk_parity",
    lookback: int = 120,
) -> dict[str, Any]:
    """Run fixed multi-asset skills against one bounded inline-series batch."""
    if not configured():
        raise ResearchClientError("TradeAgent is not configured")
    if not 2 <= len(instruments) <= 9:
        raise ResearchClientError("Select between 2 and 9 instruments")
    resolved: list[tuple[str, str, str]] = []
    for item in instruments:
        symbol, market = _resolve_target(
            item.get("symbol", ""), item.get("asset_type", "")
        )
        resolved.append((symbol, market, item["asset_type"]))
    identities = [(symbol, market) for symbol, market, _ in resolved]
    if len(set(identities)) != len(identities):
        raise ResearchClientError("Portfolio instruments must be unique")

    series: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=len(resolved)) as executor:
        futures = {
            executor.submit(_load_series, symbol, market): (symbol, market)
            for symbol, market, _ in resolved
        }
        for future in as_completed(futures):
            symbol, _market = futures[future]
            try:
                series.append(future.result())
            except Exception as exc:  # noqa: BLE001
                raise ResearchClientError(
                    f"Price history is unavailable for {symbol}"
                ) from exc

    report = run_analysis(
        skills=["correlation-analysis", "asset-allocation"],
        symbol="BASKET",
        market="PORTFOLIO",
        skill_parameters={
            "correlation-analysis": {
                "lookback": lookback,
            },
            "asset-allocation": {
                "method": method,
                "lookback": lookback,
            },
        },
        price_series=series,
        scope="portfolio",
        portfolio_instruments=[
            {"symbol": symbol, "market": market} for symbol, market in identities
        ],
    )
    return {
        **report,
        "instruments": [
            {"symbol": symbol, "market": market, "asset_type": asset_type}
            for symbol, market, asset_type in resolved
        ],
    }


def run_backtest(
    *,
    symbol: str,
    asset_type: str,
    start_date: str,
    strategy: dict[str, Any],
    initial_cash: float = 1_000,
    minimum_holding_bars: int = 1,
    commission: float = 0.001,
    spread: float = 0,
    position_size: float = 0.95,
) -> dict[str, Any]:
    """Run the dedicated daily playground flow through TradeAgent once."""
    if not configured():
        raise ResearchClientError("TradeAgent is not configured")
    catalog = list_skills()
    validate_skill_support(["backtesting"], asset_type, catalog)
    target_symbol, market = _resolve_target(symbol, asset_type)
    if market not in {"US", "CRYPTO"}:
        raise BacktestInputError(
            "Backtesting currently supports USD-quoted US stocks and crypto only."
        )
    series = _load_series(target_symbol, market)
    today = datetime.now(timezone.utc).date()
    completed = [
        bar for bar in series["bars"]
        if datetime.fromisoformat(str(bar["observed_at"]).replace("Z", "+00:00")).date() < today
    ]
    if not completed:
        raise BacktestInputError("No completed daily bars are available")
    requested = datetime.fromisoformat(start_date).date()
    first = datetime.fromisoformat(completed[0]["observed_at"].replace("Z", "+00:00")).date()
    last = datetime.fromisoformat(completed[-1]["observed_at"].replace("Z", "+00:00")).date()
    if requested < first or requested > last:
        raise BacktestInputError(
            f"Start date must be between {first.isoformat()} and {last.isoformat()}"
        )
    price_series = [{**series, "bars": completed}]
    report = run_analysis(
        skills=["backtesting"],
        symbol=target_symbol,
        market=market,
        skill_parameters={
            "backtesting": {
                "start_date": start_date,
                "minimum_holding_bars": minimum_holding_bars,
                "cash": initial_cash,
                "commission": commission,
                "spread": spread,
                "position_size": position_size,
                "strategy": strategy,
            }
        },
        price_series=price_series,
    )
    results = report.get("results")
    if not isinstance(results, list) or not results:
        raise ResearchClientError("TradeAgent returned an invalid backtest report")
    return {
        "symbol": target_symbol,
        "market": market,
        "asset_type": asset_type,
        "currency": "USD",
        "available_start_date": first.isoformat(),
        "available_end_date": last.isoformat(),
        "result": results[0],
    }


def _compact_analyst_result_for_ai(result: dict[str, Any]) -> dict[str, Any]:
    presentation = result.get("presentation")
    compact_presentation: Any = presentation
    if isinstance(presentation, dict):
        compact_presentation = {
            key: compact_report_for_ai(item)
            for key, item in presentation.items()
            if key not in {"price_bars", "regime_points"}
        }
        if isinstance(presentation.get("price_bars"), list):
            compact_presentation["price_bar_count"] = len(presentation["price_bars"])
        if isinstance(presentation.get("regime_points"), list):
            points = presentation["regime_points"]
            compact_presentation["regime_point_count"] = len(points)
            compact_presentation["recent_regime_points"] = [
                compact_report_for_ai(item) for item in points[-12:]
            ]

    observations = []
    for item in result.get("observations") or []:
        if not isinstance(item, dict):
            continue
        observation = {
            key: compact_report_for_ai(item.get(key))
            for key in ("metric", "value", "source", "observed_at")
            if item.get(key) is not None
        }
        provenance = item.get("provenance")
        if isinstance(provenance, dict):
            compact_provenance = {
                key: provenance.get(key)
                for key in (
                    "algorithm",
                    "window",
                    "point_count",
                    "start_at",
                    "end_at",
                    "input_provider_kind",
                )
                if provenance.get(key) is not None
            }
            if compact_provenance:
                observation["provenance"] = compact_provenance
        observations.append(observation)

    # Put presentation and observations before secondary metadata.  Dossier
    # rendering is bounded, so this ordering guarantees that benchmark status,
    # factor scores and confirmation checks reach the model first.
    return {
        "analyst": result.get("analyst"),
        "status": result.get("status"),
        "signal": result.get("signal"),
        "summary": result.get("summary"),
        "presentation": compact_presentation,
        "observations": observations,
        "missing_metrics": compact_report_for_ai(result.get("missing_metrics") or []),
        "limitations": compact_report_for_ai(result.get("limitations") or []),
        "methods": compact_report_for_ai(result.get("methods") or []),
        "inference": result.get("inference"),
    }


def compact_report_for_ai(value: Any) -> Any:
    """Bound TradeAgent output before it enters an LLM context.

    Reports may contain hundreds of chart points.  The UI keeps the full report,
    while AI workflows need the conclusions, tables and only a small recent
    sample of long arrays.
    """
    if isinstance(value, dict) and isinstance(value.get("results"), list):
        return {
            "instrument": compact_report_for_ai(value.get("instrument")),
            "generated_at": value.get("generated_at"),
            "results": [
                _compact_analyst_result_for_ai(item)
                for item in value["results"]
                if isinstance(item, dict)
            ],
        }
    if isinstance(value, dict):
        return {str(key): compact_report_for_ai(item) for key, item in value.items()}
    if isinstance(value, list):
        items = [compact_report_for_ai(item) for item in value]
        if len(items) > 30:
            return {"total_items": len(items), "recent_items": items[-30:]}
        return items
    if isinstance(value, str) and len(value) > 2_000:
        return value[:2_000] + "…"
    return value


def run_skills_shared(
    *,
    symbol: str,
    skills: list[str],
    parameters: dict[str, dict[str, Any]] | None = None,
    asset_type: str = "equity",
) -> dict[str, Any]:
    """Run approved skills against one shared, market-qualified price payload."""
    full = run_skills_full(
        symbol=symbol,
        skills=skills,
        parameters=parameters,
        asset_type=asset_type,
    )
    return {
        **full,
        "results": [
            (
                {**item, "report": compact_report_for_ai(item["report"])}
                if item.get("status") == "complete"
                and isinstance(item.get("report"), dict)
                else item
            )
            for item in full["results"]
        ],
    }


def run_skill_for_ai(
    *,
    symbol: str,
    skill: str,
    parameters: dict[str, Any] | None = None,
    asset_type: str = "equity",
) -> dict[str, Any]:
    """Controlled Vibe-method bridge used by function-calling AI workflows."""
    return run_skills_shared(
        symbol=symbol,
        skills=[skill],
        parameters={skill: parameters or {}},
        asset_type=asset_type,
    )


def build_run_inputs(
    symbol: str,
    skills: list[str],
    parameters: dict[str, dict[str, Any]],
    asset_type: str = "equity",
) -> dict[str, Any]:
    """Resolve one target and all default skill benchmarks into one shared payload."""
    target_symbol, market = _resolve_target(symbol, asset_type)

    if not PRICE_SERIES_SKILLS.intersection(skills):
        return {
            "symbol": target_symbol,
            "market": market,
            "asset_type": asset_type,
            "price_series": [],
        }

    required = {"target": (target_symbol, market)}
    if "worth-buy-stocks" in skills:
        requested = str(
            parameters.get("worth-buy-stocks", {}).get("benchmark_symbols", "AUTO")
        )
        labels = [item.strip().upper() for item in requested.split(",") if item.strip()]
        if not labels or labels == ["AUTO"]:
            labels = (
                ["BTC-USD", "ETH-USD"]
                if market == "CRYPTO"
                else (
                    ["CSI300", "CSI500"]
                    if market in {"SSE", "SZSE", "BJSE"}
                    else (["SXXP", "SX5E"] if market == "EU" else ["SPY", "QQQ"])
                )
            )
        for label in labels[:8]:
            required[f"benchmark:{label}"] = _benchmark_identity(label, market)

    def load(item: tuple[str, tuple[str, str]]) -> tuple[str, dict[str, Any]]:
        key, identity = item
        return key, _load_series(identity[0], identity[1])

    series: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=min(9, len(required))) as executor:
        futures = {executor.submit(load, item): item[0] for item in required.items()}
        for future in as_completed(futures):
            key = futures[future]
            try:
                result_key, payload = future.result()
            except Exception as exc:  # noqa: BLE001 — benchmark gaps are reported by the skill
                if key == "target":
                    raise ResearchClientError(
                        "Target price history is unavailable"
                    ) from exc
                continue
            series[result_key] = payload

    target_payload = series.get("target")
    if target_payload is None:
        raise ResearchClientError("Target price history is unavailable")
    return {
        "symbol": target_symbol,
        "market": market,
        "asset_type": asset_type,
        "price_series": list(series.values()),
    }


def _resolve_target(symbol: str, asset_type: str) -> tuple[str, str]:
    try:
        return instrument_overview.resolve_research_identity(symbol, asset_type)
    except market_data.MarketDataError as exc:
        raise ResearchClientError(str(exc)) from exc


def _benchmark_identity(label: str, target_market: str) -> tuple[str, str]:
    if label in _A_SHARE_BENCHMARKS:
        return _A_SHARE_BENCHMARKS[label]
    if label in _EU_INDEXES:
        return _EU_INDEXES[label]
    if label.isdigit() and len(label) == 6:
        return label, _a_share_market(label)
    if target_market == "CRYPTO":
        return market_data.resolve_crypto_symbol(label), "CRYPTO"
    if target_market == "EU" and "." in label:
        return label, "EU"
    return label, "US"


def _load_series(symbol: str, market: str) -> dict[str, Any]:
    if market in {"SSE", "SZSE", "BJSE"}:
        rows, source = _a_share_history(symbol, market)
    elif market == "INDEX":
        rows = _yahoo_index_history(symbol)
        source = "yahoo"
    else:
        data = market_data.get_bars(
            symbol, "2y", "1d", "crypto" if market == "CRYPTO" else "equity"
        )
        rows = data.bars
        source = data.source
    bars = []
    for row in rows:
        date_value = row.get("date") if isinstance(row, dict) else row.date
        observed_at = _to_iso(date_value)
        close = (
            getattr(row, "close", None)
            if not isinstance(row, dict)
            else row.get("close")
        )
        if close is None:
            continue
        get = (
            (lambda name: getattr(row, name, None))
            if not isinstance(row, dict)
            else row.get
        )
        bars.append(
            {
                "observed_at": observed_at,
                "open": get("open"),
                "high": get("high"),
                "low": get("low"),
                "close": close,
                "volume": get("volume"),
            }
        )
    if not bars:
        raise ResearchClientError("No usable daily bars returned")
    return {
        "instrument": {"symbol": symbol, "market": market},
        "source": source,
        "bars": bars[-520:],
    }


def _a_share_history(symbol: str, market: str) -> tuple[list[dict[str, Any]], str]:
    prefix = {"SSE": "sh", "SZSE": "sz", "BJSE": "bj"}[market]
    try:
        prefix = {"SSE": "sh", "SZSE": "sz", "BJSE": "bj"}[market]
        rows = data_tools._kline_tencent(
            symbol, "day", 520, prefix=prefix
        )  # shared Vibe A-share path
        if rows:
            return rows, "tencent"
    except Exception:  # noqa: BLE001
        pass
    rows = astock.kline(symbol, category=4, offset=520)
    if not rows:
        raise ResearchClientError(f"No A-share history for {symbol}")
    return rows, "mootdx"


def _yahoo_index_history(symbol: str) -> list[Any]:
    return YahooProvider().bars(symbol, "2y", "1d")


def _a_share_market(symbol: str) -> str:
    if symbol.startswith(("4", "8")):
        return "BJSE"
    if symbol.startswith(("5", "6", "9")):
        return "SSE"
    return "SZSE"


def _to_iso(value: Any) -> str:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
