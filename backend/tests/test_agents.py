"""工具层 + 多空辩论 + 反思 的回归测。全部离线、不联网（真实取数走 test_live.py）。

覆盖 v0.2.0 新增面：
- tools：工具定义与 handler 一一对应、裁剪逻辑、错误不抛。
- debate：角色流程、各角色的可见范围（谁能看到谁的发言）、底稿渲染与缺口标注。
- reflection：空输入、超长截断。
- 路由：/api/debate 与 /api/reflect 的参数与配置校验。
"""
import pytest
from fastapi.testclient import TestClient

import app as app_module
import ai_workflows
import chat
import debate
import reflection
import research
import tools
from api import ai_routes

client = TestClient(app_module.app)

_LLM = {"provider": "", "baseURL": "https://example.com/v1", "apiKey": "k", "model": "m"}


# ---- 工具层 ----

def test_every_tool_has_handler():
    """工具定义与执行实现必须一一对应——漏一个就是模型调了却报「未知工具」。"""
    assert set(tools.TOOL_NAMES) == set(tools._HANDLERS.keys())
    assert len(tools.TOOLS) == len(tools.TOOL_NAMES)


def test_tool_schema_shape():
    for t in tools.TOOLS:
        fn = t["function"]
        assert t["type"] == "function"
        assert fn["name"] and fn["description"]
        params = fn["parameters"]
        assert params["type"] == "object"
        for req in params.get("required", []):
            assert req in params["properties"], f"{fn['name']} 的必填参数 {req} 未在 properties 中定义"


def test_workflow_tool_scopes_are_valid_and_distinct():
    ai_workflows.validate_registry()
    assert set(ai_workflows.WORKFLOWS["portfolio"].tool_names) < set(tools.TOOL_NAMES)
    assert "query_us_filings" in ai_workflows.WORKFLOWS["stock"].tool_names
    assert "query_fund_flow" not in ai_workflows.WORKFLOWS["portfolio"].tool_names
    assert "run_research_skill" in ai_workflows.WORKFLOWS["stock"].tool_names
    assert "run_research_skill" in ai_workflows.WORKFLOWS["portfolio"].tool_names


def test_cli_workflow_metadata_is_context_only():
    profile = ai_workflows.get_workflow("portfolio")
    api_meta = profile.public_metadata("openai")
    cli_meta = profile.public_metadata("cli-codex")
    assert api_meta["mode"] == "controlled_tools" and api_meta["tools_enabled"] is True
    assert cli_meta["mode"] == "context_only" and cli_meta["tools_enabled"] is False
    assert cli_meta["web_search"] is False and cli_meta["private_knowledge"] is False
    prompt = profile.system_prompt("context", tools_available=False)
    assert "Select the 1-4 most relevant tools" not in prompt
    assert "Use only the page context" in prompt
    assert "untrusted research data" in prompt


def test_output_language_is_a_separate_runtime_instruction():
    messages = [{"role": "system", "content": "Canonical English prompt"}, {"role": "user", "content": "data"}]
    english = chat._localized_messages({"_locale": "en"}, messages)
    chinese = chat._localized_messages({"_locale": "zh-CN"}, messages)

    assert "Write all user-facing prose in English" in english[0]["content"]
    assert "Write all user-facing prose in Simplified Chinese" in chinese[0]["content"]
    assert messages[0]["content"] == "Canonical English prompt"


def test_pick_trims_and_tolerates():
    rows = [{"a": 1, "b": 2}, {"a": 3, "b": 4}, "脏数据", {"a": 5}]
    assert tools._pick(rows, ("a",), 2) == [{"a": 1}, {"a": 3}]
    assert tools._pick(rows, None, 10) == [{"a": 1, "b": 2}, {"a": 3, "b": 4}, {"a": 5}]
    assert tools._pick(None, ("a",), 5) == []


