"""Single-user browser authentication for self-hosted deployments.

The environment variables bootstrap the first user only. Password hashes and
revocable, opaque browser sessions then live in a small SQLite database under
the application data directory.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import hmac
import os
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Iterator

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Request, Response


_LOCAL_COOKIE_NAME = "vibe_session"
_SECURE_COOKIE_NAME = "__Host-vibe_session"
_DB_LOCK = threading.RLock()
_PASSWORD_HASHER = PasswordHasher(
    time_cost=2,
    memory_cost=19_456,
    parallelism=1,
    hash_len=32,
    salt_len=16,
)


def enabled() -> bool:
    return os.environ.get("VR_AUTH_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}


def _cookie_secure() -> bool:
    return os.environ.get("VR_AUTH_COOKIE_SECURE", "false").strip().lower() in {"1", "true", "yes", "on"}


def cookie_name() -> str:
    return _SECURE_COOKIE_NAME if _cookie_secure() else _LOCAL_COOKIE_NAME


def database_path() -> Path:
    configured = os.environ.get("VR_AUTH_DB_PATH", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path(os.environ.get("VR_DATA_DIR", "~/.vibe-research")).expanduser() / "auth.sqlite3"


@contextmanager
def _connection() -> Iterator[sqlite3.Connection]:
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=30)
    try:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        yield db
    finally:
        db.close()
    try:
        path.chmod(0o600)
    except OSError:
        pass


def _create_schema(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS auth_users (
          id INTEGER PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          password_version INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS auth_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
          password_version INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
        CREATE TABLE IF NOT EXISTS auth_login_failures (
          attempted_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_auth_login_failures_time ON auth_login_failures(attempted_at);
        """
    )


def _valid_password_hash(encoded: str) -> bool:
    if encoded.startswith("$argon2id$"):
        try:
            _PASSWORD_HASHER.check_needs_rehash(encoded)
            return True
        except (InvalidHashError, VerificationError):
            return False
    try:
        algorithm, iterations_text, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256" or int(iterations_text) < 1:
            return False
        _decode(salt_text)
        _decode(digest_text)
        return True
    except (TypeError, ValueError):
        return False


def initialize() -> None:
    """Create the auth store and bootstrap the first configured user."""
    with _DB_LOCK, _connection() as db:
        _create_schema(db)
        if db.execute("SELECT 1 FROM auth_users LIMIT 1").fetchone():
            db.commit()
            return

        username = os.environ.get("VR_AUTH_USERNAME", "").strip()
        password_hash = os.environ.get("VR_AUTH_PASSWORD_HASH", "").strip()
        if not username or not password_hash:
            db.commit()
            return
        if len(username) > 128 or not _valid_password_hash(password_hash):
            raise RuntimeError("VR_AUTH_USERNAME or VR_AUTH_PASSWORD_HASH is invalid")
        now = int(time.time())
        db.execute(
            "INSERT INTO auth_users(username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (username, password_hash, now, now),
        )
        db.commit()


def validate_configuration() -> None:
    if not enabled():
        return
    initialize()
    with _DB_LOCK, _connection() as db:
        if not db.execute("SELECT 1 FROM auth_users LIMIT 1").fetchone():
            raise RuntimeError(
                "VR_AUTH_ENABLED requires an existing auth database or both "
                "VR_AUTH_USERNAME and VR_AUTH_PASSWORD_HASH for first-run bootstrap"
            )
    _session_ttl_seconds()


def _argon2_hash(password: str) -> str:
    return _PASSWORD_HASHER.hash(password)


def hash_password(password: str) -> str:
    """Create an Argon2id password hash for first-run bootstrap or reset."""
    if not 15 <= len(password) <= 1024:
        raise ValueError("new passwords must contain between 15 and 1024 characters")
    return _argon2_hash(password)


