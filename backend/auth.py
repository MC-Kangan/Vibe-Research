"""Optional single-user browser authentication for self-hosted deployments."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from collections import deque
from typing import Any

from fastapi import Request, Response


COOKIE_NAME = "vibe_session"
_FAILED_LOGINS: deque[float] = deque(maxlen=32)
_AUTH_LOCK = threading.Lock()


def enabled() -> bool:
    return os.environ.get("VR_AUTH_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}


def _secret() -> bytes:
    return os.environ.get("VR_SESSION_SECRET", "").encode()


def validate_configuration() -> None:
    if not enabled():
        return
    required = ("VR_AUTH_USERNAME", "VR_AUTH_PASSWORD_HASH", "VR_SESSION_SECRET")
    missing = [name for name in required if not os.environ.get(name, "").strip()]
    if missing:
        raise RuntimeError(f"VR_AUTH_ENABLED requires: {', '.join(missing)}")


def hash_password(password: str, *, iterations: int = 310_000) -> str:
    """Create a portable PBKDF2 password hash for VR_AUTH_PASSWORD_HASH."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")
    return f"pbkdf2_sha256${iterations}${encode(salt)}${encode(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations_text, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_text)
        pad = lambda value: value + "=" * (-len(value) % 4)
        salt = base64.urlsafe_b64decode(pad(salt_text))
        expected = base64.urlsafe_b64decode(pad(digest_text))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except (TypeError, ValueError):
        return False


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _sign(payload: bytes) -> str:
    return _encode(hmac.new(_secret(), payload, hashlib.sha256).digest())


def issue_session(username: str) -> str:
    ttl = max(1, min(int(os.environ.get("VR_SESSION_TTL_HOURS", "12")), 168)) * 3600
    payload = json.dumps({"sub": username, "exp": int(time.time()) + ttl}, separators=(",", ":")).encode()
    encoded = _encode(payload)
    return f"{encoded}.{_sign(encoded.encode())}"


def session_username(request: Request) -> str | None:
    if not enabled():
        return None
    token = request.cookies.get(COOKIE_NAME, "")
    try:
        encoded, signature = token.split(".", 1)
        if not hmac.compare_digest(_sign(encoded.encode()), signature):
            return None
        payload: dict[str, Any] = json.loads(_decode(encoded))
        username = str(payload.get("sub", ""))
        if not username or int(payload.get("exp", 0)) < int(time.time()):
            return None
        return username
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def bearer_authorized(request: Request, api_key: str) -> bool:
    return bool(api_key) and hmac.compare_digest(
        request.headers.get("authorization", ""), f"Bearer {api_key}"
    )


def is_authorized(request: Request, api_key: str) -> bool:
    return bearer_authorized(request, api_key) or (enabled() and session_username(request) is not None)


def login_allowed() -> bool:
    now = time.monotonic()
    with _AUTH_LOCK:
        while _FAILED_LOGINS and now - _FAILED_LOGINS[0] > 900:
            _FAILED_LOGINS.popleft()
        return len(_FAILED_LOGINS) < 8


def record_failed_login() -> None:
    with _AUTH_LOCK:
        _FAILED_LOGINS.append(time.monotonic())


def clear_failed_logins() -> None:
    with _AUTH_LOCK:
        _FAILED_LOGINS.clear()


def set_session_cookie(response: Response, token: str) -> None:
    secure = os.environ.get("VR_AUTH_COOKIE_SECURE", "false").strip().lower() in {"1", "true", "yes", "on"}
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=max(1, min(int(os.environ.get("VR_SESSION_TTL_HOURS", "12")), 168)) * 3600,
        httponly=True,
        secure=secure,
        samesite="strict",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")