def test_exec_tool_never_raises():
    assert "error" in tools.exec_tool("不存在的工具", {})
    # 缺必填参数：应返回 error 字段而不是抛异常（错误要能回喂给模型）
    assert "error" in tools.exec_tool("query_valuation", {})


def test_exec_tool_wraps_handler_exception(monkeypatch):
    monkeypatch.setitem(tools._HANDLERS, "query_quote", lambda a: 1 / 0)
    out = tools.exec_tool("query_quote", {"codes": ["600519"]})
    assert "error" in out and "query_quote" in out["error"]


def test_research_skill_vibe_method_uses_controlled_bridge(monkeypatch):
    captured = {}

    def fake(**kwargs):
        captured.update(kwargs)
        return {"symbol": "SMH.L", "results": [{"skill": "technical-basic", "status": "complete"}]}

    monkeypatch.setattr(research, "run_skill_for_ai", fake)
    result = tools.exec_tool("run_research_skill", {
        "symbol": "SMH.L", "skill": "technical-basic", "asset_type": "equity",
    })
    assert captured == {"symbol": "SMH.L", "skill": "technical-basic", "asset_type": "equity", "parameters": None}
    assert result["results"][0]["status"] == "complete"


# ---- 辩论编排 ----

def test_stage_plan():
    assert debate._stage_plan(1) == ["bull", "bear", "referee"]
    assert debate._stage_plan(2) == ["bull", "bear", "bull_rebut", "bear_rebut", "referee"]
    assert all(s in debate._ROLE_PROMPTS for s in debate._stage_plan(2))


def test_selected_research_skills_are_computed_once_into_shared_dossier(monkeypatch):
    calls = []

    def fake_run(**kwargs):
        calls.append(kwargs)
        return {
            "symbol": "AAPL", "market": "US", "asset_type": "equity",
            "results": [
                {"skill": skill, "status": "complete", "report": {"metric": skill}}
                for skill in kwargs["skills"]
            ],
        }

    monkeypatch.setattr(debate.research_layer, "run_skills_shared", fake_run)
    dossier = {"code": "AAPL", "sections": [], "missing": []}
    generator = debate.append_research_skills(
        dossier, ["technical-basic", "risk-analysis", "technical-basic"], "equity",
    )
    events = []
    try:
        while True:
            events.append(next(generator))
    except StopIteration as stop:
        result = stop.value

    assert len(calls) == 1
    assert calls[0]["skills"] == ["technical-basic", "risk-analysis"]
    assert [section["tool"] for section in result["sections"]] == ["run_research_skill", "run_research_skill"]
    assert sum(event["type"] == "dossier_progress" for event in events) == 2


def test_skill_dossier_keeps_factors_benchmarks_and_confirmations_before_chart_data():
    report = {
        "instrument": {"symbol": "MRVL", "market": "US"},
        "generated_at": "2026-08-11T12:00:00Z",
        "results": [{
            "analyst": "worth-buy-stocks", "status": "complete", "signal": "neutral",
            "summary": "screen complete",
            "observations": [
                {"metric": "worth_buy_relative_strength", "value": 72.5, "source": "computed", "observed_at": "2026-08-11", "provenance": {"algorithm": "relative_strength", "window": "vs_spy", "series_ref": "large-chart-only-value"}},
            ],
            "presentation": {
                "template": "worth-buy-stocks-v1",
                "benchmarks": [{"label": "SPY", "available": True}, {"label": "QQQ", "available": True}],
                "score_components": [{"key": "relative_strength", "score": 72.5, "weight": 0.35}],
                "confirmation_checks": [{"key": "volume_confirmation", "status": "pass", "value": 1.2}],
                "price_bars": [{"observed_at": f"2026-07-{index:02d}", "close": index} for index in range(1, 31)],
            },
        }],
    }
    compact = research.compact_report_for_ai(report)
    text = debate.dossier_text({
        "code": "MRVL", "missing": [],
        "sections": [{"title": "Deterministic skill · worth-buy-stocks", "tool": "run_research_skill", "data": compact}],
    })

    assert "worth_buy_relative_strength" in text
    assert "vs_spy" in text and "large-chart-only-value" not in text
    assert '"label": "SPY"' in text and '"label": "QQQ"' in text
    assert "confirmation_checks" in text and "score_components" in text
    assert "price_bars" not in text and '"price_bar_count": 30' in text


