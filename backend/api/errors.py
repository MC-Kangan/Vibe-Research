from __future__ import annotations

from typing import Any

from fastapi import HTTPException


class ApiProblem(HTTPException):
    """Stable machine-readable API error with an English fallback message."""

    def __init__(
        self,
        status_code: int,
        code: str,
        detail: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code
        self.params = params or {}
