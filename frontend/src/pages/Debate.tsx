import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Swords, Play, Square, Save, CheckCircle2, Circle, AlertTriangle, Users, BriefcaseBusiness, ListChecks } from "lucide-react";
import { SafeMarkdown } from "@/components/ui/SafeMarkdown";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { ContextTray, type ContextEntry } from "@/components/research/ContextTray";
import { debateStream, researchTeamStream, type DebateStage, type ResearchTeamStage } from "@/lib/agents";
import { addNote } from "@/lib/notes";
import { ApiError, api, type IbkrInstrument, type PositionPreferences, type RealPositionSnapshot, type ResearchSkill } from "@/lib/api";
import { normalizeCryptoSymbol, normalizeStockSymbol } from "@/lib/market-symbols";
import { portfolioNumber, portfolioRatioPercent, portfolioSigned } from "@/lib/portfolio-format";
import { useLocale, type Locale } from "@/lib/i18n";

type Mode = "debate" | "team";
type Stage = DebateStage | ResearchTeamStage;
interface StageBox { stage: Stage; label: string; content: string; done: boolean }

const STAGE_TONE: Record<Stage, string> = {
  bull: "border-primary/50 bg-primary/[0.06]", bull_rebut: "border-primary/30 bg-primary/[0.03]",
  bear: "border-sky-500/40 bg-sky-500/[0.06]", bear_rebut: "border-sky-500/25 bg-sky-500/[0.03]",
  referee: "border-border bg-background/40", fundamentals: "border-violet-500/35 bg-violet-500/[0.05]",
  market: "border-cyan-500/35 bg-cyan-500/[0.05]", events: "border-amber-500/35 bg-amber-500/[0.05]",
  lead: "border-primary/40 bg-primary/[0.05]",
};
const STAGE_LABELS: Record<Stage, { en: string; zh: string }> = {
  bull: { en: "Bull researcher", zh: "多方研究员" }, bear: { en: "Bear researcher", zh: "空方研究员" },
  bull_rebut: { en: "Bull rebuttal", zh: "多方反驳" }, bear_rebut: { en: "Bear rebuttal", zh: "空方反驳" },
  referee: { en: "Neutral moderator · disagreements and verification", zh: "中立主持 · 分歧与验证清单" },
  fundamentals: { en: "Fundamentals researcher", zh: "基本面研究员" }, market: { en: "Market and technical researcher", zh: "市场与技术研究员" },
  events: { en: "Events and risk researcher", zh: "事件与风险研究员" }, lead: { en: "Research lead · synthesis and verification", zh: "研究负责人 · 综合与验证清单" },
};
const DOSSIER_TITLE_ZH: Record<string, string> = {
  "Live quote": "实时行情", "Valuation and consensus": "估值与一致预期", "Historical valuation percentile": "估值历史分位",
  "Latest financial metrics": "最新财报关键指标", "60-day price history": "近 60 日价格走势", "Fund flows": "资金流向",
  "Margin financing and securities lending": "融资融券", "Shareholder count": "股东户数", "Recent announcements": "近期公告",
  "Lock-up expirations": "限售解禁", "Sector and theme classification": "板块与概念归属", "Recent research reports": "近期研报",
  "Recent news": "近期新闻", "Yahoo market snapshot": "Yahoo 行情快照", "One-year daily price and volume": "近一年日线价格与成交量",
  "Coinbase market snapshot": "Coinbase 行情快照", "One-year UTC daily price and volume": "近一年 UTC 日线价格与成交量",
  "Market cap, supply and market-wide context": "市值、供应量与全市场上下文",
  "Key financial metrics (available international source)": "关键财务指标（现有海外源）",
  "Recent company news (Finnhub trial)": "近期公司新闻（Finnhub trial）",
  "Historical earnings and estimate surprises (Finnhub trial)": "历史盈利与预期差（Finnhub trial）",
  "Latest SEC XBRL company facts": "SEC 最新 XBRL 公司事实", "Recent SEC filings": "SEC 近期监管文件",
  "Traditional company fundamentals and valuation do not apply": "传统公司基本面与估值不适用",
  "Filings and earnings do not apply": "公司文件与盈利数据不适用",
  "On-chain flows and token unlock data are not integrated": "链上资金流与代币解锁数据尚未接入",
  "Long-term analyst consensus (source not integrated)": "长期分析师一致预期（数据源尚未接入）",
  "Financial and valuation metrics (European source not integrated)": "财务与估值指标（欧洲数据源尚未接入）",
  "Company announcements and filings (unified European source not integrated)": "公司公告与文件（欧洲统一数据源尚未接入）",
};
const dossierTitle = (title: string, locale: Locale) => {
  if (locale === "en") return title;
  if (title.startsWith("Deterministic skill · ")) return title.replace("Deterministic skill", "确定性技能");
  return DOSSIER_TITLE_ZH[title] || title;
};

