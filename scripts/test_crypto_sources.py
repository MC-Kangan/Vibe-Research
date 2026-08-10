#!/usr/bin/env python3
"""Crypto integration smoke check; optionally refresh normalized Coinbase balances."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import crypto_portfolio  # noqa: E402
import market_data  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", default="BTC")
    parser.add_argument(
        "--refresh-coinbase",
        action="store_true",
        help="Call the view-only accounts API and replace the local normalized snapshot",
    )
    args = parser.parse_args()
    output = {
        "snapshot": asdict(market_data.get_snapshot(args.symbol, "crypto")),
        "bars": asdict(market_data.get_bars(args.symbol, "1mo", "1d", "crypto")),
        "overview": market_data.get_crypto_overview(),
        "coinbase_positions": (
            crypto_portfolio.refresh_coinbase()
            if args.refresh_coinbase
            else crypto_portfolio.get_coinbase_snapshot()
        ),
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
