from pathlib import Path
from types import SimpleNamespace

import ibkr_analytics as analytics
import position_service


def _current_root():
    return position_service.ElementTree.fromstring(
        """
        <FlexQueryResponse>
          <FlexStatements><FlexStatement accountId="U1234567" currency="USD" reportDate="20260807" /></FlexStatements>
          <OpenPositions><OpenPosition accountId="U1234567" symbol="AAPL" description="Apple" assetCategory="STK"
            currency="USD" listingExchange="NASDAQ" position="10" avgCost="100" markPrice="110" positionValue="1100" fxRateToBase="1" unrealizedPnL="100" /></OpenPositions>
          <Trades><Trade accountId="U1234567" symbol="AAPL" description="Apple" assetCategory="STK" currency="USD" listingExchange="NASDAQ"
            transactionID="T1" tradeDate="20260801" buySell="BUY" quantity="10" tradePrice="100" /></Trades>
          <EquitySummaryByReportDateInBase accountId="U1234567" reportDate="20260807" total="1200" />
        </FlexQueryResponse>
        """
    )


def _history_root():
    return position_service.ElementTree.fromstring(
        """
        <FlexQueryResponse><FlexStatements><FlexStatement accountId="U1234567" currency="USD" toDate="20260807">
          <ChangeInNAV currency="USD" fromDate="20260807" toDate="20260807" startingValue="1000" endingValue="1200" mtm="200" />
          <MTMPerformanceSummaryUnderlying reportDate="20260807" symbol="AAPL" assetCategory="STK"
            prevCloseQuantity="10" prevClosePrice="105" closeQuantity="10" closePrice="110"
            transactionMtm="40" priorOpenMtm="10" commissions="1" total="49" />
        </FlexStatement></FlexStatements></FlexQueryResponse>
        """
    )


def test_history_is_idempotent_and_exposes_analytics(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("VR_IBKR_ANALYTICS_STORE", str(tmp_path / "analytics.sqlite3"))
    monkeypatch.setenv("VR_IBKR_POSITION_STORE", str(tmp_path / "positions.json"))
    position_service.refresh_from_root(_current_root())
    analytics._insert_current_instruments(_current_root())
    assert analytics._insert_current_data(_current_root()) == 1
    analytics._insert_history(_history_root())
    analytics._insert_history(_history_root())

    result = analytics.analytics("all")
    assert result["latest_nav"] == 1200.0
    assert result["daily_pnl"][0]["pnl_amount"] == 200.0
    assert result["latest_contributors"][0]["symbol"] == "AAPL"
    assert result["latest_contributors"][0]["previous_close_quantity"] == 10.0
    assert analytics.list_instruments("closed") == []


def test_chart_applies_mapping_multiplier_and_range(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("VR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("VR_IBKR_ANALYTICS_STORE", str(tmp_path / "analytics.sqlite3"))
    monkeypatch.setenv("VR_IBKR_POSITION_STORE", str(tmp_path / "positions.json"))
    root = _current_root()
    position_service.refresh_from_root(root)
    analytics._insert_current_instruments(root)
    analytics._insert_current_data(root)
    key = analytics.list_instruments("open")[0]["instrument_key"]
    analytics.save_mapping(key, "AAPL", 0.01)
    bars = SimpleNamespace(
        source="test",
        bars=[SimpleNamespace(date="2026-08-01", open=100, high=110, low=90, close=105, adjusted_close=105, volume=1000, currency="USD")],
    )
    monkeypatch.setattr(analytics.market_data, "get_bars", lambda *_args: bars)
    result = analytics.chart(key, "1m")
    assert result["provider_symbol"] == "AAPL"
    assert result["bars"][0]["close"] == 1.05
    assert result["executions"][0]["price"] == 100.0


def test_symbol_summary_is_not_misreported_as_mtm_contributor(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("VR_IBKR_ANALYTICS_STORE", str(tmp_path / "analytics.sqlite3"))
    monkeypatch.setenv("VR_IBKR_POSITION_STORE", str(tmp_path / "positions.json"))
    root = position_service.ElementTree.fromstring(
        """
        <FlexQueryResponse><FlexStatement accountId="U1" fromDate="20260807" toDate="20260807">
          <ChangeInNAV currency="GBP" fromDate="20260807" toDate="20260807" startingValue="100" endingValue="101" mtm="1" />
          <SymbolSummary accountId="U1" symbol="AAPL" tradeDate="20260807" realizedPnl="50" />
        </FlexStatement></FlexQueryResponse>
        """
    )
    analytics._insert_history(root)
    assert analytics.analytics("all")["latest_contributors"] == []


def test_mixed_reporting_currencies_do_not_create_false_aggregate(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("VR_IBKR_ANALYTICS_STORE", str(tmp_path / "analytics.sqlite3"))
    monkeypatch.setenv("VR_IBKR_POSITION_STORE", str(tmp_path / "positions.json"))
    current = position_service.ElementTree.fromstring(
        """
        <FlexQueryResponse>
          <FlexStatement accountId="U1" currency="GBP"/><FlexStatement accountId="U2" currency="USD"/>
          <OpenPosition accountId="U1" symbol="VOD" currency="GBP" listingExchange="LSE" position="1" positionValue="10" fxRateToBase="1"/>
          <OpenPosition accountId="U2" symbol="AAPL" currency="USD" listingExchange="NASDAQ" position="1" positionValue="20" fxRateToBase="1"/>
        </FlexQueryResponse>
        """
    )
    position_service.refresh_from_root(current)
    history = position_service.ElementTree.fromstring(
        """
        <FlexQueryResponse>
          <FlexStatement accountId="U1" toDate="20260807"><ChangeInNAV currency="GBP" toDate="20260807" startingValue="10" endingValue="11" mtm="1"/></FlexStatement>
          <FlexStatement accountId="U2" toDate="20260807"><ChangeInNAV currency="USD" toDate="20260807" startingValue="20" endingValue="22" mtm="2"/></FlexStatement>
        </FlexQueryResponse>
        """
    )
    analytics._insert_history(history)
    result = analytics.analytics("all")
    assert result["latest_nav"] is None
    assert result["gross_exposure"] is None
    assert result["allocation"] == []
    assert result["warnings"]


def test_history_query_uses_fast_normal_pacing(monkeypatch):
    calls: list[tuple[str | None, float]] = []
    root = _history_root()
    monkeypatch.setenv("VR_IBKR_FLEX_HISTORY_QUERY_ID", "history")
    monkeypatch.delenv("VR_IBKR_FLEX_INTER_QUERY_DELAY_SECONDS", raising=False)
    monkeypatch.setattr(
        analytics.position_service,
        "load_flex_statement_serialized",
        lambda query_id, min_interval_seconds: calls.append((query_id, min_interval_seconds)) or root,
    )

    assert analytics._load_history_with_adaptive_pacing() is root
    assert calls == [("history", 5.0)]


def test_history_query_retries_one_transient_failure_with_bounded_delay(monkeypatch):
    calls: list[float] = []
    root = _history_root()
    monkeypatch.setenv("VR_IBKR_FLEX_HISTORY_QUERY_ID", "history")

    def load(_query_id, *, min_interval_seconds):
        calls.append(min_interval_seconds)
        if len(calls) == 1:
            raise position_service.PositionServiceError("busy", retryable=True, code="1001")
        return root

    monkeypatch.setattr(analytics.position_service, "load_flex_statement_serialized", load)

    assert analytics._load_history_with_adaptive_pacing() is root
    assert calls == [5.0, 15.0]