export function Debate() {
  const { locale, tr } = useLocale();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "team" ? "team" : "debate");
  const [assetType, setAssetType] = useState<"equity" | "crypto">(params.get("asset_type") === "crypto" ? "crypto" : "equity");
  const [code, setCode] = useState(params.get("code")?.toUpperCase() || "");
  const [rounds, setRounds] = useState(1);
  const [contexts, setContexts] = useState<ContextEntry[]>([]);
  const [usePosition, setUsePosition] = useState(params.get("position_context") === "1");
  const [includePreferences, setIncludePreferences] = useState(false);
  const [positions, setPositions] = useState<IbkrInstrument[]>([]);
  const [snapshot, setSnapshot] = useState<RealPositionSnapshot | null>(null);
  const [preferences, setPreferences] = useState<PositionPreferences | null>(null);
  const [selectedPosition, setSelectedPosition] = useState(params.get("position") || "");
  const [positionError, setPositionError] = useState("");
  const [skillCatalog, setSkillCatalog] = useState<ResearchSkill[]>([]);
  const [selectedResearchSkills, setSelectedResearchSkills] = useState<string[]>([]);
  const [defaultResearchSkills, setDefaultResearchSkills] = useState<string[]>([]);
  const [skillCatalogStatus, setSkillCatalogStatus] = useState("");
  const [skillDefaultStatus, setSkillDefaultStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<{ title: string; ok: boolean }[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [stages, setStages] = useState<StageBox[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [completed, setCompleted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.researchSkills().then(async (payload) => {
      if (cancelled) return;
      const supported = payload.skills.filter((skill) => (skill.supported_asset_types || ["equity"]).includes(assetType));
      setSkillCatalog(supported);
      setSkillCatalogStatus(payload.configured ? "" : tr("TradeAgent skills are not configured", "TradeAgent 技能尚未配置"));
      try {
        const defaults = await api.researchSkillDefaults();
        if (cancelled) return;
        const savedDefaults = defaults[assetType].filter((name) => supported.some((skill) => skill.name === name));
        setDefaultResearchSkills(savedDefaults);
        setSelectedResearchSkills(savedDefaults);
        setSkillDefaultStatus("");
      } catch (reason) {
        if (cancelled) return;
        setDefaultResearchSkills([]);
        setSelectedResearchSkills([]);
        setSkillDefaultStatus(reason instanceof ApiError && reason.status === 404
          ? tr("Restart the Vibe backend to enable saved defaults", "请重启 Vibe 后端以启用默认技能保存")
          : tr("Defaults are temporarily unavailable; skills can still be selected for this run", "默认技能暂不可用；本次仍可手动选择技能"));
      }
    }).catch((reason) => {
      if (cancelled) return;
      setSkillCatalog([]);
      setSelectedResearchSkills([]);
      setDefaultResearchSkills([]);
      setSkillCatalogStatus(reason instanceof ApiError ? reason.message : tr("Unable to load TradeAgent skills", "无法加载 TradeAgent 技能"));
    });
    return () => { cancelled = true; };
  }, [assetType]);

  useEffect(() => {
    if (!usePosition || mode !== "team") return;
    Promise.all([api.positionInstruments("open"), api.realPositions(), api.positionPreferences()]).then(([items, current, prefs]) => {
      const eligible = items.filter((item) => !["CASH", "FX"].includes(item.asset_class) && item.provider_symbol);
      setPositions(eligible); setSnapshot(current); setPreferences(prefs); setPositionError("");
      const requested = selectedPosition && eligible.some((item) => item.instrument_key === selectedPosition) ? selectedPosition : eligible[0]?.instrument_key || "";
      setSelectedPosition(requested);
      const selected = eligible.find((item) => item.instrument_key === requested);
      if (selected?.provider_symbol) { setCode(selected.provider_symbol); setAssetType("equity"); }
    }).catch((reason) => setPositionError(reason instanceof ApiError ? reason.message : tr("Unable to load open positions", "无法加载开放持仓")));
  }, [usePosition, mode]); // selectedPosition is intentionally initialized from the URL once

  const selectedInstrument = positions.find((item) => item.instrument_key === selectedPosition);
  const selectedSnapshotRow = useMemo(() => selectedInstrument && snapshot?.positions.find((row) =>
    row.account_ref === selectedInstrument.account_ref && row.symbol === selectedInstrument.symbol && row.currency === selectedInstrument.currency && (row.venue || "") === (selectedInstrument.venue || ""),
  ), [selectedInstrument, snapshot]);
  const selectedWeight = selectedSnapshotRow?.reporting_market_value != null && snapshot?.summary.nav
    ? Math.abs(selectedSnapshotRow.reporting_market_value) / Math.abs(snapshot.summary.nav) : null;

  const reset = () => { setStatus(""); setProgress([]); setMissing([]); setStages([]); setError(""); setSaved(false); setCompleted(false); };
  const switchMode = (next: Mode) => { if (running) return; setMode(next); reset(); if (next === "debate") { setUsePosition(false); setIncludePreferences(false); } };

  async function start() {
    const c = assetType === "crypto" ? normalizeCryptoSymbol(code) : normalizeStockSymbol(code);
    if (!c) { setError(assetType === "crypto" ? tr("Enter a crypto symbol such as BTC, ETH, or SOL", "请输入 BTC、ETH、SOL 等加密货币代码") : tr("Enter a China A-share, US, or exchange-qualified European symbol", "请输入 A 股、美股或带交易所后缀的欧洲股票代码")); return; }
    if (mode === "team" && usePosition && !selectedPosition) { setError(tr("Choose an open position", "请选择一个开放持仓")); return; }
    const cleanContexts = contexts.filter((item) => item.content.trim()).map(({ name, content }) => ({ name: name.trim() || tr("Untitled material", "未命名材料"), content: content.trim() }));
    if (cleanContexts.reduce((sum, item) => sum + item.content.length, 0) > 50_000) { setError(tr("Supplemental materials exceed the 50,000-character limit", "补充材料合计超过 50,000 字符上限")); return; }
    setCode(c); reset(); setRunning(true);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    let streamDone = false;
    let streamHadError = false;
    const handlers = {
      onStatus: setStatus,
      onDossierProgress: (title: string, ok: boolean, loaded: number, total: number) => { setStatus(tr(`Retrieving objective evidence… ${loaded}/${total}`, `正在拉取客观事实底稿… ${loaded}/${total}`)); setProgress((current) => [...current, { title: dossierTitle(title, locale), ok }]); },
      onDossierReady: (_sections: {title: string; tool: string}[], miss: string[]) => { setMissing(miss.map((item) => dossierTitle(item, locale))); setStatus(mode === "team" ? tr("Dossier ready; research team started", "底稿就绪，研究团队开始工作") : tr("Dossier ready; debate started", "底稿就绪，辩论开始")); },
      onStageStart: (stage: Stage, _label: string) => setStages((current) => [...current, { stage, label: tr(STAGE_LABELS[stage].en, STAGE_LABELS[stage].zh), content: "", done: false }]),
      onDelta: (stage: Stage, text: string) => setStages((current) => current.map((item) => item.stage === stage && !item.done ? { ...item, content: item.content + text } : item)),
      onStageDone: (stage: Stage, _label: string, content: string) => setStages((current) => current.map((item) => item.stage === stage && !item.done ? { ...item, content, done: true } : item)),
      onError: (message: string, stage?: Stage) => { streamHadError = true; setError(stage ? `${stage}：${message}` : message); },
      onDone: () => { streamDone = true; setCompleted(true); },
    };
    try {
      if (mode === "team") await researchTeamStream(c, handlers, ctrl.signal, assetType, cleanContexts, usePosition ? selectedPosition : undefined, usePosition && includePreferences, selectedResearchSkills);
      else await debateStream(c, rounds, handlers, ctrl.signal, assetType, cleanContexts, selectedResearchSkills);
      setStatus(streamDone
        ? `${mode === "team" ? tr("Research team", "研究团队") : tr("Debate", "辩论")} ${streamHadError ? tr("partially completed", "部分完成") : tr("completed", "完成")}`
        : `${mode === "team" ? tr("Research team", "研究团队") : tr("Debate", "辩论")} ${tr("did not complete", "未完整结束")}`);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") setStatus(tr("Stopped", "已中止"));
      else setError(reason instanceof ApiError ? reason.message : String(reason));
    } finally { setRunning(false); abortRef.current = null; }
  }

  const stop = () => { abortRef.current?.abort(); setRunning(false); };
  const saveSkillDefaults = async (skills: string[]) => {
    setSkillDefaultStatus(tr("Saving defaults…", "正在保存默认技能…"));
    try {
      const saved = await api.saveResearchSkillDefaults(assetType, skills);
      const next = saved[assetType].filter((name) => skillCatalog.some((skill) => skill.name === name));
      setDefaultResearchSkills(next);
      setSkillDefaultStatus(skills.length ? tr("Defaults saved", "默认技能已保存") : tr("Defaults cleared", "默认技能已清除"));
    } catch (reason) {
      setSkillDefaultStatus(reason instanceof ApiError ? reason.message : tr("Unable to save defaults", "无法保存默认技能"));
    }
  };
  const finished = completed && stages.length > 0 && stages.every((item) => item.done);
  const save = () => {
    const body = [contexts.length ? `${tr("Supplemental materials: ", "补充材料：")}${contexts.map((item) => item.name).join(", ")}` : "", ...stages.map((item) => `## ${item.label}\n\n${item.content}`)].filter(Boolean).join("\n\n---\n\n");
    const kind = mode === "team" ? tr("Research team", "研究团队") : tr("Bull / Bear debate", "多空辩论");
    addNote(kind, `${kind} · ${code.trim()}`, body); setSaved(true);
  };

  return <div>
    <PageHeader title={tr("Multi-perspective Research", "多视角研究")} subtitle={tr("Use one objective dossier for a bull/bear debate or specialist research team. Supplemental materials stay separate and no trading instructions are generated.", "同一份客观数据，可选择多空辩论或专项研究团队。补充材料始终与接口事实分开标注，不生成交易指令。")} />
    <GlassCard>
      <div className="mb-4 flex w-fit gap-1 rounded-lg border border-border/60 bg-muted/20 p-1">
        <button onClick={() => switchMode("debate")} className={`inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm ${mode === "debate" ? "bg-background text-primary shadow-sm" : "text-muted-foreground"}`}><Swords className="h-4 w-4" />{tr("Bull / Bear debate", "多空辩论")}</button>
        <button onClick={() => switchMode("team")} className={`inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm ${mode === "team" ? "bg-background text-primary shadow-sm" : "text-muted-foreground"}`}><Users className="h-4 w-4" />{tr("Research team", "研究团队")}</button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="mb-1 block text-xs text-muted-foreground">{tr("Asset type", "资产类型")}</label><select value={assetType} onChange={(event) => { setAssetType(event.target.value as "equity" | "crypto"); setCode(""); reset(); }} disabled={running || usePosition} className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm"><option value="equity">{tr("Equity", "股票")}</option><option value="crypto">{tr("Crypto", "加密货币")}</option></select></div>
        <div><label className="mb-1 block text-xs text-muted-foreground">{assetType === "crypto" ? tr("Crypto symbol", "加密货币代码") : tr("Stock symbol", "股票代码")}</label><input value={code} onChange={(event) => setCode(event.target.value.replace(/[^a-zA-Z0-9.-]/g, "").toUpperCase().slice(0, 24))} onKeyDown={(event) => { if (event.key === "Enter" && !running) start(); }} placeholder={assetType === "crypto" ? "BTC / ETH / SOL" : "600519 / AAPL / VOD.L"} disabled={running || usePosition} className="w-56 rounded-lg border border-border/60 bg-background/60 px-3 py-2 font-mono text-sm outline-none focus:border-primary/60" /></div>
        {mode === "debate" && <div><label className="mb-1 block text-xs text-muted-foreground">{tr("Debate depth", "辩论深度")}</label><select value={rounds} onChange={(event) => setRounds(Number(event.target.value))} disabled={running} className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm"><option value={1}>{tr("One round · Opening cases", "一轮 · 各自陈述")}</option><option value={2}>{tr("Two rounds · Cross-rebuttals", "两轮 · 加交叉反驳")}</option></select></div>}
        {running ? <button onClick={stop} className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-4 py-2 text-sm hover:text-destructive"><Square className="h-4 w-4" />{tr("Stop", "中止")}</button> : <button onClick={start} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/90 px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary"><Play className="h-4 w-4" />{mode === "team" ? tr("Start research team", "启动研究团队") : tr("Start debate", "开始辩论")}</button>}
        {finished && !running && <button onClick={save} disabled={saved} className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"><Save className="h-4 w-4" />{saved ? tr("Saved to notes", "已存入沉淀") : tr("Save to notes", "存入沉淀")}</button>}
      </div>
      <div className="mt-4 rounded-xl border border-border/50 bg-background/20 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h3 className="text-sm font-semibold">{tr("Reusable deterministic evidence", "可复用的确定性分析")}</h3><p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{tr("Choose approved TradeAgent skills to compute once. Their identical read-only results are added to the shared dossier for every debate role and the research team.", "选择获准的 TradeAgent 技能并只计算一次；相同的只读结果会加入共享底稿，供所有辩论角色和研究团队使用。")}</p></div>
          {selectedResearchSkills.length > 0 && <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] text-primary">{selectedResearchSkills.length} {tr("selected", "项已选")}</span>}
        </div>
        {skillCatalog.length > 0 ? <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{skillCatalog.map((skill) => {
          const checked = selectedResearchSkills.includes(skill.name);
          return <label key={skill.name} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs transition-colors ${checked ? "border-primary/40 bg-primary/[0.06]" : "border-border/50"}`}><input type="checkbox" className="mt-0.5" checked={checked} disabled={running} onChange={() => setSelectedResearchSkills((current) => checked ? current.filter((name) => name !== skill.name) : [...current, skill.name])} /><span><span className="flex flex-wrap items-center gap-1"><strong className="font-medium text-foreground">{skill.name}</strong>{defaultResearchSkills.includes(skill.name) && <span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">{tr("default", "默认")}</span>}</span><span className="mt-0.5 block line-clamp-2 text-[11px] text-muted-foreground">{skill.description}</span></span></label>;
        })}</div> : <p className="mt-2 text-xs text-muted-foreground">{skillCatalogStatus || tr("No approved skills support this asset type.", "没有获准技能支持该资产类型。")}</p>}
        {skillCatalog.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" disabled={running} onClick={() => saveSkillDefaults(selectedResearchSkills)} className="rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] hover:border-primary/40 disabled:opacity-50">{tr("Save selection as defaults", "将当前选择设为默认")}</button>{defaultResearchSkills.length > 0 && <button type="button" disabled={running} onClick={() => saveSkillDefaults([])} className="rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50">{tr("Clear defaults", "清除默认")}</button>}{skillDefaultStatus && <span className="text-[10px] text-muted-foreground">{skillDefaultStatus}</span>}</div>}
        <p className="mt-2 text-[10px] text-muted-foreground/70">{tr("Defaults are preselected, never forced. Uncheck them for one run or add other skills; unselected skills are not run. The AI cannot alter calculations or execute orders.", "默认技能只会预先勾选，不会被强制运行；你可以为本次分析取消或增加技能，未选择的技能不会运行。AI 无法修改计算或执行订单。")}</p>
      </div>
      {mode === "team" && <div className="mt-4 rounded-xl border border-border/50 bg-background/20 p-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={usePosition} onChange={(event) => { setUsePosition(event.target.checked); if (!event.target.checked) setIncludePreferences(false); setPositionError(""); }} disabled={running || assetType === "crypto"} /> <BriefcaseBusiness className="h-4 w-4 text-primary" />{tr("Use one open-position context", "使用单个开放持仓上下文")}</label>
        {usePosition && <div className="mt-3"><select value={selectedPosition} onChange={(event) => { const key = event.target.value; setSelectedPosition(key); const selected = positions.find((item) => item.instrument_key === key); if (selected?.provider_symbol) { setCode(selected.provider_symbol); setAssetType("equity"); } }} disabled={running} className="w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm"><option value="">{tr("Choose an open position", "选择开放持仓")}</option>{positions.map((item) => <option key={item.instrument_key} value={item.instrument_key}>{item.symbol} · {item.name} · {item.quantity ?? "—"} · {item.venue || item.currency}</option>)}</select>
          <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-border/50 p-2 text-xs"><input type="checkbox" className="mt-0.5" checked={includePreferences} onChange={(event) => setIncludePreferences(event.target.checked)} disabled={running || !preferences?.items.length} /><span><strong className="font-medium text-foreground">{tr("Also include investment goals and risk preferences", "同时包含投资目标与风险偏好")}</strong><span className="mt-0.5 block text-[11px] text-muted-foreground">{preferences?.items.length ? tr("Optional portfolio-wide context; leave off when it is not relevant to this position.", "这是可选的组合层面上下文；若与该持仓无关，请保持关闭。") : tr("No saved preferences are available on the Portfolio page.", "「我的持仓」尚未保存目标或风险偏好。")}</span></span></label>
          {selectedInstrument && <div className="mt-2 rounded-lg bg-muted/20 p-2 text-[11px] leading-relaxed text-muted-foreground"><strong className="text-foreground">{tr("Sending:", "将发送：")}</strong> {selectedInstrument.provider_symbol} · {selectedInstrument.venue || tr("Exchange unavailable", "交易所未提供")} · {selectedInstrument.currency} · {tr("Quantity", "数量")} {portfolioNumber(selectedSnapshotRow?.quantity ?? selectedInstrument.quantity)} · {tr("Cost", "成本")} {portfolioNumber(selectedSnapshotRow?.average_cost ?? selectedInstrument.average_cost)} · {tr("Mark", "标记价")} {portfolioNumber(selectedSnapshotRow?.latest_price)} · {tr("Unrealised P&L", "未实现盈亏")} {portfolioSigned(selectedSnapshotRow?.unrealized_pnl)} · NAV {portfolioNumber(snapshot?.summary.nav)} {snapshot?.summary.reporting_currency || ""} · {tr("NAV weight", "NAV占比")} {portfolioRatioPercent(selectedWeight)} · {tr("Snapshot", "快照")} {snapshot?.report_date || "—"}. {tr("No other positions are sent.", "不会发送其他持仓。")}<div className="mt-1"><strong className="text-foreground">{tr("Investment goals and risk preferences:", "投资目标与风险偏好：")}</strong>{includePreferences ? (preferences?.items.length ? <ul className="ml-4 list-disc">{preferences.items.map((item) => <li key={item}>{item}</li>)}</ul> : tr(" Not set", " 未设置")) : tr(" Not included", " 未包含")}</div></div>}
        </div>}
        {positionError && <p className="mt-2 text-xs text-destructive">{positionError}</p>}
      </div>}
      <div className="mt-4 rounded-xl border border-sky-500/25 bg-sky-500/[0.04] p-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><ListChecks className="h-4 w-4 text-sky-400" />{tr("Before you run: useful context", "开始前：哪些信息最有帮助")}</h3>
        <div className="mt-2 grid gap-3 text-xs leading-relaxed text-muted-foreground md:grid-cols-2">
          <div><p className="font-medium text-foreground">{tr("Vibe fetches automatically", "Vibe 会自动获取")}</p><p className="mt-1">{assetType === "crypto" ? tr("Price/volume history plus available market-cap, supply and market-wide context.", "价格与成交量历史，以及可用的市值、供应量和全市场上下文。") : tr("Price/volume, available financials and valuation, filings/announcements, earnings, news and research reports. Any unavailable source is listed during the run.", "价格与成交量、可用的财务和估值、监管文件/公告、盈利、新闻与研报。运行时仍会列出未取到的数据源。")}</p></div>
          <div><p className="font-medium text-foreground">{tr("Most useful to add", "建议补充")}</p><ul className="mt-1 ml-4 list-disc space-y-0.5"><li>{tr("Your question, thesis, assumptions and intended time horizon", "你的核心问题、投资逻辑、关键假设与关注周期")}</li><li>{tr("Earnings-call transcripts, broker/industry notes or competitor evidence not available publicly", "公开源未覆盖的业绩会纪要、券商/行业笔记或竞品证据")}</li><li>{tr("Position rationale or instrument-specific constraints; portfolio goals only when the separate checkbox is relevant", "该持仓的建仓逻辑或标的特有限制；组合目标仅在相关时单独勾选")}</li></ul></div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/70">{assetType === "crypto" ? tr("Current known gaps: on-chain flows and token-unlock data. Add dated sources if these matter.", "当前已知缺口：链上资金流和代币解锁数据；若相关，请上传带日期和来源的材料。") : tr("European financials/filings and long-term analyst consensus may be incomplete until more sources are configured. Date and name uploaded sources, and never upload API keys, passwords or full account statements.", "在更多数据源接入前，欧洲公司财务/公告和长期一致预期可能不完整。请为材料标注日期与来源，不要上传 API key、密码或完整账户报表。")}</p>
      </div>
      <ContextTray entries={contexts} onChange={setContexts} disabled={running} />
      {!running && !status && <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/70">⏱ {mode === "team" ? tr("Four model calls: three specialists and one neutral lead.", "研究团队共 4 次模型调用：3 位专项研究员 + 1 位中立负责人。") : rounds === 2 ? tr("Approximately five model calls.", "两轮约 5 次模型调用。") : tr("Approximately three model calls.", "一轮约 3 次模型调用。")} {tr("The objective dossier is retrieved once.", "客观底稿只拉取一次。")}</p>}
      {status && <p className="mt-3 text-xs text-muted-foreground">{status}</p>}
      {error && <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>}
      {progress.length > 0 && <div className="mt-4 border-t border-border/40 pt-3"><p className="mb-2 text-[11px] text-muted-foreground">{tr("All roles share one API evidence dossier; supplemental materials are marked separately.", "所有角色共享同一份接口事实底稿；补充材料另行标记。")}</p><div className="flex flex-wrap gap-x-4 gap-y-1.5">{progress.map((item) => <span key={item.title} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">{item.ok ? <CheckCircle2 className="h-3 w-3 text-primary/70" /> : <Circle className="h-3 w-3 text-muted-foreground/40" />}{item.title}</span>)}</div>{missing.length > 0 && <p className="mt-2 text-[11px] text-warning">{tr("Unavailable", "未取到")}：{missing.join(", ")} {tr("(roles must not infer it)", "（角色不得臆测）")}</p>}</div>}
    </GlassCard>
    <div className="mt-4 space-y-4">{stages.map((item) => <div key={item.stage} className={`rounded-xl border p-4 ${STAGE_TONE[item.stage]}`}><div className="mb-2 flex items-center gap-2">{mode === "team" ? <Users className="h-4 w-4 text-muted-foreground" /> : <Swords className="h-4 w-4 text-muted-foreground" />}<span className="text-sm font-semibold">{item.label}</span>{!item.done && <span className="animate-pulse text-[11px] text-muted-foreground">{tr("Generating…", "生成中…")}</span>}</div><div className="prose prose-sm prose-invert max-w-none text-foreground prose-table:text-sm"><SafeMarkdown>{item.content || "…"}</SafeMarkdown></div></div>)}</div>
    {stages.length === 0 && !running && <GlassCard className="mt-4"><div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">{mode === "team" ? <Users className="h-8 w-8 text-muted-foreground/40" /> : <Swords className="h-8 w-8 text-muted-foreground/40" />}{tr("Enter a symbol to begin. ", "输入代码开始。")}{mode === "team" ? tr("Three specialists review fundamentals, market structure and event risk before a lead synthesises disagreements.", "三位专项研究员分别检查基本面、市场结构和事件风险，再由负责人综合分歧。") : tr("Bull and bear researchers challenge each other using the same evidence.", "多方和空方基于同一份事实互相质疑。") }<span className="text-xs">{tr("Produces research evidence and verification steps, never trading instructions.", "产出研究证据与验证清单，不生成交易指令。")}</span></div></GlassCard>}
    <Disclaimer />
  </div>;
}
