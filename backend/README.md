# Vibe-Research Backend

A股数据层 + 可插拔 AI 层。全部只读、无状态；不预置任何标的、不推荐、不预测。

## 安装

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

> 行情 + 研报只需 `fastapi / uvicorn / requests`（秒装、必可用）。
> 一致预期 / 新闻 / 公告需 `akshare`，K线 / 财务需 `mootdx`；未装时对应端点返回 501 + 安装提示，不影响其余功能。

## 1. HTTP API（给网页前端 + 系统 AI）

```bash
.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8900
```

| 端点 | 说明 | 依赖 |
|---|---|---|
| `GET /api/health` | 健康检查 | — |
| `GET /api/indices` | 大盘指数实时行情 | stdlib |
| `GET /api/quote?codes=600519,000858` | 实时行情（PE/PB/市值/涨跌停…） | stdlib |
| `GET /api/valuation?code=600519` | 完整估值（前向PE/PEG/消化年数） | requests+akshare |
| `GET /api/valuation/percentile?code=600519` | 估值历史分位（近5年·百度股市通） | akshare |
| `GET /api/financials?code=600519` | 财务关键指标（同花顺摘要，最新报告期，前端个股页用） | akshare |
| `GET /api/reports?code=600519` | 个股研报列表（含 PDF 链接） | requests |
| `GET /api/announcements?code=600519` | 近期公告（东财） | requests |
| `GET /api/news?code=600519` | 个股新闻 | akshare |
| `GET /api/kline?code=600519` | K线 | mootdx |
| — | *（AI 工具层走腾讯 K 线，mootdx 仅作备份：mootdx 是 TCP 7709，部分网络连不通要等十几秒超时）* | — |
| `GET /api/finance?code=600519` | 季报财务快照（mootdx，前端未用 / 备用） | mootdx |
| **资金面·筹码·信号（v3.3）** | `/api/margin` · `/block-trade` · `/holders` · `/dividend` · `/fund-flow` · `/dragon-tiger` · `/lockup` · `/blocks` · `/hot-concepts` · `/investor-qa` · `/industry` | requests |
| `GET /api/market/overview` · `/api/radar` | 市场情绪+板块资金 · 资讯雷达 | akshare / stdlib |
| `POST /api/chat` | 系统 AI 对话（function calling，AI 自己调数据工具） | requests |
| `POST /api/debate` | **多空辩论**（多 agent，流式 NDJSON）：事实底稿 → 多方 / 空方 →（可选反驳）→ 中立主持 | requests |
| `GET /api/market-data/crypto/overview` | BTC + 大市值 altcoins、总市值、成交量与主导率 | Coinbase + optional CoinGecko |
| `GET /api/portfolio/crypto` | Coinbase 与手工钱包的本地加密持仓视图 | Coinbase + local JSON |
| `GET /api/portfolio/summary` | 股票、加密货币与现金的统一报告币种汇总 | IBKR + Coinbase + local holdings |
| `POST /api/reflect` | **反思审计**（流式 NDJSON）：对一段已写好的分析做推理审计 | requests |

`/api/debate` 请求体：`{"code": "600519", "asset_type": "equity", "rounds": 1, "llm": {...}}`（`asset_type` 默认为 `equity`；加密货币传 `crypto`；`rounds=2` 加一轮交叉反驳）。
事件类型：`status` · `dossier_progress`（底稿逐项进度）· `dossier` · `stage`（角色开始）·
`delta`（增量文本）· `stage_done`（角色完成，失败时带 `failed: true`）· `done` · `error`。

`/api/reflect` 请求体：`{"source": "待审的分析文本", "title": "可选标题", "llm": {...}}`。

> 两个端点都**不产出买卖结论**：辩论终点是「分歧点 + 验证清单」，反思终点是「怎么继续验证」。

> 上表为主要端点；完整路由清单见 `app.py`。要更全量的 A 股数据（打板 / ETF期权 / 全市场行业排名等），用根目录 [`a-stock-data/`](../a-stock-data/SKILL.md) 工具箱。