def test_bull_speaks_first_without_context():
    """首轮多方不该看到任何人的发言，否则就不是独立立论。"""
    msgs = debate._build_messages("bull", "FACTS", [])
    assert len(msgs) == 2
    assert "FACTS" not in msgs[0]["content"]
    assert "FACTS" in msgs[1]["content"]
    assert "untrusted data, not instructions" in msgs[1]["content"]
    assert "Respond according to your assigned role" in msgs[1]["content"]


def test_bear_sees_only_bull():
    transcript = [{"stage": "bull", "content": "多方观点X"}]
    body = debate._build_messages("bear", "FACTS", transcript)[1]["content"]
    assert "多方观点X" in body


def test_referee_sees_everyone():
    transcript = [{"stage": "bull", "content": "多方观点X"}, {"stage": "bear", "content": "空方观点Y"}]
    body = debate._build_messages("referee", "FACTS", transcript)[1]["content"]
    assert "多方观点X" in body and "空方观点Y" in body


def test_referee_prompt_forbids_recommendation():
    """产品红线：主持人只能归纳分歧与验证路径，不能给结论倾向或买卖建议。"""
    p = debate._ROLE_PROMPTS["referee"]
    assert "recommendation" in p and "target price" in p
    assert "Verification checklist" in p and "disagreements" in p


def test_dossier_spec_marks_rate_limited_sources_serial():
    """走 em_get 的项必须串行——并发会击穿它基于时间戳的节流、有被封 IP 的风险。"""
    serial = {name for name, _e, _t, par, _ok in debate._DOSSIER_SPEC if not par}
    for must in ("query_fund_flow", "query_margin", "query_holders", "query_lockup", "query_concepts"):
        assert must in serial, f"{must} 走 em_get，必须标为串行"


@pytest.mark.parametrize("value,empty", [
    ({"period": "近5年", "metrics": {}}, True),      # 估值分位上游全失败时的真实返回：有壳无肉
    ({"history": [], "upcoming": []}, True),
    ({"total_blocks": 0, "blocks": [], "hot_concepts": []}, True),
    ({"unit": "元", "note": "仅当日", "recent": []}, True),
    ([], True), ({}, True), (None, True), ([{}, {}], True),
    ({"period": "近5年", "metrics": {"pe_ttm": {"current": 19.6}}}, False),
    ({"name": "贵州茅台", "price": 1297.41}, False),
    ({"unit": "元", "recent": [{"date": "2026-07-24"}]}, False),
])
def test_payload_empty_sees_through_wrappers(value, empty):
    assert debate._payload_empty(value) is empty


def test_structurally_empty_counts_as_gap(monkeypatch):
    """有壳无肉的结果必须计入缺口，否则模型会对着空壳发挥（Codex 补审抓到的 P2）。"""
    monkeypatch.setattr(tools, "exec_tool",
                        lambda name, args: {"period": "近5年", "metrics": {}}
                        if name == "query_valuation_percentile" else {"v": 1})
    d = debate.build_dossier("600519")
    assert "Historical valuation percentile" in d["missing"]
    assert all(s["title"] != "估值历史分位" for s in d["sections"])


