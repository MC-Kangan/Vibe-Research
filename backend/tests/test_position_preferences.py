import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

import app as app_module
import position_preferences


client = TestClient(app_module.app)


def test_preferences_persist_and_normalize(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))

    saved = position_preferences.save(["- Preserve capital", "  Accept moderate volatility  ", ""])

    assert saved["items"] == ["Preserve capital", "Accept moderate volatility"]
    assert position_preferences.get() == saved
    with sqlite3.connect(tmp_path / "ibkr-analytics.sqlite3") as database:
        encoded = database.execute(
            "SELECT payload_json FROM position_state WHERE state_key = 'position-preferences'"
        ).fetchone()[0]
    on_disk = json.loads(encoded)
    assert on_disk == saved


def test_preferences_reject_oversized_content(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))

    with pytest.raises(position_preferences.PositionPreferenceError):
        position_preferences.save(["x" * 501])

    assert position_preferences.get()["items"] == []


def test_preferences_api_round_trip(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "_API_KEY", "")

    response = client.put("/api/positions/preferences", json={"items": ["Long-term growth", "Max drawdown 15%"]})

    assert response.status_code == 200
    assert response.json()["data"]["items"] == ["Long-term growth", "Max drawdown 15%"]
    assert client.get("/api/positions/preferences").json()["data"]["items"] == ["Long-term growth", "Max drawdown 15%"]
