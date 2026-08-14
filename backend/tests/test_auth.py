import hashlib
import sqlite3

import pytest
from fastapi.testclient import TestClient

import app as app_module
import auth


_PASSWORD = "test-password-long-2026"


def _configure_auth(monkeypatch, tmp_path, *, secure: bool = False):
    monkeypatch.setenv("VR_AUTH_ENABLED", "true")
    monkeypatch.setenv("VR_AUTH_DB_PATH", str(tmp_path / "auth.sqlite3"))
    monkeypatch.setenv("VR_AUTH_USERNAME", "admin")
    monkeypatch.setenv("VR_AUTH_PASSWORD_HASH", auth.hash_password(_PASSWORD))
    monkeypatch.setenv("VR_AUTH_COOKIE_SECURE", "true" if secure else "false")
    monkeypatch.setenv("VR_ALLOW_ORIGINS", "https://vibe.example")
    monkeypatch.setattr(app_module, "_API_KEY", "")
    auth.validate_configuration()


def _client(*, secure: bool = False) -> TestClient:
    return TestClient(app_module.app, base_url="https://vibe.example" if secure else "http://testserver")


def test_password_hash_round_trip_and_legacy_compatibility():
    encoded = auth.hash_password("correct horse battery staple")
    assert encoded.startswith("$argon2id$")
    assert auth.verify_password("correct horse battery staple", encoded)
    assert not auth.verify_password("wrong", encoded)

    legacy = auth._hash_password_pbkdf2("legacy", iterations=310_000)
    assert auth.verify_password("legacy", legacy)
    assert auth.password_needs_rehash(legacy)


def test_new_password_creation_rejects_short_passwords():
    with pytest.raises(ValueError, match="8"):
        auth.hash_password("short7")


def test_new_password_creation_accepts_eight_characters():
    encoded = auth.hash_password("eight888")
    assert auth.verify_password("eight888", encoded)


def test_login_session_protects_api_and_logout_revokes(monkeypatch, tmp_path):
    _configure_auth(monkeypatch, tmp_path)
    client = _client()

    assert client.get("/api/auth/session").json()["data"]["authenticated"] is False
    assert client.get("/api/portfolio").status_code == 401

    login = client.post(
        "/api/auth/login",
        headers={"Origin": "https://vibe.example"},
        json={"username": "admin", "password": _PASSWORD},
    )
    assert login.status_code == 200
    assert client.get("/api/portfolio").status_code == 200

    cookie = client.cookies.get(auth.cookie_name())
    assert cookie
    with sqlite3.connect(auth.database_path()) as db:
        stored_hash = db.execute("SELECT token_hash FROM auth_sessions").fetchone()[0]
    assert stored_hash == hashlib.sha256(cookie.encode()).hexdigest()
    assert cookie not in stored_hash

    logout = client.post("/api/auth/logout", headers={"Origin": "https://vibe.example"})
    assert logout.status_code == 200
    assert client.get("/api/portfolio").status_code == 401
    with sqlite3.connect(auth.database_path()) as db:
        assert db.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0] == 0


def test_tampered_and_expired_sessions_are_rejected(monkeypatch, tmp_path):
    _configure_auth(monkeypatch, tmp_path)
    client = _client()
    token = auth.authenticate("admin", _PASSWORD)
    assert token

    client.cookies.set(auth.cookie_name(), token + "tampered")
    assert client.get("/api/portfolio").status_code == 401

    client.cookies.set(auth.cookie_name(), token)
    with sqlite3.connect(auth.database_path()) as db:
        db.execute("UPDATE auth_sessions SET expires_at = 0")
        db.commit()
    assert client.get("/api/portfolio").status_code == 401


def test_password_reset_revokes_all_sessions(monkeypatch, tmp_path):
    _configure_auth(monkeypatch, tmp_path)
    client = _client()
    token = auth.authenticate("admin", _PASSWORD)
    assert token
    client.cookies.set(auth.cookie_name(), token)
    assert client.get("/api/portfolio").status_code == 200

    auth.set_password("admin", "new-password-long-2026")
    assert client.get("/api/portfolio").status_code == 401
    assert auth.authenticate("admin", _PASSWORD) is None
    assert auth.authenticate("admin", "new-password-long-2026")


def test_legacy_bootstrap_hash_is_upgraded_on_login(monkeypatch, tmp_path):
    monkeypatch.setenv("VR_AUTH_ENABLED", "true")
    monkeypatch.setenv("VR_AUTH_DB_PATH", str(tmp_path / "auth.sqlite3"))
    monkeypatch.setenv("VR_AUTH_USERNAME", "admin")
    monkeypatch.setenv("VR_AUTH_PASSWORD_HASH", auth._hash_password_pbkdf2("secret", iterations=310_000))
    auth.validate_configuration()

    assert auth.authenticate("admin", "secret")
    with sqlite3.connect(auth.database_path()) as db:
        password_hash = db.execute("SELECT password_hash FROM auth_users WHERE username = 'admin'").fetchone()[0]
    assert password_hash.startswith("$argon2id$")


def test_secure_cookie_and_cross_origin_write_protection(monkeypatch, tmp_path):
    _configure_auth(monkeypatch, tmp_path, secure=True)
    client = _client(secure=True)
    login = client.post(
        "/api/auth/login",
        headers={"Origin": "https://vibe.example"},
        json={"username": "admin", "password": _PASSWORD},
    )
    cookie_header = login.headers["set-cookie"]
    assert "__Host-vibe_session=" in cookie_header
    assert "HttpOnly" in cookie_header
    assert "Secure" in cookie_header
    assert "SameSite=strict" in cookie_header

    rejected = client.post(
        "/api/portfolio/holding",
        headers={"Origin": "https://attacker.example"},
        json={"code": "600519", "shares": 1, "cost": 1},
    )
    assert rejected.status_code == 403


def test_login_throttling_is_persistent(monkeypatch, tmp_path):
    _configure_auth(monkeypatch, tmp_path)
    for _ in range(8):
        assert auth.authenticate("admin", "wrong") is None
    assert auth.login_allowed() is False

    # The decision is backed by SQLite, not process memory.
    with sqlite3.connect(auth.database_path()) as db:
        assert db.execute("SELECT COUNT(*) FROM auth_login_failures").fetchone()[0] == 8


def test_login_input_limits(monkeypatch, tmp_path):
    _configure_auth(monkeypatch, tmp_path)
    client = _client()
    response = client.post(
        "/api/auth/login",
        headers={"Origin": "https://vibe.example"},
        json={"username": "a" * 129, "password": "secret"},
    )
    assert response.status_code == 422