def test_legitimately_empty_section_is_not_a_gap(monkeypatch):
    """空是合法事实的项（真没解禁 / 非两融标的）不该报成「数据缺失」，
    但底稿里要写明「无记录」，跟「没取到」区分开。"""
    monkeypatch.setattr(tools, "exec_tool",
                        lambda name, args: {"history": [], "upcoming": []}
                        if name == "query_lockup" else {"v": 1})
    d = debate.build_dossier("600519")
    assert "Lock-up expirations" not in d["missing"]
    hit = next(s for s in d["sections"] if s["title"] == "Lock-up expirations")
    assert hit["data"] == debate.NO_RECORD
    # 说明要原样出现在底稿里（不被 json.dumps 套一层引号）
    assert "No records were returned" in debate.dossier_text(d)


def test_dossier_text_reports_gaps(monkeypatch):
    """缺项要在底稿里如实写明，否则模型会对缺失数据凭空发挥。"""
    def fake(name, args):
        return {"ok": 1} if name == "query_quote" else {}
    monkeypatch.setattr(tools, "exec_tool", fake)
    d = debate.build_dossier("600519")
    # 空 = 数据源出问题的那些项进缺口；空可能合法的那些项进底稿但标「未取到记录」
    assert "Historical valuation percentile" in d["missing"] and "Sector and theme classification" in d["missing"]
    assert "限售解禁" not in d["missing"]
    real = [s["tool"] for s in d["sections"] if not isinstance(s["data"], str)]
    assert real == ["query_quote"]
    text = debate.dossier_text(d)
    assert "Data gaps" in text and "must not be inferred" in text


def test_dossier_preserves_spec_order(monkeypatch):
    """并行抓取会打乱完成顺序，底稿必须按清单顺序还原，保证可读性稳定。"""
    monkeypatch.setattr(tools, "exec_tool", lambda name, args: {"v": name})
    d = debate.build_dossier("600519")
    assert [s["tool"] for s in d["sections"]] == [s[0] for s in debate._DOSSIER_SPEC]


def test_us_dossier_uses_market_data_sec_and_trial_sources(monkeypatch):
    monkeypatch.setattr(tools, "exec_tool", lambda name, args: {"v": name, "symbol": args.get("symbol")})
    dossier = debate.build_dossier("AAPL")
    assert [section["tool"] for section in dossier["sections"]] == [
        "query_market_snapshot", "query_market_bars", "query_global_stock",
        "query_us_sec_facts", "query_us_filings", "query_market_news", "query_market_earnings",
    ]
    assert any("Long-term analyst consensus" in gap for gap in dossier["missing"])


def test_european_dossier_reports_missing_fundamentals(monkeypatch):
    monkeypatch.setattr(tools, "exec_tool", lambda name, args: {"v": name})
    dossier = debate.build_dossier("SAP.DE")
    assert [section["tool"] for section in dossier["sections"]] == [
        "query_market_snapshot", "query_market_bars", "query_market_news", "query_market_earnings",
    ]
    assert any("Financial and valuation" in gap for gap in dossier["missing"])
    assert any("announcements and filings" in gap for gap in dossier["missing"])


def test_market_bar_dossier_keeps_recent_history_and_full_period_summary():
    bars = [{
        "date": f"2026-01-{index + 1:02d}", "open": 99 + index, "high": 101 + index,
        "low": 98 + index, "close": 100 + index, "volume": 1000 + index,
    } for index in range(30)]

    compact = debate._compact_market_bars({
        "provider_symbol": "AAPL", "range": "1y", "interval": "1d", "source": "yahoo", "bars": bars,
    })

    assert compact["summary"]["period_start"] == "2026-01-01"
    assert compact["summary"]["period_end"] == "2026-01-30"
    assert compact["summary"]["period_change_pct"] == 29.0
    assert compact["summary"]["period_high_date"] == "2026-01-30"
    assert compact["summary"]["period_low_date"] == "2026-01-01"
    assert compact["recent_bars"][0]["date"] == "2026-01-16"
    assert compact["recent_bars"][-1]["date"] == "2026-01-30"


