from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

import myreports


router = APIRouter(prefix="/api/myreports", tags=["reports"])


class ReportIn(BaseModel):
    name: str
    content_b64: str


@router.get("")
def list_reports():
    return {"data": myreports.list_reports()}


@router.post("")
def upload_report(request: ReportIn):
    try:
        return {"data": myreports.save_report(request.name, request.content_b64)}
    except myreports.ReportError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/file/{report_id}")
def report_file(report_id: str):
    hit = myreports.report_path(report_id)
    if not hit:
        raise HTTPException(404, "研报不存在")
    path, name = hit
    return FileResponse(str(path), filename=name)


@router.delete("/{report_id}")
def delete_report(report_id: str):
    return {"data": {"ok": myreports.delete_report(report_id)}}