def _hash_password_pbkdf2(password: str, *, iterations: int = 600_000) -> str:
    """Legacy encoder retained only for migration tests and compatibility."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"pbkdf2_sha256${iterations}${_encode(salt)}${_encode(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    if encoded.startswith("$argon2id$"):
        try:
            return _PASSWORD_HASHER.verify(encoded, password)
        except (VerifyMismatchError, InvalidHashError, VerificationError):
            return False
    try:
        algorithm, iterations_text, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = _decode(salt_text)
        expected = _decode(digest_text)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(iterations_text))
        return hmac.compare_digest(actual, expected)
    except (TypeError, ValueError):
        return False


def password_needs_rehash(encoded: str) -> bool:
    if not encoded.startswith("$argon2id$"):
        return True
    try:
        return _PASSWORD_HASHER.check_needs_rehash(encoded)
    except (InvalidHashError, VerificationError):
        return True


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _session_ttl_seconds() -> int:
    try:
        hours = int(os.environ.get("VR_SESSION_TTL_HOURS", "12"))
    except ValueError as exc:
        raise RuntimeError("VR_SESSION_TTL_HOURS must be an integer") from exc
    if not 1 <= hours <= 168:
        raise RuntimeError("VR_SESSION_TTL_HOURS must be between 1 and 168")
    return hours * 3600


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@lru_cache(maxsize=1)
def _dummy_password_hash() -> str:
    return _argon2_hash(secrets.token_urlsafe(32))


def issue_session(username: str) -> str:
    initialize()
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    with _DB_LOCK, _connection() as db:
        user = db.execute(
            "SELECT id, password_version FROM auth_users WHERE username = ?",
            (username,),
        ).fetchone()
        if user is None:
            raise RuntimeError("cannot issue a session for an unknown user")
        db.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (now,))
        db.execute(
            """INSERT INTO auth_sessions
               (token_hash, user_id, password_version, created_at, expires_at)
               VALUES (?, ?, ?, ?, ?)""",
            (_token_hash(token), user["id"], user["password_version"], now, now + _session_ttl_seconds()),
        )
        db.commit()
    return token


def session_username(request: Request) -> str | None:
    if not enabled():
        return None
    token = request.cookies.get(cookie_name(), "")
    if not token:
        return None
    initialize()
    now = int(time.time())
    token_hash = _token_hash(token)
    with _DB_LOCK, _connection() as db:
        row = db.execute(
            """SELECT u.username, s.expires_at, s.password_version AS session_version,
                      u.password_version AS user_version
               FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
               WHERE s.token_hash = ?""",
            (token_hash,),
        ).fetchone()
        if row is None:
            return None
        if row["expires_at"] <= now or row["session_version"] != row["user_version"]:
            db.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))
            db.commit()
            return None
        return str(row["username"])


def bearer_authorized(request: Request, api_key: str) -> bool:
    return bool(api_key) and hmac.compare_digest(
        request.headers.get("authorization", ""), f"Bearer {api_key}"
    )


def is_authorized(request: Request, api_key: str) -> bool:
    return bearer_authorized(request, api_key) or (enabled() and session_username(request) is not None)


def _failure_window_seconds() -> int:
    return 15 * 60


def _failure_limit() -> int:
    return 8


def login_allowed() -> bool:
    initialize()
    cutoff = int(time.time()) - _failure_window_seconds()
    with _DB_LOCK, _connection() as db:
        db.execute("DELETE FROM auth_login_failures WHERE attempted_at <= ?", (cutoff,))
        count = db.execute("SELECT COUNT(*) FROM auth_login_failures").fetchone()[0]
        db.commit()
        return int(count) < _failure_limit()


def record_failed_login() -> None:
    initialize()
    with _DB_LOCK, _connection() as db:
        db.execute("INSERT INTO auth_login_failures(attempted_at) VALUES (?)", (int(time.time()),))
        db.commit()


def clear_failed_logins() -> None:
    initialize()
    with _DB_LOCK, _connection() as db:
        db.execute("DELETE FROM auth_login_failures")
        db.commit()


def authenticate(username: str, password: str) -> str | None:
    """Verify credentials, transparently upgrade old hashes, and issue a session."""
    initialize()
    if not login_allowed():
        return None
    normalized_username = username.strip()
    with _DB_LOCK, _connection() as db:
        user = db.execute(
            "SELECT id, username, password_hash, password_version FROM auth_users WHERE username = ?",
            (normalized_username,),
        ).fetchone()
    encoded = str(user["password_hash"]) if user is not None else _dummy_password_hash()
    valid = verify_password(password, encoded)
    if user is None or not valid:
        record_failed_login()
        return None

    clear_failed_logins()
    if password_needs_rehash(encoded):
        now = int(time.time())
        with _DB_LOCK, _connection() as db:
            db.execute(
                """UPDATE auth_users
                   SET password_hash = ?, password_version = password_version + 1, updated_at = ?
                   WHERE id = ?""",
                (_argon2_hash(password), now, user["id"]),
            )
            db.execute("DELETE FROM auth_sessions WHERE user_id = ?", (user["id"],))
            db.commit()
    return issue_session(str(user["username"]))


def revoke_session(token: str) -> None:
    if not token:
        return
    initialize()
    with _DB_LOCK, _connection() as db:
        db.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (_token_hash(token),))
        db.commit()


def set_password(username: str, password: str) -> None:
    """Create or reset the single local user and revoke every browser session."""
    normalized_username = username.strip()
    if not normalized_username or len(normalized_username) > 128:
        raise ValueError("username must contain between 1 and 128 characters")
    new_hash = hash_password(password)
    now = int(time.time())
    with _DB_LOCK, _connection() as db:
        _create_schema(db)
        user = db.execute("SELECT id FROM auth_users LIMIT 1").fetchone()
        if user is None:
            db.execute(
                "INSERT INTO auth_users(username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (normalized_username, new_hash, now, now),
            )
        else:
            db.execute(
                """UPDATE auth_users
                   SET username = ?, password_hash = ?, password_version = password_version + 1, updated_at = ?
                   WHERE id = ?""",
                (normalized_username, new_hash, now, user["id"]),
            )
        db.execute("DELETE FROM auth_sessions")
        db.execute("DELETE FROM auth_login_failures")
        db.commit()


def origin_allowed(request: Request) -> bool:
    origin = request.headers.get("origin", "").rstrip("/")
    if not origin:
        return False
    allowed = {
        item.strip().rstrip("/")
        for item in os.environ.get("VR_ALLOW_ORIGINS", "*").split(",")
        if item.strip() and item.strip() != "*"
    }
    return not allowed or origin in allowed


def request_uses_session(request: Request) -> bool:
    return bool(request.cookies.get(cookie_name(), ""))


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        cookie_name(),
        token,
        max_age=_session_ttl_seconds(),
        httponly=True,
        secure=_cookie_secure(),
        samesite="strict",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"


def clear_session_cookie(response: Response) -> None:
    for name, secure in ((_LOCAL_COOKIE_NAME, False), (_SECURE_COOKIE_NAME, True)):
        response.delete_cookie(
            name,
            path="/",
            secure=secure,
            httponly=True,
            samesite="strict",
        )
    response.headers["Cache-Control"] = "no-store"


def _main() -> int:
    parser = argparse.ArgumentParser(description="Manage Vibe Research browser authentication")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("hash-password", help="print an Argon2id hash for first-run bootstrap")
    reset = subparsers.add_parser("reset-password", help="reset the local user and revoke all sessions")
    reset.add_argument("--username", default=os.environ.get("VR_AUTH_USERNAME", "admin"))
    args = parser.parse_args()

    password = getpass.getpass("Password: ")
    confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        parser.error("passwords do not match")
    if args.command == "hash-password":
        print(hash_password(password))
    else:
        set_password(args.username, password)
        print(f"Password reset for {args.username}; all browser sessions revoked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
