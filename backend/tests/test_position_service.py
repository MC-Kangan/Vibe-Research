import logging
from pathlib import Path

import pytest

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


def test_flex_request_retries_transient_statement_generation(monkeypatch):
    monkeypatch.setenv("VR_IBKR_FLEX_TOKEN", "token")
    monkeypatch.setenv("VR_IBKR_FLEX_QUERY_ID", "query")
    monkeypatch.setenv("VR_IBKR_FLEX_REQUEST_RETRIES", "2")
    monkeypatch.setenv("VR_IBKR_FLEX_RETRY_DELAY_SECONDS", "0.5")
    responses = iter([
        service.ElementTree.fromstring(
            '<FlexQueryResponse><Status>Fail</Status><ErrorCode>1001</ErrorCode>'
            '<ErrorMessage>Statement could not be generated at this time.</ErrorMessage></FlexQueryResponse>'
        ),
        service.ElementTree.fromstring(
            '<FlexQueryResponse><Status>Success</Status><ReferenceCode>ref</ReferenceCode></FlexQueryResponse>'
        ),
        service.ElementTree.fromstring(
            '<FlexQueryResponse><Status>Success</Status><FlexStatement accountId="U1" /></FlexQueryResponse>'
        ),
    ])
    monkeypatch.setattr(service, "_request_xml", lambda *_args, **_kwargs: next(responses))
    monkeypatch.setattr(service, "sleep", lambda _seconds: None)

    statement = service._load_flex_statement()

    assert statement.find(".//FlexStatement").attrib["accountId"] == "U1"


def test_flex_failure_handles_namespaces_and_nonstandard_failure_status():
    root = service.ElementTree.fromstring(
        """
        <FlexStatementResponse xmlns="urn:ibkr:flex">
          <Status>Failure</Status><ErrorCode>1018</ErrorCode>
          <ErrorMessage>Too many requests.</ErrorMessage>
        </FlexStatementResponse>
        """
    )

    with pytest.raises(service.PositionServiceError) as caught:
        service._raise_flex_failure(root)

    assert str(caught.value) == "IBKR Flex request failed (1018): Too many requests."
    assert caught.value.retryable is False


def test_unexpected_flex_document_has_safe_diagnostic_logging(monkeypatch, caplog):
    response = service.requests.Response()
    response.status_code = 200
    response.headers["Content-Type"] = "text/html; charset=utf-8"
    response._content = b"<html>temporary upstream page</html>"
    monkeypatch.setattr(service.requests, "get", lambda *_args, **_kwargs: response)

    with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
        with pytest.raises(service.PositionServiceError) as caught:
            service._request_xml("/SendRequest", {"t": "secret", "q": "query", "v": "3"})

    assert caught.value.retryable is True
    assert "unexpected document" in str(caught.value)
    assert "temporary upstream page" not in str(caught.value)
    assert any("[ibkr-flex] unexpected document endpoint=/SendRequest" in record.message for record in caplog.records)


def test_serialized_flex_reports_wait_from_the_last_completed_request(monkeypatch):
    root = _statement()
    clock = iter([100.0, 110.0, 170.0])
    waits: list[float] = []
    monkeypatch.setattr(service, "_LAST_FLEX_REQUEST_COMPLETED_AT", None)
    monkeypatch.setattr(service, "_load_flex_statement", lambda _query_id=None: root)
    monkeypatch.setattr(service, "monotonic", lambda: next(clock))
    monkeypatch.setattr(service, "sleep", waits.append)

    service.load_flex_statement_serialized("current", min_interval_seconds=60)
    service.load_flex_statement_serialized("history", min_interval_seconds=60)

    assert waits == [50.0]


def test_position_cost_and_pnl_are_reconstructed_only_when_trades_reconcile():
    root = service.ElementTree.fromstring(
        """
        <FlexQueryResponse>
          <FlexStatement accountId="U1" currency="USD" />
          <OpenPosition accountId="U1" conid="1" symbol="AAPL" assetCategory="STK"
            currency="USD" position="3" costBasisPrice="0" costBasisMoney="0"
            markPrice="313.33" positionValue="939.99" fifoPnlUnrealized="0" />
          <OpenPosition accountId="U1" conid="2" symbol="MBGL" assetCategory="STK"
            currency="USD" position="2" costBasisPrice="0" markPrice="19.7" positionValue="39.4" />
          <Trade accountId="U1" conid="1" symbol="AAPL" assetCategory="STK" quantity="3"
            cost="756" ibCommission="-0.45" />
          <Trade accountId="U1" conid="2" symbol="MBGL" assetCategory="STK" quantity="1"
            cost="-10" ibCommission="-0.1" />
        </FlexQueryResponse>
        """
    )

    snapshot = service._build_snapshot(root)
    by_symbol = {row["symbol"]: row for row in snapshot["positions"]}

    assert by_symbol["AAPL"]["average_cost"] == 252.15
    assert by_symbol["AAPL"]["unrealized_pnl"] == pytest.approx(183.54)
    assert by_symbol["AAPL"]["cost_status"] == "trade_reconstructed"
    assert by_symbol["AAPL"]["pnl_status"] == "trade_reconstructed"
    assert by_symbol["MBGL"]["average_cost"] is None
    assert by_symbol["MBGL"]["unrealized_pnl"] is None
    assert by_symbol["MBGL"]["pnl_status"] == "unavailable"


def test_nonzero_broker_cost_and_pnl_take_precedence_over_trades():
    root = service.ElementTree.fromstring(
        """
        <FlexQueryResponse>
          <FlexStatement accountId="U1" currency="USD" />
          <OpenPosition accountId="U1" conid="1" symbol="AAPL" assetCategory="STK"
            currency="USD" position="3" costBasisPrice="250" markPrice="313.33"
            positionValue="939.99" fifoPnlUnrealized="190" />
          <Trade accountId="U1" conid="1" symbol="AAPL" assetCategory="STK" quantity="3"
            cost="756" ibCommission="-0.45" />
        </FlexQueryResponse>
        """
    )

    position = service._build_snapshot(root)["positions"][0]

    assert position["average_cost"] == 250.0
    assert position["unrealized_pnl"] == 190.0
    assert position["cost_status"] == "broker"
    assert position["pnl_status"] == "broker"
