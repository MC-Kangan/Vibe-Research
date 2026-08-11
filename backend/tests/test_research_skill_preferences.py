from __future__ import annotations

from fastapi.testclient import TestClient

import research_skill_preferences
from app import app


def test_defaults_are_persistent_per_asset_type(monkeypatch, tmp_path):
    path = tmp_path / "skill-defaults.json"
    monkeypatch.setattr(research_skill_preferences, "_path", lambda: path)

    equity = research_skill_preferences.save("equity", ["technical-basic", "worth-buy-stocks"])
    crypto = research_skill_preferences.save("crypto", ["markov-method", "risk-analysis"])

    assert equity["equity"] == ["technical-basic", "worth-buy-stocks"]
    assert crypto["equity"] == ["technical-basic", "worth-buy-stocks"]
    assert research_skill_preferences.get()["crypto"] == ["markov-method", "risk-analysis"]


def test_defaults_reject_skills_unsupported_by_asset(monkeypatch, tmp_path):
    monkeypatch.setattr(research_skill_preferences, "_path", lambda: tmp_path / "skill-defaults.json")
    try:
        research_skill_preferences.save("crypto", ["worth-buy-stocks"])
    except research_skill_preferences.ResearchSkillPreferenceError as exc:
        assert "do not support crypto" in str(exc)
    else:
        raise AssertionError("equity-only skill was accepted as a crypto default")


def test_skill_default_api_roundtrip(monkeypatch, tmp_path):
    monkeypatch.setattr(research_skill_preferences, "_path", lambda: tmp_path / "skill-defaults.json")
    client = TestClient(app)
    saved = client.put("/api/research/skill-defaults", json={
        "asset_type": "equity", "skills": ["technical-basic", "risk-analysis"],
    })
    assert saved.status_code == 200
    assert saved.json()["data"]["equity"] == ["technical-basic", "risk-analysis"]
    assert client.get("/api/research/skill-defaults").json()["data"]["equity"] == ["technical-basic", "risk-analysis"]
