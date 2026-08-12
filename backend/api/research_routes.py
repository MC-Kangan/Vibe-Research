from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import research as research_layer
import research_skill_preferences
from api.errors import ApiProblem


router = APIRouter(prefix="/api/research", tags=["research"])


class ResearchSkillDefaultsIn(BaseModel):
    asset_type: Literal["equity", "crypto"]
    skills: list[Literal[
        "worth-buy-stocks",
        "markov-method",
        "technical-basic",
        "risk-analysis",
        "volatility-regime",
    ]] = Field(default_factory=list, max_length=5)


class ResearchRunReq(BaseModel):
    symbol: str
    skills: list[str]
    asset_type: str = "equity"
    skill_parameters: dict[str, dict] = Field(default_factory=dict)


@router.get("/skill-defaults")
def research_skill_defaults_get():
    return {"data": research_skill_preferences.get()}


@router.put("/skill-defaults")
def research_skill_defaults_put(request: ResearchSkillDefaultsIn):
    try:
        return {"data": research_skill_preferences.save(request.asset_type, request.skills)}
    except research_skill_preferences.ResearchSkillPreferenceError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/skills")
def research_skills():
    """Return the read-only TradeAgent skills exposed in Vibe Research."""
    if not research_layer.configured():
        return {"configured": False, "status": "disabled", "skills": []}
    try:
        skills = research_layer.list_skills()
    except research_layer.ResearchClientError as exc:
        return {"configured": True, "status": "unavailable", "detail": str(exc), "skills": []}
    return {"configured": True, "status": "available", "skills": skills}


@router.post("/run")
def research_run(request: ResearchRunReq):
    """Fetch one shared price dossier, then run selected TradeAgent skills once."""
    skills = list(dict.fromkeys(item.strip() for item in request.skills if item.strip()))
    if not skills:
        raise ApiProblem(422, "research_skill_required", "Select at least one analysis skill.")
    if any(skill not in research_layer.ALLOWED_SKILLS for skill in skills):
        raise ApiProblem(422, "research_skill_not_enabled", "The request contains a skill that is not enabled.")
    if not research_layer.configured():
        raise ApiProblem(503, "tradeagent_not_configured", "TradeAgent is not configured.")
    try:
        return research_layer.run_skills_full(
            symbol=request.symbol,
            skills=skills,
            parameters=request.skill_parameters,
            asset_type=request.asset_type,
        )
    except research_layer.UnsupportedSkillAssetError as exc:
        raise HTTPException(422, str(exc)) from exc
    except research_layer.ResearchClientError as exc:
        raise HTTPException(502, str(exc)) from exc
