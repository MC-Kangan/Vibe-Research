from fastapi.testclient import TestClient

import app as app_module


client = TestClient(app_module.app)


def test_research_disabled_is_non_breaking(monkeypatch):
    monkeypatch.setenv("VR_TRADE_RESEARCH_ENABLED", "false")
    response = client.get("/api/research/skills")
    assert response.status_code == 200
    assert response.json()["status"] == "disabled"


def test_research_run_forwards_one_shared_dossier(monkeypatch):
    monkeypatch.setenv("VR_TRADE_RESEARCH_ENABLED", "true")
    monkeypatch.setenv("VR_TRADE_RESEARCH_BASE_URL", "http://research")
    monkeypatch.setenv("VR_TRADE_RESEARCH_API_TOKEN", "test-token")
    monkeypatch.setattr(app_module.research_layer, "build_run_inputs", lambda *args: {
        "symbol": "AAPL", "market": "US", "price_series": [{"instrument": {"symbol": "AAPL", "market": "US"}}],
    })
    monkeypatch.setattr(app_module.research_layer, "run_skill", lambda **kwargs: {
        "results": [{"analyst": kwargs["skill"], "summary": "ok"}],
    })
    response = client.post("/api/research/run", json={"symbol": "AAPL", "skills": ["markov-method"]})
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "complete"


def test_research_rejects_unknown_skill(monkeypatch):
    monkeypatch.setenv("VR_TRADE_RESEARCH_ENABLED", "true")
    monkeypatch.setenv("VR_TRADE_RESEARCH_BASE_URL", "http://research")
    monkeypatch.setenv("VR_TRADE_RESEARCH_API_TOKEN", "test-token")
    response = client.post("/api/research/run", json={"symbol": "AAPL", "skills": ["fundamental"]})
    assert response.status_code == 422
