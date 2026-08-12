from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

import auth
from api.errors import ApiProblem


router = APIRouter(prefix="/api/auth", tags=["auth"])


class AuthLoginReq(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=1024)


@router.get("/session")
def session(request: Request):
    username = auth.session_username(request)
    return {"data": {"enabled": auth.enabled(), "authenticated": bool(username), "username": username}}


@router.post("/login")
def login(request: AuthLoginReq, response: Response):
    if not auth.enabled():
        raise ApiProblem(404, "authentication_disabled", "Application authentication is disabled.")
    if not auth.login_allowed():
        raise ApiProblem(429, "login_rate_limited", "Too many failed login attempts; try again later.", headers={"Retry-After": "900"})
    token = auth.authenticate(request.username, request.password)
    if token is None:
        raise ApiProblem(401, "invalid_credentials", "Invalid username or password.")
    username = request.username.strip()
    auth.set_session_cookie(response, token)
    return {"data": {"enabled": True, "authenticated": True, "username": username}}


@router.post("/logout")
def logout(request: Request, response: Response):
    auth.revoke_session(request.cookies.get(auth.cookie_name(), ""))
    auth.clear_session_cookie(response)
    return {"data": {"authenticated": False}}
