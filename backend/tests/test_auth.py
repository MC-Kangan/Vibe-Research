from fastapi.testclient import TestClient

import app as app_module
import auth


def test_password_hash_round_trip():
    encoded = auth.hash_password("correct horse battery staple", iterations=1_000)
    assert auth.verify_password("correct horse battery staple", encoded)
    assert not auth.verify_password("wrong", encoded)


def test_login_session_protects_api(monkeypatch):
    monkeypatch.setenv("VR_AUTH_ENABLED", "true")
    monkeypatch.setenv("VR_AUTH_USERNAME", "admin")
    monkeypatch.setenv("VR_AUTH_PASSWORD_HASH", auth.hash_password("secret", iterations=1_000))
    monkeypatch.setenv("VR_SESSION_SECRET", "test-session-secret")
    monkeypatch.setattr(app_module, "_API_KEY", "")
    client = TestClient(app_module.app)

    assert client.get("/api/auth/session").json()["data"]["authenticated"] is False
    assert client.get("/api/portfolio").status_code == 401
    assert client.post("/api/auth/login", json={"username": "admin", "password": "secret"}).status_code == 200
    assert client.get("/api/portfolio").status_code == 200
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/portfolio").status_code == 401
