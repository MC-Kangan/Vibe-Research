from fastapi.testclient import TestClient

import app as app_module
from api import research_routes


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
    calls = []
    monkeypatch.setattr(
        research_routes.research_layer,
        "run_skills_full",
        lambda **kwargs: calls.append(kwargs)
        or {
            "symbol": "AAPL",
            "market": "US",
            "results": [
                {
                    "skill": "markov-method",
                    "status": "complete",
                    "report": {
                        "results": [{"analyst": "markov-method", "summary": "ok"}]
                    },
                }
            ],
        },
    )
    response = client.post(
        "/api/research/run", json={"symbol": "AAPL", "skills": ["markov-method"]}
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "complete"
    assert len(calls) == 1


def test_research_rejects_unknown_skill(monkeypatch):
    monkeypatch.setenv("VR_TRADE_RESEARCH_ENABLED", "true")
    monkeypatch.setenv("VR_TRADE_RESEARCH_BASE_URL", "http://research")
    monkeypatch.setenv("VR_TRADE_RESEARCH_API_TOKEN", "test-token")
    response = client.post(
        "/api/research/run", json={"symbol": "AAPL", "skills": ["unknown-skill"]}
    )
    assert response.status_code == 422


def test_research_accepts_sec_backed_equity_skills(monkeypatch):
    monkeypatch.setenv("VR_TRADE_RESEARCH_ENABLED", "true")
    monkeypatch.setenv("VR_TRADE_RESEARCH_BASE_URL", "http://research")
    monkeypatch.setenv("VR_TRADE_RESEARCH_API_TOKEN", "test-token")
    calls = []
    monkeypatch.setattr(
        research_routes.research_layer,
        "run_skills_full",
        lambda **kwargs: calls.append(kwargs)
        or {"symbol": "AAPL", "market": "US", "results": []},
    )

    response = client.post(
        "/api/research/run",
        json={"symbol": "AAPL", "skills": ["fundamental", "filings"]},
    )

    assert response.status_code == 200
    assert calls[0]["skills"] == ["fundamental", "filings"]


def test_sec_backed_skills_are_equity_only():
    layer = research_routes.research_layer

    assert layer.DEFAULT_SKILL_ASSET_TYPES["fundamental"] == ("equity",)
    assert layer.DEFAULT_SKILL_ASSET_TYPES["filings"] == ("equity",)


def test_research_rejects_skill_with_unconfigured_provider():
    layer = research_routes.research_layer

    try:
        layer.validate_skill_support(
            ["fundamental"],
            "equity",
            [{
                "name": "fundamental",
                "supported_asset_types": ["equity"],
                "available": False,
                "missing_capabilities": ["fundamentals"],
            }],
        )
    except layer.ResearchClientError as exc:
        assert "fundamental (fundamentals)" in str(exc)
    else:
        raise AssertionError("expected an unavailable provider error")


def test_sec_only_run_inputs_do_not_fetch_price_history(monkeypatch):
    layer = research_routes.research_layer
    monkeypatch.setattr(
        layer,
        "_resolve_target",
        lambda _symbol, _asset_type: ("AAPL", "US"),
    )
    monkeypatch.setattr(
        layer,
        "_load_series",
        lambda *_args: (_ for _ in ()).throw(AssertionError("price history fetched")),
    )

    result = layer.build_run_inputs(
        "AAPL", ["fundamental", "filings"], {}, "equity"
    )

    assert result["price_series"] == []


def test_instrument_research_rejects_portfolio_scoped_skill(monkeypatch):
    monkeypatch.setenv("VR_TRADE_RESEARCH_ENABLED", "true")
    monkeypatch.setenv("VR_TRADE_RESEARCH_BASE_URL", "http://research")
    monkeypatch.setenv("VR_TRADE_RESEARCH_API_TOKEN", "test-token")
    response = client.post(
        "/api/research/run",
        json={"symbol": "AAPL", "skills": ["asset-allocation"]},
    )
    assert response.status_code == 422


def test_portfolio_research_forwards_one_multi_series_batch(monkeypatch):
    monkeypatch.setenv("VR_TRADE_RESEARCH_ENABLED", "true")
    monkeypatch.setenv("VR_TRADE_RESEARCH_BASE_URL", "http://research")
    monkeypatch.setenv("VR_TRADE_RESEARCH_API_TOKEN", "test-token")
    calls = []
    monkeypatch.setattr(
        research_routes.research_layer,
        "run_portfolio_analysis",
        lambda **kwargs: calls.append(kwargs)
        or {
            "results": [
                {"analyst": "correlation-analysis", "status": "complete"},
                {"analyst": "asset-allocation", "status": "complete"},
            ]
        },
    )
    response = client.post(
        "/api/research/portfolio/run",
        json={
            "instruments": [
                {"symbol": "AAPL", "asset_type": "equity"},
                {"symbol": "BTC", "asset_type": "crypto"},
            ],
            "method": "risk_parity",
            "lookback": 120,
        },
    )
    assert response.status_code == 200
    assert len(response.json()["results"]) == 2
    assert calls == [
        {
            "instruments": [
                {"symbol": "AAPL", "asset_type": "equity"},
                {"symbol": "BTC", "asset_type": "crypto"},
            ],
            "method": "risk_parity",
            "lookback": 120,
        }
    ]


def test_portfolio_research_requires_two_unique_instruments(monkeypatch):
    monkeypatch.setenv("VR_TRADE_RESEARCH_ENABLED", "true")
    monkeypatch.setenv("VR_TRADE_RESEARCH_BASE_URL", "http://research")
    monkeypatch.setenv("VR_TRADE_RESEARCH_API_TOKEN", "test-token")
    response = client.post(
        "/api/research/portfolio/run",
        json={"instruments": [{"symbol": "AAPL", "asset_type": "equity"}]},
    )
    assert response.status_code == 422


def test_portfolio_analysis_builds_one_trade_agent_batch(monkeypatch):
    layer = research_routes.research_layer
    calls = []
    monkeypatch.setattr(layer, "configured", lambda: True)
    monkeypatch.setattr(
        layer,
        "_resolve_target",
        lambda symbol, asset_type: (
            ("BTC-USD", "CRYPTO") if asset_type == "crypto" else (symbol.upper(), "US")
        ),
    )
    monkeypatch.setattr(
        layer,
        "_load_series",
        lambda symbol, market: {
            "instrument": {"symbol": symbol, "market": market},
            "bars": [],
        },
    )
    monkeypatch.setattr(
        layer,
        "run_analysis",
        lambda **kwargs: calls.append(kwargs) or {"results": []},
    )

    result = layer.run_portfolio_analysis(
        instruments=[
            {"symbol": "AAPL", "asset_type": "equity"},
            {"symbol": "BTC", "asset_type": "crypto"},
        ],
        method="inverse_volatility",
        lookback=60,
    )

    assert len(calls) == 1
    assert calls[0]["skills"] == ["correlation-analysis", "asset-allocation"]
    assert calls[0]["skill_parameters"]["asset-allocation"] == {
        "method": "inverse_volatility",
        "lookback": 60,
    }
    assert calls[0]["symbol"] == "BASKET"
    assert calls[0]["market"] == "PORTFOLIO"
    assert calls[0]["scope"] == "portfolio"
    assert calls[0]["portfolio_instruments"] == [
        {"symbol": "AAPL", "market": "US"},
        {"symbol": "BTC-USD", "market": "CRYPTO"},
    ]
    assert {
        (item["instrument"]["market"], item["instrument"]["symbol"])
        for item in calls[0]["price_series"]
    } == {("US", "AAPL"), ("CRYPTO", "BTC-USD")}
    assert result["instruments"][1]["symbol"] == "BTC-USD"


def test_portfolio_candidates_degrade_when_optional_sources_fail(monkeypatch):
    import crypto_portfolio
    import ibkr_analytics
    import portfolio as manual_stock_portfolio

    def unavailable(*_args, **_kwargs):
        raise RuntimeError("unavailable")

    monkeypatch.setattr(ibkr_analytics, "list_instruments", unavailable)
    monkeypatch.setattr(manual_stock_portfolio, "get_portfolio", unavailable)
    monkeypatch.setattr(crypto_portfolio, "get_coinbase_snapshot", unavailable)
    monkeypatch.setattr(
        crypto_portfolio,
        "get_manual",
        lambda: [{"asset": "ETH", "quantity": 1, "asset_kind": "crypto"}],
    )

    result = research_routes.portfolio_research.candidate_universe()
    assert result["status"] == "partial"
    assert {item["source"] for item in result["gaps"]} == {
        "IBKR",
        "Manual stocks",
        "Coinbase",
    }
    assert result["items"] == [
        {
            "key": "CRYPTO:ETH-USD",
            "symbol": "ETH-USD",
            "market": "CRYPTO",
            "asset_type": "crypto",
            "label": "ETH",
            "source": "Coinbase / wallet",
        }
    ]