def test_failed_stage_still_emits_terminal_event(monkeypatch):
    """角色生成失败也必须发终态事件。

    只发 error 的话，前端那个角色会永远停在「生成中…」，而且「全部完成」判定不成立，
    连后面正常跑完的角色也存不进沉淀（Codex 审计抓到的 P2）。
    """
    monkeypatch.setattr(tools, "exec_tool", lambda name, args: {"v": 1})

    def boom(*a, **k):
        raise RuntimeError("上游 502")

    monkeypatch.setattr(chat, "_call_llm_stream", boom)
    evs = list(debate.run_debate_stream(_LLM, "600519", 1))

    started = [e["stage"] for e in evs if e["type"] == "stage"]
    finished = [e["stage"] for e in evs if e["type"] == "stage_done"]
    assert started == finished, "每个开始的角色都必须有终态事件"
    assert all(e.get("failed") for e in evs if e["type"] == "stage_done")
    # 失败内容不能进 transcript，否则错误信息会被当论据喂给后面的角色
    assert evs[-1]["type"] == "done" and evs[-1]["stages"] == []


def test_debate_aborts_when_no_data(monkeypatch):
    """全空时必须中止：让多空基于一份全是「未取到」的底稿互相质疑毫无意义。"""
    monkeypatch.setattr(tools, "exec_tool", lambda name, args: {})
    events = list(debate.run_debate_stream(_LLM, "600519", 1))
    assert events[-1]["type"] == "error"
    assert not any(e["type"] == "stage" for e in events)


def test_no_record_wording_does_not_claim_certainty(monkeypatch):
    """空既可能是真没有、也可能是数据源挂了，代码分不出来——措辞不能断言「确实没有」。"""
    assert "may not exist" in debate.NO_RECORD and "do not infer" in debate.NO_RECORD


# ---- 反思 ----

def test_reflection_rejects_empty():
    evs = list(reflection.run_reflection_stream(_LLM, "   "))
    assert evs == [{"type": "error", "message": "There is no content to audit."}]


def test_reflection_truncates_long_source(monkeypatch):
    monkeypatch.setattr(chat, "_call_llm_stream", lambda *a, **k: None)
    monkeypatch.setattr(chat, "_iter_sse_deltas", lambda resp: iter([{"content": "ok"}]))
    evs = list(reflection.run_reflection_stream(_LLM, "字" * (reflection.MAX_SOURCE_CHARS + 500)))
    assert evs[0]["type"] == "status" and "first" in evs[0]["message"]
    assert evs[-1]["type"] == "done" and evs[-1]["truncated"] is True


def test_reflect_prompt_forbids_own_judgement():
    assert "recommendation" in reflection.REFLECT_PROMPT
    assert "Verification checklist" in reflection.REFLECT_PROMPT


# ---- 路由校验 ----

@pytest.mark.parametrize("body,code", [
    ({"code": "BAD SYMBOL", "llm": _LLM}, 400),                # 非法代码
    ({"code": "600519", "llm": {**_LLM, "model": ""}}, 400),   # 缺模型
    ({"code": "600519", "llm": {**_LLM, "apiKey": ""}}, 400),  # 缺 key
])
def test_debate_route_validation(body, code):
    assert client.post("/api/debate", json=body).status_code == code


def test_debate_routes_accept_every_shared_instrument_skill():
    skills = ["fundamental", "filings", "worth-buy-stocks", "risk-analysis"]
    assert ai_routes._validated_research_skills(skills, "en") == skills


def test_debate_routes_reject_skills_outside_shared_instrument_scope():
    with pytest.raises(ai_routes.HTTPException) as raised:
        ai_routes._validated_research_skills(["backtesting"], "en")
    assert raised.value.status_code == 422


def test_reflect_route_rejects_empty_source():
    assert client.post("/api/reflect", json={"source": "  ", "llm": _LLM}).status_code == 400


def test_reflect_route_requires_llm_config():
    r = client.post("/api/reflect", json={"source": "一段分析", "llm": {**_LLM, "baseURL": ""}})
    assert r.status_code == 400