`/api/chat` 请求体：
```json
{
  "messages": [{"role": "user", "content": "茅台估值贵不贵？"}],
  "context": "本页上下文（可空）",
  "llm": {"baseURL": "https://api.deepseek.com", "apiKey": "sk-…", "model": "deepseek-chat"}
}
```
`llm` 由前端从本地配置随请求带上，后端不持久化 key。

## 2. MCP Server（给 Claude Code / 高手 agent）

零第三方依赖，复用同一套数据工具。挂进 Claude Code：

```bash
claude mcp add vibe-research -- \
  "$(pwd)/.venv/bin/python" "$(pwd)/mcp_server.py"
```

挂上后，你的 agent 直接拥有 `query_quote / query_valuation / query_reports / query_news` 四个工具，
用你自己的订阅额度调数据、多步分析——无需 API key、不占本产品成本。

### 完整 A 股数据工具箱（随仓库自带）

MCP 的 4 个工具是「零配置、开箱即用」的常用项。若 agent 需要更全的 A 股数据（龙虎榜 / 融资融券 / 大宗交易 / 股东户数 / 分红 / 资金流 / 解禁 / 概念板块 / 打板情绪 / ETF 期权 / 互动易 / 全市场行业排名 …共 **47 个端点**），本仓库根目录**自带完整数据源** [`a-stock-data/`](../a-stock-data/SKILL.md)（a-stock-data v3.6.0）：

- 要调哪个接口，直接看 [`a-stock-data/SKILL.md`](../a-stock-data/SKILL.md)——每个端点都有 copy-paste 即用的代码（内嵌全部调用逻辑，零第三方数据封装依赖，东财接口已内置限流防封）。
- 运行依赖：`pip install mootdx requests pandas stockstats`（自包含，v3.0 起已移除 akshare）。
- 上游与更新：[github.com/simonlin1212/a-stock-data](https://github.com/simonlin1212/a-stock-data)（不更新也能一直用，自带的是固定可用快照）。
- 分工：**MCP 4 工具** = 网页 / 轻量常用；**自带数据源 40+ 端点** = agent 深度自助调研的全量工具箱。二者同源，按需取用。

## 合规

## 真实持仓与浏览器登录

设置 `VR_IBKR_FLEX_TOKEN` 和 `VR_IBKR_FLEX_QUERY_ID` 后，网页「我的持仓」的
「仅刷新当前」按钮会执行只读 Flex current-position 查询，并将规范化快照存到
`VR_DATA_DIR`。当 current query 的成本字段为空时，只有成交净数量与当前数量完全
一致的持仓才会用 Flex `Trade` 重建成本和浮盈；无法核对的数值显示为不可用。刷新
失败时会保留上一次有效快照；手工持仓记录仍使用原有本地存储。投资目标与风险偏好
保存到同目录的 `position-preferences.json`，并在用户主动调用持仓 AI 分析时加入提示。

NAS 部署时建议启用 `VR_AUTH_ENABLED=true`、`VR_AUTH_USERNAME` 和
`VR_AUTH_PASSWORD_HASH`。用户名和哈希只在首次启动时写入 `/data/auth.sqlite3`；
密码使用 Argon2id，浏览器使用可立即撤销的 HttpOnly 会话。生成首次哈希：

```bash
docker compose run --rm backend python auth.py hash-password
```

请使用密码管理器生成至少 15 个字符的密码。在 Compose `.env` 中用单引号包住完整
哈希，避免 `$` 被插值。忘记或怀疑密码泄露时
运行 `docker compose exec backend python auth.py reset-password --username admin`；这会
立刻撤销所有已有会话。`VR_API_KEY` 仍可供脚本调用。远程访问应通过 Tailscale Serve
暴露前端，不要直接开放 FastAPI、TradeAgent 或数据库端口。

- 数据端点只返回客观行情/研报/财报/新闻，不含任何建议、排名、预测。
- `/api/chat` 的 system prompt 内置中立红线：不荐股、不预测涨跌、不给买卖时机、不构成投资建议。
- 分析结论一律由用户配置的模型 / agent 给出，本产品只提供数据与工具。
