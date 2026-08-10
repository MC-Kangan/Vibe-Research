import crypto_portfolio


def _stores(monkeypatch, tmp_path):
    monkeypatch.setattr(crypto_portfolio.manual_crypto_positions, "_STORE", tmp_path / "manual.json")
    monkeypatch.setattr(crypto_portfolio.coinbase_positions, "_STORE", tmp_path / "coinbase.json")


def test_csv_preview_rejects_duplicate_wallet_asset(monkeypatch, tmp_path):
    _stores(monkeypatch, tmp_path)
    content = "wallet_label,asset,quantity,unit_cost,cost_currency\nLedger,BTC,1,10000,USD\nLedger,BTC,2,,USD\n"
    try:
        crypto_portfolio.parse_csv(content)
    except crypto_portfolio.CryptoPortfolioError as exc:
        assert "重复" in str(exc)
    else:
        raise AssertionError("duplicate rows should fail atomically")


def test_csv_commit_upserts_matching_key_and_preserves_other_wallets(monkeypatch, tmp_path):
    _stores(monkeypatch, tmp_path)
    crypto_portfolio.upsert_manual({"wallet_label": "Ledger", "asset": "BTC", "quantity": 1})
    crypto_portfolio.upsert_manual({"wallet_label": "Trezor", "asset": "ETH", "quantity": 2})
    rows = crypto_portfolio.commit_csv("wallet_label,asset,quantity,unit_cost,cost_currency\nLedger,BTC,3,20000,USD\n")
    by_key = {(row["wallet_label"], row["asset"]): row for row in rows}
    assert by_key[("Ledger", "BTC")]["quantity"] == 3
    assert by_key[("Trezor", "ETH")]["quantity"] == 2


def test_existing_manual_stocks_default_out_of_combined_total(monkeypatch, tmp_path):
    monkeypatch.setattr(crypto_portfolio.stock_portfolio, "get_portfolio", lambda: {"holdings": [
        {"code": "AAPL", "market_value": 1000, "currency": "USD", "include_in_total": False},
        {"code": "MSFT", "market_value": 500, "currency": "USD", "include_in_total": True},
    ]})
    monkeypatch.setattr(crypto_portfolio.position_service, "get_current", lambda: {"summary": {"reporting_currency": "USD"}, "positions": []})
    monkeypatch.setattr(crypto_portfolio, "get_crypto_portfolio", lambda _currency: {"total": 0, "fiat_total": 0, "cash_like_total": 0, "gaps": []})
    monkeypatch.setattr(crypto_portfolio.fx_rates, "get_rate", lambda _source, _target: 1.0)
    summary = crypto_portfolio.combined_summary()
    assert summary["stock"] == 500
    assert summary["total"] == 500


def test_unpriced_crypto_asset_remains_unavailable_in_aggregate(monkeypatch):
    monkeypatch.setattr(crypto_portfolio, "get_coinbase_snapshot", lambda: {"positions": [], "status": "empty"})
    monkeypatch.setattr(crypto_portfolio, "get_manual", lambda: [{
        "source": "manual", "wallet_label": "Ledger", "asset": "BTC", "quantity": 1, "cash_like": False,
    }])
    monkeypatch.setattr(
        crypto_portfolio.market_data,
        "get_snapshot",
        lambda *_args: (_ for _ in ()).throw(crypto_portfolio.market_data.ProviderError("offline")),
    )
    result = crypto_portfolio.get_crypto_portfolio()
    assert result["assets"][0]["reporting_market_value"] is None
    assert result["total"] == 0
    assert result["gaps"]


def test_combined_summary_excludes_non_equity_ibkr_assets(monkeypatch):
    monkeypatch.setattr(crypto_portfolio.position_service, "get_current", lambda: {
        "summary": {"reporting_currency": "USD"},
        "positions": [
            {"symbol": "AAPL", "asset_class": "STK", "reporting_market_value": 1000, "reporting_currency": "USD"},
            {"symbol": "AAPL  C", "asset_class": "OPT", "reporting_market_value": 250, "reporting_currency": "USD"},
        ],
    })
    monkeypatch.setattr(crypto_portfolio.stock_portfolio, "get_portfolio", lambda: {"holdings": []})
    monkeypatch.setattr(crypto_portfolio, "get_crypto_portfolio", lambda _currency: {"total": 0, "fiat_total": 0, "cash_like_total": 0, "gaps": []})
    monkeypatch.setattr(crypto_portfolio.fx_rates, "get_rate", lambda _source, _target: 1.0)
    summary = crypto_portfolio.combined_summary()
    assert summary["stock"] == 1000
    assert summary["total"] == 1000
    assert any("OPT excluded" in gap for gap in summary["gaps"])
