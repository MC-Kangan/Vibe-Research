"""Small read-only bridge from Vibe market data to TradeAgent skills."""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

import requests

import astock
import market_data
import tools as data_tools
from market_data.yahoo import YahooProvider

ALLOWED_SKILLS = {"worth-buy-stocks", "markov-method"}
_A_SHARE_BENCHMARKS = {"CSI300": ("000300", "SSE"), "CSI500": ("000905", "SSE")}
_EU_INDEXES = {"SXXP": ("^STOXX", "INDEX"), "SX5E": ("^STOXX50E", "INDEX")}


class ResearchClientError(RuntimeError):
    """Safe error raised for TradeAgent configuration or transport failures."""


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
    return {"Authorization": f"Bearer {os.environ.get('VR_TRADE_RESEARCH_API_TOKEN', '').strip()}"}


def _timeout() -> float:
    try:
        return max(3.0, min(float(os.environ.get("VR_TRADE_RESEARCH_TIMEOUT_SECONDS", "30")), 120.0))
    except ValueError:
        return 30.0


def list_skills() -> list[dict[str, Any]]:
    if not configured():
        raise ResearchClientError("TradeAgent is not configured")
    try:
        response = requests.get(f"{_base_url()}/skills", headers=_headers(), timeout=_timeout())
    except requests.RequestException as exc:
        raise ResearchClientError("TradeAgent is unreachable") from exc
    if response.status_code in {401, 403}:
        raise ResearchClientError("TradeAgent authentication failed")
    if response.status_code >= 400:
        raise ResearchClientError(f"TradeAgent returned status {response.status_code}")
    payload = response.json()
    if not isinstance(payload, list):
        raise ResearchClientError("TradeAgent returned an invalid skills payload")
    return [item for item in payload if isinstance(item, dict) and item.get("name") in ALLOWED_SKILLS]


def run_skill(
    *,
    skill: str,
    symbol: str,
    market: str,
    skill_parameters: dict[str, dict[str, Any]],
    price_series: list[dict[str, Any]],
) -> dict[str, Any]:
    if skill not in ALLOWED_SKILLS:
        raise ResearchClientError("Selected skill is not enabled")
    request = {
        "instrument": {"symbol": symbol, "market": market},
        "analysts": [skill],
        "skill_parameters": skill_parameters,
        "price_series": price_series,
    }
    try:
        response = requests.post(
            f"{_base_url()}/skills/{skill}/run",
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
        raise ResearchClientError(str(detail or f"TradeAgent returned status {response.status_code}"))
    payload = response.json()
    if not isinstance(payload, dict):
        raise ResearchClientError("TradeAgent returned an invalid report payload")
    return payload


def build_run_inputs(symbol: str, skills: list[str], parameters: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Resolve one target and all default skill benchmarks into one shared payload."""
    canonical = (symbol or "").strip().upper()
    if canonical.isdigit() and len(canonical) == 6:
        market = _a_share_market(canonical)
        target_symbol = canonical
    else:
        resolved = market_data.resolve_symbol(canonical)
        target_symbol = resolved.provider_symbol
        market = "EU" if resolved.exchange.country != "US" else "US"

    required = {"target": (target_symbol, market)}
    if "worth-buy-stocks" in skills:
        requested = str(parameters.get("worth-buy-stocks", {}).get("benchmark_symbols", "AUTO"))
        labels = [item.strip().upper() for item in requested.split(",") if item.strip()]
        if not labels or labels == ["AUTO"]:
            labels = ["CSI300", "CSI500"] if market in {"SSE", "SZSE", "BJSE"} else (
                ["SXXP", "SX5E"] if market == "EU" else ["SPY", "QQQ"]
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
                    raise ResearchClientError("Target price history is unavailable") from exc
                continue
            series[result_key] = payload

    target_payload = series.get("target")
    if target_payload is None:
        raise ResearchClientError("Target price history is unavailable")
    return {
        "symbol": target_symbol,
        "market": market,
        "price_series": list(series.values()),
    }


def _benchmark_identity(label: str, target_market: str) -> tuple[str, str]:
    if label in _A_SHARE_BENCHMARKS:
        return _A_SHARE_BENCHMARKS[label]
    if label in _EU_INDEXES:
        return _EU_INDEXES[label]
    if label.isdigit() and len(label) == 6:
        return label, _a_share_market(label)
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
        data = market_data.get_bars(symbol, "2y", "1d")
        rows = data.bars
        source = "yahoo"
    bars = []
    for row in rows:
        date_value = row.get("date") if isinstance(row, dict) else row.date
        observed_at = _to_iso(date_value)
        close = getattr(row, "close", None) if not isinstance(row, dict) else row.get("close")
        if close is None:
            continue
        get = (lambda name: getattr(row, name, None)) if not isinstance(row, dict) else row.get
        bars.append({
            "observed_at": observed_at,
            "open": get("open"),
            "high": get("high"),
            "low": get("low"),
            "close": close,
            "volume": get("volume"),
        })
    if not bars:
        raise ResearchClientError("No usable daily bars returned")
    return {"instrument": {"symbol": symbol, "market": market}, "source": source, "bars": bars[-520:]}


def _a_share_history(symbol: str, market: str) -> tuple[list[dict[str, Any]], str]:
    prefix = {"SSE": "sh", "SZSE": "sz", "BJSE": "bj"}[market]
    try:
        prefix = {"SSE": "sh", "SZSE": "sz", "BJSE": "bj"}[market]
        rows = data_tools._kline_tencent(symbol, "day", 520, prefix=prefix)  # shared Vibe A-share path
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
