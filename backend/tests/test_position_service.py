from pathlib import Path

import position_service as service


def _statement() -> service.ElementTree.Element:
    return service.ElementTree.fromstring(
        """
        <FlexQueryResponse>
          <FlexStatements>
            <FlexStatement accountId="U1234567" currency="USD" reportDate="20260806" />
          </FlexStatements>
          <OpenPositions>
            <OpenPosition accountId="U1234567" symbol="AAPL" description="Apple" assetCategory="STK"
              currency="USD" listingExchange="NASDAQ" position="10" avgCost="100" markPrice="110"
              positionValue="1100" fxRateToBase="1" unrealizedPnL="100" />
          </OpenPositions>
          <EquitySummaryByReportDateInBase accountId="U1234567" reportDate="20260806" total="1200" />
        </FlexQueryResponse>
        """
    )


def test_current_snapshot_is_empty_when_not_configured(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("VR_IBKR_FLEX_TOKEN", raising=False)
    monkeypatch.delenv("VR_IBKR_FLEX_QUERY_ID", raising=False)
    monkeypatch.setenv("VR_IBKR_POSITION_STORE", str(tmp_path / "positions.json"))
    snapshot = service.get_current()
    assert snapshot["status"] == "not_configured"
    assert snapshot["positions"] == []


def test_refresh_normalizes_and_masks_position(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("VR_IBKR_FLEX_TOKEN", "token")
    monkeypatch.setenv("VR_IBKR_FLEX_QUERY_ID", "query")
    monkeypatch.setenv("VR_IBKR_POSITION_STORE", str(tmp_path / "positions.json"))
    monkeypatch.setattr(service, "_load_flex_statement", _statement)
    snapshot = service.refresh()
    assert snapshot["status"] == "available"
    assert snapshot["summary"]["nav"] == 1200.0
    position = snapshot["positions"][0]
    assert position["symbol"] == "AAPL"
    assert position["quantity"] == 10.0
    assert position["account_label"] == "IBKR ••••4567"
    assert "U1234567" not in position["account_label"]


def test_empty_refresh_does_not_replace_existing_snapshot_without_confirmation(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("VR_IBKR_FLEX_TOKEN", "token")
    monkeypatch.setenv("VR_IBKR_FLEX_QUERY_ID", "query")
    monkeypatch.setenv("VR_IBKR_POSITION_STORE", str(tmp_path / "positions.json"))
    monkeypatch.setattr(service, "_load_flex_statement", _statement)
    service.refresh()
    empty = service.ElementTree.fromstring(
        '<FlexQueryResponse><FlexStatement accountId="U1234567" currency="USD" /></FlexQueryResponse>'
    )
    monkeypatch.setattr(service, "_load_flex_statement", lambda: empty)
    monkeypatch.setenv("VR_IBKR_FLEX_COOLDOWN_SECONDS", "0")
    try:
        service.refresh()
    except service.PositionServiceError as error:
        assert "confirm_empty" in str(error)
    else:
        raise AssertionError("empty refresh should require explicit confirmation")
    assert service.get_current()["positions"][0]["symbol"] == "AAPL"


def test_snapshot_uses_only_latest_nav_date(monkeypatch):
    root = service.ElementTree.fromstring(
        """
        <FlexQueryResponse>
          <FlexStatement accountId="U1" currency="USD" />
          <OpenPosition accountId="U1" symbol="AAPL" currency="USD" position="1"
            positionValue="110" fxRateToBase="1" />
          <EquitySummaryByReportDateInBase accountId="U1" reportDate="20260805" total="100" />
          <EquitySummaryByReportDateInBase accountId="U1" reportDate="20260806" total="120" />
        </FlexQueryResponse>
        """
    )
    snapshot = service._build_snapshot(root)
    assert snapshot["report_date"] == "20260806"
    assert snapshot["summary"]["nav"] == 120.0


def test_snapshot_does_not_combine_different_account_base_currencies():
    root = service.ElementTree.fromstring(
        """
        <FlexQueryResponse>
          <FlexStatement accountId="U1" currency="USD" />
          <FlexStatement accountId="U2" currency="EUR" />
          <OpenPosition accountId="U1" symbol="AAPL" currency="USD" position="1"
            positionValue="100" fxRateToBase="1" />
          <OpenPosition accountId="U2" symbol="ASML" currency="EUR" position="1"
            positionValue="100" fxRateToBase="1" />
          <EquitySummaryByReportDateInBase accountId="U1" reportDate="20260806" total="100" />
          <EquitySummaryByReportDateInBase accountId="U2" reportDate="20260806" total="100" />
        </FlexQueryResponse>
        """
    )
    snapshot = service._build_snapshot(root)
    assert snapshot["summary"]["reporting_currency"] is None
    assert snapshot["summary"]["nav"] is None
    assert snapshot["summary"]["reporting_coverage"] is None
    assert snapshot["warnings"]
