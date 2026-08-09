"""Safely inspect an IBKR Flex query without changing Vibe's stored portfolio."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from time import monotonic


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import position_service  # noqa: E402


SECTIONS = (
    "FlexStatement",
    "OpenPosition",
    "Trade",
    "ChangeInNAV",
    "MTMPerformanceSummaryUnderlying",
    "SecurityInfo",
)


def _local_name(tag: object) -> str:
    return str(tag).rsplit("}", 1)[-1]


def inspect_query(label: str, query_id: str, wait_seconds: float = 0.0) -> bool:
    print(f"[{label}] requesting IBKR Flex report (read-only; no snapshot will be written)")
    started = monotonic()
    try:
        root = position_service.load_flex_statement_serialized(
            query_id,
            min_interval_seconds=wait_seconds,
        )
    except position_service.PositionServiceError as exc:
        print(f"[{label}] FAILED after {monotonic() - started:.1f}s: {exc}")
        return False

    nodes = list(root.iter())
    counts = {section: sum(_local_name(node.tag) == section for node in nodes) for section in SECTIONS}
    dates = sorted({
        value
        for node in nodes
        for key in ("reportDate", "toDate", "fromDate")
        if (value := node.attrib.get(key, "").strip())
    })
    print(f"[{label}] OK after {monotonic() - started:.1f}s; root={_local_name(root.tag)}")
    print(f"[{label}] sections: " + ", ".join(f"{name}={count}" for name, count in counts.items()))
    print(f"[{label}] dates: {', '.join(dates[-8:]) if dates else 'none reported'}")

    if label == "current" and counts["OpenPosition"] == 0:
        print("[current] WARNING: no OpenPosition rows; this query cannot refresh current holdings.")
    if label == "history" and counts["ChangeInNAV"] == 0:
        print("[history] WARNING: no ChangeInNAV rows; the P&L calendar will be empty.")
    if label == "history" and counts["MTMPerformanceSummaryUnderlying"] == 0:
        print("[history] WARNING: no MTMPerformanceSummaryUnderlying rows; contributor P&L will be empty.")
    if label == "history" and counts["Trade"] == 0:
        print("[history] WARNING: no Trade rows; buy/sell markers will be empty.")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", choices=("current", "history", "all"))
    args = parser.parse_args()

    token = os.environ.get("VR_IBKR_FLEX_TOKEN", "").strip()
    current_id = os.environ.get("VR_IBKR_FLEX_QUERY_ID", "").strip()
    history_id = os.environ.get("VR_IBKR_FLEX_HISTORY_QUERY_ID", "").strip()
    if not token:
        print("VR_IBKR_FLEX_TOKEN is not configured", file=sys.stderr)
        return 2
    requested = []
    if args.query in {"current", "all"}:
        requested.append(("current", current_id))
    if args.query in {"history", "all"}:
        requested.append(("history", history_id))
    if any(not query_id for _label, query_id in requested):
        missing = [label for label, query_id in requested if not query_id]
        print(f"Missing query ID for: {', '.join(missing)}", file=sys.stderr)
        return 2

    delay = float(os.environ.get("VR_IBKR_FLEX_INTER_QUERY_DELAY_SECONDS", "5"))
    success = True
    for index, (label, query_id) in enumerate(requested):
        success = inspect_query(label, query_id, delay if index else 0.0) and success
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
