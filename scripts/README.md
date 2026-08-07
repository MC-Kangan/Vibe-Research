# Local integrated test run

From the VibeResearch repository root:

```bash
bash scripts/start-local-stack.sh
```

The launcher starts an isolated PA Master SQLite demo database, TradeAgent, the Vibe backend,
and the Vite frontend. It does not read IBKR credentials or write Notion data. Open
`http://127.0.0.1:5899/portfolio` for the PA Master position overlay and
`http://127.0.0.1:5899/stock-data` for Skills Analysis.

Logs and the temporary demo database are kept in the printed `RUN_DIR`. Press Ctrl-C in the
launcher terminal to stop all child services.
