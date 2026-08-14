from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

import research as research_layer
import portfolio_research
import research_skill_preferences
from api.errors import ApiProblem


router = APIRouter(prefix="/api/research", tags=["research"])


class ResearchSkillDefaultsIn(BaseModel):
    asset_type: Literal["equity", "crypto"]
    skills: list[
        Literal[
            "fundamental",
            "filings",
            "worth-buy-stocks",
            "markov-method",
            "technical-basic",
            "risk-analysis",
            "volatility-regime",
        ]
    ] = Field(default_factory=list, max_length=5)


class ResearchRunReq(BaseModel):
    symbol: str
    skills: list[str]
    asset_type: str = "equity"
    skill_parameters: dict[str, dict] = Field(default_factory=dict)


class PortfolioInstrumentIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    asset_type: Literal["equity", "crypto"]


class PortfolioResearchIn(BaseModel):
    instruments: list[PortfolioInstrumentIn] = Field(min_length=2, max_length=9)
    method: Literal[
        "equal_weight", "inverse_volatility", "risk_parity", "max_diversification"
    ] = "risk_parity"
    lookback: int = Field(default=120, ge=20, le=252)


class _BacktestStrategyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SmaBacktestStrategyIn(_BacktestStrategyIn):
    kind: Literal["sma_crossover"] = "sma_crossover"
    fast_window: int = Field(default=20, ge=2, le=252)
    slow_window: int = Field(default=50, ge=3, le=520)

    @model_validator(mode="after")
    def validate_windows(self):
        if self.fast_window >= self.slow_window:
            raise ValueError("fast_window must be smaller than slow_window")
        return self


class MacdBacktestStrategyIn(_BacktestStrategyIn):
    kind: Literal["macd_crossover"]
    fast_window: int = Field(default=12, ge=2, le=252)
    slow_window: int = Field(default=26, ge=3, le=520)
    signal_window: int = Field(default=9, ge=2, le=252)

    @model_validator(mode="after")
    def validate_windows(self):
        if self.fast_window >= self.slow_window:
            raise ValueError("fast_window must be smaller than slow_window")
        return self


class RsiBacktestStrategyIn(_BacktestStrategyIn):
    kind: Literal["rsi_mean_reversion"]
    window: int = Field(default=14, ge=2, le=252)
    entry_threshold: float = Field(default=30, ge=1, le=99)
    exit_threshold: float = Field(default=70, ge=1, le=99)

    @model_validator(mode="after")
    def validate_thresholds(self):
        if self.entry_threshold >= self.exit_threshold:
            raise ValueError("entry_threshold must be smaller than exit_threshold")
        return self


class MarkovBacktestStrategyIn(_BacktestStrategyIn):
    kind: Literal["markov_regime"]
    window: int = Field(default=20, ge=2, le=252)
    bull_threshold: float = Field(default=0.05, gt=0, le=1)
    bear_threshold: float = Field(default=-0.05, ge=-1, lt=0)
    min_train: int = Field(default=200, ge=50, le=520)


BacktestStrategyIn = Annotated[
    SmaBacktestStrategyIn
    | MacdBacktestStrategyIn
    | RsiBacktestStrategyIn
    | MarkovBacktestStrategyIn,
    Field(discriminator="kind"),
]


class BacktestRunIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=24)
    asset_type: Literal["equity", "crypto"] = "equity"
    start_date: date
    strategy: BacktestStrategyIn = Field(default_factory=SmaBacktestStrategyIn)
    initial_cash: float = Field(default=1_000, gt=0, le=1_000_000_000)
    minimum_holding_days: int = Field(default=1, ge=1, le=520)
    commission: float = Field(default=0.001, ge=0, le=0.1)
    spread: float = Field(default=0, ge=0, le=0.1)
    position_size: float = Field(default=0.95, gt=0, lt=1)


@router.get("/skill-defaults")
def research_skill_defaults_get():
    return {"data": research_skill_preferences.get()}


