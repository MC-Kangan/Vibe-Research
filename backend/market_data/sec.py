"""SEC EDGAR adapter for authoritative US filings and selected XBRL facts."""

from __future__ import annotations

import os
import threading
import time

import requests

from .models import (
    InstrumentNotFoundError,
    ProviderConfigurationError,
    ProviderError,
    ProviderTimeoutError,
    UnsupportedSymbolError,
)
from .service import resolve_symbol

_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
_ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{document}"
_CACHE_SECONDS = 24 * 60 * 60

_FACT_TAGS = {
    "revenue": ("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"),
    "net_income": ("NetIncomeLoss",),
    "diluted_eps": ("EarningsPerShareDiluted",),
    "assets": ("Assets",),
    "liabilities": ("Liabilities",),
    "cash": ("CashAndCashEquivalentsAtCarryingValue",),
    "operating_cash_flow": ("NetCashProvidedByUsedInOperatingActivities",),
}


class SecEdgarProvider:
    source = "sec-edgar"
    _ticker_cache: tuple[float, dict[str, int]] | None = None
    _cache_lock = threading.Lock()

    def __init__(self, http=None, user_agent: str | None = None):
        self.http = http or requests.Session()
        self.user_agent = (user_agent if user_agent is not None else os.environ.get("VR_SEC_USER_AGENT", "")).strip()

    def _get(self, url: str) -> object:
        if not self.user_agent:
            raise ProviderConfigurationError(
                "SEC EDGAR 未配置：请设置 VR_SEC_USER_AGENT（例如 VibeResearch/0.3 your-email@example.com）"
            )
        try:
            response = self.http.get(
                url,
                headers={"User-Agent": self.user_agent, "Accept-Encoding": "gzip, deflate"},
                timeout=15,
            )
        except requests.Timeout as exc:
            raise ProviderTimeoutError("SEC EDGAR 请求超时") from exc
        except requests.RequestException as exc:
            raise ProviderError("SEC EDGAR 当前不可达") from exc
        if response.status_code == 404:
            raise InstrumentNotFoundError("SEC EDGAR 未找到该公司")
        if response.status_code == 403:
            raise ProviderConfigurationError("SEC EDGAR 拒绝了当前 User-Agent；请在 VR_SEC_USER_AGENT 中填写真实联系邮箱")
        if response.status_code >= 400:
            raise ProviderError(f"SEC EDGAR 返回 HTTP {response.status_code}")
        try:
            return response.json()
        except ValueError as exc:
            raise ProviderError("SEC EDGAR 返回了无法解析的响应") from exc

    def _cik_map(self) -> dict[str, int]:
        now = time.monotonic()
        cached = type(self)._ticker_cache
        if cached and now - cached[0] < _CACHE_SECONDS:
            return cached[1]
        with type(self)._cache_lock:
            cached = type(self)._ticker_cache
            if cached and now - cached[0] < _CACHE_SECONDS:
                return cached[1]
            payload = self._get(_TICKERS_URL)
            rows = payload.values() if isinstance(payload, dict) else []
            mapping = {
                str(row.get("ticker", "")).upper(): int(row["cik_str"])
                for row in rows if isinstance(row, dict) and row.get("ticker") and row.get("cik_str") is not None
            }
            type(self)._ticker_cache = (now, mapping)
            return mapping

    def cik_for(self, symbol: str) -> tuple[str, int]:
        resolved = resolve_symbol(symbol)
        if resolved.exchange.country != "US":
            raise UnsupportedSymbolError("SEC EDGAR 仅支持美国监管申报公司")
        ticker = resolved.provider_symbol.replace("-", ".")
        cik = self._cik_map().get(ticker) or self._cik_map().get(resolved.provider_symbol)
        if cik is None:
            raise InstrumentNotFoundError(f"SEC EDGAR ticker map 未找到 {resolved.provider_symbol}")
        return resolved.provider_symbol, cik

    def filings(self, symbol: str, limit: int = 20) -> dict:
        ticker, cik = self.cik_for(symbol)
        payload = self._get(_SUBMISSIONS_URL.format(cik=f"{cik:010d}"))
        recent = ((payload.get("filings") or {}).get("recent") or {}) if isinstance(payload, dict) else {}
        keys = ("accessionNumber", "filingDate", "reportDate", "acceptanceDateTime", "form", "primaryDocument", "primaryDocDescription")
        count = min(max((len(recent.get(key) or []) for key in keys), default=0), max(1, min(limit, 50)))
        items = []
        for index in range(count):
            row = {key: (recent.get(key) or [None] * count)[index] if index < len(recent.get(key) or []) else None for key in keys}
            accession = str(row.pop("accessionNumber") or "")
            document = str(row.pop("primaryDocument") or "")
            row["accession_number"] = accession
            row["primary_document"] = document
            row["url"] = _ARCHIVES_URL.format(cik=cik, accession=accession.replace("-", ""), document=document) if accession and document else None
            items.append(row)
        return {"symbol": ticker, "cik": f"{cik:010d}", "company": payload.get("name") if isinstance(payload, dict) else None, "source": self.source, "items": items}

    def company_facts(self, symbol: str) -> dict:
        ticker, cik = self.cik_for(symbol)
        payload = self._get(_FACTS_URL.format(cik=f"{cik:010d}"))
        us_gaap = (((payload.get("facts") or {}).get("us-gaap")) or {}) if isinstance(payload, dict) else {}
        selected = {}
        for label, candidates in _FACT_TAGS.items():
            fact = next((us_gaap[tag] for tag in candidates if tag in us_gaap), None)
            if not isinstance(fact, dict):
                continue
            units = fact.get("units") or {}
            observations = [
                {**row, "unit": unit}
                for unit, rows in units.items() for row in (rows or []) if isinstance(row, dict)
            ]
            observations.sort(key=lambda row: (str(row.get("end") or ""), str(row.get("filed") or "")), reverse=True)
            if observations:
                selected[label] = {"label": fact.get("label"), **observations[0]}
        return {"symbol": ticker, "cik": f"{cik:010d}", "company": payload.get("entityName") if isinstance(payload, dict) else None, "source": self.source, "facts": selected}


def get_filings(symbol: str, limit: int = 20) -> dict:
    return SecEdgarProvider().filings(symbol, limit)


def get_company_facts(symbol: str) -> dict:
    return SecEdgarProvider().company_facts(symbol)
