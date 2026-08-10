# Local integrated test run

From the VibeResearch repository root:

```bash
bash scripts/start-local-stack.sh
```

The launcher starts TradeAgent, the Vibe backend, and the Vite frontend. It reads
optional IBKR Flex credentials from `.env.local`/`.env`.
Local portfolio data persists in `~/.vibe-research` by default. Set
`VIBE_LOCAL_DATA_DIR` to use another host directory; Docker-only `/data` values
from a shared `.env` are not used by the local launcher.
Open `http://127.0.0.1:5899/portfolio` for IBKR positions, P&L analytics, and
position deep dives, or `http://127.0.0.1:5899/stock-data` for Skills Analysis.

For crypto, run `python scripts/test_crypto_sources.py --symbol BTC` to inspect
Coinbase public prices/candles, CoinGecko overview availability, and the last
local Coinbase balance snapshot. Add `--refresh-coinbase` only when a backend
View key is configured and you want to refresh that normalized snapshot.

Logs are kept in the printed `RUN_DIR`. Press Ctrl-C in the
launcher terminal to stop all child services.

To inspect the configured Flex queries without changing the stored portfolio,
run `bash scripts/test-ibkr-flex.sh current`, `history`, or `all`. Avoid running
it while an application refresh is active; `all` applies the configured pacing
delay between the two IBKR requests. The application defaults to 5 seconds in
the normal case and uses a longer, bounded retry only when IBKR returns a
statement-generation or pacing response.