@router.put("/skill-defaults")
def research_skill_defaults_put(request: ResearchSkillDefaultsIn):
    try:
        return {
            "data": research_skill_preferences.save(request.asset_type, request.skills)
        }
    except research_skill_preferences.ResearchSkillPreferenceError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/skills")
def research_skills():
    """Return the read-only TradeAgent skills exposed in Vibe Research."""
    if not research_layer.configured():
        return {"configured": False, "status": "disabled", "skills": []}
    try:
        skills = [
            skill for skill in research_layer.list_skills()
            if skill.get("name") in research_layer.INSTRUMENT_SKILLS
        ]
    except research_layer.ResearchClientError as exc:
        return {
            "configured": True,
            "status": "unavailable",
            "detail": str(exc),
            "skills": [],
        }
    return {"configured": True, "status": "available", "skills": skills}


@router.post("/run")
def research_run(request: ResearchRunReq):
    """Fetch one shared price dossier, then run selected TradeAgent skills once."""
    skills = list(
        dict.fromkeys(item.strip() for item in request.skills if item.strip())
    )
    if not skills:
        raise ApiProblem(
            422, "research_skill_required", "Select at least one analysis skill."
        )
    if any(skill not in research_layer.INSTRUMENT_SKILLS for skill in skills):
        raise ApiProblem(
            422,
            "research_skill_not_enabled",
            "The request contains a skill that is not enabled.",
        )
    if not research_layer.configured():
        raise ApiProblem(
            503, "tradeagent_not_configured", "TradeAgent is not configured."
        )
    try:
        return research_layer.run_skills_full(
            symbol=request.symbol,
            skills=skills,
            parameters=request.skill_parameters,
            asset_type=request.asset_type,
        )
    except research_layer.UnsupportedSkillAssetError as exc:
        raise ApiProblem(422, "research_asset_unsupported", str(exc)) from exc
    except research_layer.ResearchClientError as exc:
        raise ApiProblem(502, "tradeagent_request_failed", str(exc)) from exc


@router.post("/backtest")
def research_backtest(request: BacktestRunIn):
    """Run one bounded daily long/flat backtest for the playground."""
    if not research_layer.configured():
        raise ApiProblem(
            503, "tradeagent_not_configured", "TradeAgent is not configured."
        )
    try:
        return research_layer.run_backtest(
            symbol=request.symbol,
            asset_type=request.asset_type,
            start_date=request.start_date.isoformat(),
            strategy=request.strategy.model_dump(),
            initial_cash=request.initial_cash,
            minimum_holding_bars=request.minimum_holding_days,
            commission=request.commission,
            spread=request.spread,
            position_size=request.position_size,
        )
    except research_layer.BacktestInputError as exc:
        raise ApiProblem(422, "backtest_input_invalid", str(exc)) from exc
    except research_layer.UnsupportedSkillAssetError as exc:
        raise ApiProblem(422, "research_asset_unsupported", str(exc)) from exc
    except research_layer.ResearchClientError as exc:
        raise ApiProblem(502, "tradeagent_request_failed", str(exc)) from exc


@router.get("/portfolio/candidates")
def research_portfolio_candidates():
    return {"data": portfolio_research.candidate_universe()}


@router.post("/portfolio/run")
def research_portfolio_run(request: PortfolioResearchIn):
    if not research_layer.configured():
        raise ApiProblem(
            503, "tradeagent_not_configured", "TradeAgent is not configured."
        )
    instruments = [item.model_dump() for item in request.instruments]
    normalized = {
        (item["asset_type"], item["symbol"].strip().upper()) for item in instruments
    }
    if len(normalized) != len(instruments):
        raise ApiProblem(
            422,
            "portfolio_instruments_duplicate",
            "Portfolio instruments must be unique.",
        )
    try:
        return research_layer.run_portfolio_analysis(
            instruments=instruments,
            method=request.method,
            lookback=request.lookback,
        )
    except research_layer.ResearchClientError as exc:
        raise ApiProblem(502, "tradeagent_request_failed", str(exc)) from exc
