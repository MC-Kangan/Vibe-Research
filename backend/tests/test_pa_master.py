from __future__ import annotations

import json

import requests
from fastapi.testclient import TestClient

import app as app_module
import pa_master

client = TestClient(app_module.app)


def _response(payload, status_code=200):
    response = requests.Response()
    response.status_code = status_code
    response._content = json.dumps(payload).encode()
    response.headers["Content-Type"] = "application/json"
    return response


def test_pa_master_overlay_is_disabled_without_configuration(monkeypatch):
    monkeypatch.delenv("VR_PA_MASTER_ENABLED", raising=False)
    response = client.get("/api/portfolio/pa-master")
    assert response.status_code == 200
    assert response.json()["status"] == "disabled"


def test_pa_master_overlay_normalizes_current_and_position_payloads(monkeypatch):
    monkeypatch.setenv("VR_PA_MASTER_ENABLED", "true")
    monkeypatch.setenv("VR_PA_MASTER_BASE_URL", "http://pa-master")
    monkeypatch.setenv("VR_PA_MASTER_USERNAME", "analytics")
    monkeypatch.setenv("VR_PA_MASTER_PASSWORD", "secret")
    calls = []

    def fake_get(url, **kwargs):
        calls.append((url, kwargs.get("auth")))
        if url.endswith("/analysis/refresh/status"):
            return _response({
                "last_positions_refreshed_at": "2026-08-05T18:30:00Z",
                "last_history_refreshed_at": None,
                "last_full_refresh_completed_at": None,
            })
        if url.endswith("/analysis/current"):
            return _response({
                "reporting_currency": "USD",
                "nav": "1000.00",
                "reporting_coverage": "1",
                "holdings": [{
                    "symbol": "AAPL",
                    "asset_class": "stock",
                    "local_currency": "USD",
                    "reporting_market_value": "1000",
                    "portfolio_weight": "1",
                    "reporting_unrealized_pnl": "25",
                    "cost_status": "available",
                }],
            })
        return _response([{
            "account_id": "acct",
            "instrument_id": "aapl-id",
            "symbol": "AAPL",
            "name": "Apple",
            "asset_class": "stock",
            "currency": "USD",
            "venue": "NASDAQ",
            "trade_agent_market": "US",
            "quantity": "10",
            "average_cost": "97.5",
            "latest_price": "100",
            "unrealized_pnl": "25",
            "cost_status": "available",
        }])

    monkeypatch.setattr(pa_master.requests, "get", fake_get)
    payload = pa_master.get_portfolio()
    assert payload["status"] == "available"
    assert payload["summary"]["reporting_currency"] == "USD"
    assert payload["allocations"][0]["symbol"] == "AAPL"
    assert payload["positions"][0]["instrument_id"] == "aapl-id"
    assert payload["positions"][0]["account_label"] == "PA ••••acct"
    assert "account_id" not in payload["positions"][0]
    assert payload["freshness"]["last_positions_refreshed_at"] == "2026-08-05T18:30:00Z"
    assert set(auth for _, auth in calls) == {("analytics", "secret")}


def test_pa_master_partial_failure_does_not_hide_available_positions(monkeypatch):
    monkeypatch.setenv("VR_PA_MASTER_ENABLED", "true")
    monkeypatch.setenv("VR_PA_MASTER_BASE_URL", "http://pa-master")
    monkeypatch.delenv("VR_PA_MASTER_USERNAME", raising=False)
    monkeypatch.delenv("VR_PA_MASTER_PASSWORD", raising=False)

    def fake_get(url, **kwargs):
        if url.endswith("/analysis/current"):
            raise requests.Timeout("slow")
        if url.endswith("/analysis/refresh/status"):
            return _response({})
        return _response([{"symbol": "AAPL", "account_id": "acct"}])

    monkeypatch.setattr(pa_master.requests, "get", fake_get)
    payload = pa_master.get_portfolio()
    assert payload["status"] == "partial"
    assert payload["positions"][0]["symbol"] == "AAPL"
    assert "account_id" not in payload["positions"][0]
    assert "unreachable" in payload["detail"]


def test_pa_master_authentication_and_invalid_json_fail_safely(monkeypatch):
    monkeypatch.setenv("VR_PA_MASTER_ENABLED", "true")
    monkeypatch.setenv("VR_PA_MASTER_BASE_URL", "http://pa-master")
    monkeypatch.delenv("VR_PA_MASTER_USERNAME", raising=False)
    monkeypatch.delenv("VR_PA_MASTER_PASSWORD", raising=False)

    monkeypatch.setattr(pa_master.requests, "get", lambda *args, **kwargs: _response({}, 401))
    payload = pa_master.get_portfolio()
    assert payload["status"] == "unavailable"
    assert payload["detail"] == "PA Master authentication failed"

    invalid = requests.Response()
    invalid.status_code = 200
    invalid._content = b"not-json"
    monkeypatch.setattr(pa_master.requests, "get", lambda *args, **kwargs: invalid)
    payload = pa_master.get_portfolio()
    assert payload["status"] == "unavailable"
    assert payload["detail"] == "PA Master returned invalid JSON"


def test_pa_master_rejects_partial_basic_credentials(monkeypatch):
    monkeypatch.setenv("VR_PA_MASTER_ENABLED", "true")
    monkeypatch.setenv("VR_PA_MASTER_BASE_URL", "http://pa-master")
    monkeypatch.setenv("VR_PA_MASTER_USERNAME", "analytics")
    monkeypatch.delenv("VR_PA_MASTER_PASSWORD", raising=False)
    payload = pa_master.get_portfolio()
    assert payload["status"] == "unavailable"
    assert payload["detail"] == "PA Master credentials must be supplied together"
