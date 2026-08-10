import { useState, useEffect, useCallback } from "react";
import { Plus, ShieldCheck, RefreshCw, Loader2, Trash2, AlertCircle, Save, Target } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api, ApiError, type PortfolioData } from "@/lib/api";
import { cn } from "@/lib/utils";
import { normalizeStockSymbol } from "@/lib/market-symbols";
import { RealPositionPanel } from "@/components/portfolio/RealPositionPanel";
import { PortfolioOverview } from "@/components/portfolio/PortfolioOverview";
import { CryptoPortfolioPanel } from "@/components/portfolio/CryptoPortfolioPanel";
import { investmentProfileContext, portfolioAiInstruction, portfolioAiNumber, portfolioNumber, portfolioValuePercent } from "@/lib/portfolio-format";

const REFRESH_MS = 30 * 60 * 1000; // 每半小时自动刷新
const pnlColor = (v: number | null) => v != null && v > 0 ? "text-success" : v != null && v < 0 ? "text-danger" : "text-muted-foreground";
const fmt = portfolioNumber;
const fmtPx = portfolioNumber;

export function Portfolio() {
  const [section, setSection] = useState<"overview" | "stocks" | "crypto">("overview");
  const [data, setData] = useState<PortfolioData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [code, setCode] = useState("");
  const [shares, setShares] = useState("");
  const [cost, setCost] = useState("");
  const [adding, setAdding] = useState(false);
  // 清仓录入
  const [cCode, setCCode] = useState("");
  const [cDate, setCDate] = useState("");
  const [cPrice, setCPrice] = useState("");
  const [cShares, setCShares] = useState("");
  const [cCost, setCCost] = useState("");
  const [closing, setClosing] = useState(false);
  const [view, setView] = useState<"ibkr" | "manual">("ibkr");
  const [preferences, setPreferences] = useState<string[]>([]);
  const [preferenceDraft, setPreferenceDraft] = useState("");
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [preferenceUpdatedAt, setPreferenceUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      setData(manual ? await api.refreshPortfolio() : await api.portfolio());
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(), REFRESH_MS); // 每半小时自动刷新
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    api.positionPreferences().then((payload) => {
      setPreferences(payload.items);
      setPreferenceDraft(payload.items.map((item) => `- ${item}`).join("\n"));
      setPreferenceUpdatedAt(payload.updated_at);
      setPreferenceError(null);
    }).catch((reason: unknown) => {
      setPreferenceError(reason instanceof ApiError ? reason.message : "投资目标加载失败");
    });
  }, []);

  const savePreferences = async () => {
    const items = preferenceDraft.split("\n").map((item) => item.trim()).filter(Boolean);
    setPreferenceSaving(true); setPreferenceError(null);
    try {
      const saved = await api.savePositionPreferences(items);
      setPreferences(saved.items);
      setPreferenceDraft(saved.items.map((item) => `- ${item}`).join("\n"));
      setPreferenceUpdatedAt(saved.updated_at);
    } catch (reason) {
      setPreferenceError(reason instanceof ApiError ? reason.message : "投资目标保存失败");
    } finally { setPreferenceSaving(false); }
  };

  const add = async () => {
    const symbol = normalizeStockSymbol(code);
    if (!symbol) { setErr("请输入 A 股、美股或带交易所后缀的欧洲股票代码"); return; }
    const s = parseFloat(shares), c = parseFloat(cost);
    if (!(s > 0) || !Number.isFinite(c)) { setErr("数量须大于 0，成本价请填数字（可为负）"); return; }
    setAdding(true); setErr(null);
    try {
      setData(await api.addHolding(symbol, s, c));
      setCode(""); setShares(""); setCost("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "添加失败");
    } finally {
      setAdding(false);
    }
  };

  const remove = async (c: string) => {
    try { setData(await api.removeHolding(c)); } catch { /* ignore */ }
  };

  const addClose = async () => {
    const symbol = normalizeStockSymbol(cCode);
    if (!symbol) { setErr("清仓记录：请输入受支持的股票代码"); return; }
    const p = parseFloat(cPrice), s = parseFloat(cShares), c = parseFloat(cCost);
    if (!cDate) { setErr("请选清仓日期"); return; }
    if (!(p > 0) || !(s > 0) || !Number.isFinite(c)) { setErr("清仓价 / 股数须大于 0，成本请填数字（可为负）"); return; }
    setClosing(true); setErr(null);
    try {
      setData(await api.closePosition(symbol, cDate, p, s, c));
      setCCode(""); setCDate(""); setCPrice(""); setCShares(""); setCCost("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "添加清仓记录失败");
    } finally {
      setClosing(false);
    }
  };

  const removeClosed = async (i: number) => {
    try { setData(await api.removeClosed(i)); } catch { /* ignore */ }
  };

  const holdings = data?.holdings || [];
  const totals = data?.totals;
  const currencyTotals = Object.values(data?.totals_by_currency || {});
  const closed = data?.closed || [];

  const aiContext = `${investmentProfileContext(preferences)}\n\n${totals
    ? `我的持仓（本地数据）：\n` + holdings.map((h) => `${h.name}(${h.code}) ${portfolioAiNumber(h.shares)}股 成本${portfolioAiNumber(h.cost)} 现价${portfolioAiNumber(h.price)} 浮盈${portfolioAiNumber(h.pnl)} ${h.currency}(${portfolioAiNumber(h.pnl_pct)}%)`).join("\n") +
      `\n分币种汇总：` + currencyTotals.map((t) => `${t.currency} 市值${portfolioAiNumber(t.market_value)} 浮盈${portfolioAiNumber(t.pnl)}(${portfolioAiNumber(t.pnl_pct)}%)`).join("；")
    : "我的持仓：暂无记录。"}\n\n${portfolioAiInstruction}`;

  return (
    <div>
      <PageHeader
        title="我的持仓"
        subtitle="IBKR 实际持仓为主；手工记录仍保留在本地"
        actions={section === "stocks" && view === "manual" ? (
          <div className="flex items-center gap-2">
            {holdings.length > 0 && (
              <AskAiButton context={aiContext} label="让 AI 看我的持仓"
                suggestions={["我的持仓集中在哪些方向", "结构上有什么风险", "帮我梳理一下"]} />
            )}
            <button onClick={() => load(true)} disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              刷新
            </button>
          </div>
        ) : undefined}
      />

      <div className="mb-5 flex gap-1 rounded-lg border border-border/60 bg-muted/20 p-1">{([['overview', '总览'], ['stocks', '股票'], ['crypto', '加密货币']] as const).map(([value, label]) => <button key={value} onClick={() => setSection(value)} className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${section === value ? "bg-background text-primary shadow-sm" : "text-muted-foreground"}`}>{label}</button>)}</div>

      {section === "overview" && <PortfolioOverview />}
      {section === "crypto" && <CryptoPortfolioPanel />}
      {section === "stocks" && <>

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-success/25 bg-success/5 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <span>真实持仓从 IBKR Flex 只读导入并存为本地快照；不会提交订单，也不会把原始 Flex 报文上传。手工持仓仍只存在本地。</span>
      </div>

      <GlassCard className="mb-4">
        <div className="flex flex-wrap items-start gap-3">
          <div><h2 className="flex items-center gap-2 text-sm font-semibold"><Target className="h-4 w-4 text-primary" />投资目标与风险偏好</h2><p className="mt-1 text-xs text-muted-foreground">每行一条。保存后会持久化到 Vibe，并在 AI 分析持仓前作为首要上下文。</p></div>
          <button onClick={savePreferences} disabled={preferenceSaving} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-50">{preferenceSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}保存</button>
        </div>
        <textarea value={preferenceDraft} onChange={(event) => setPreferenceDraft(event.target.value)} rows={4} maxLength={5200} placeholder={"- 长期资本增值\n- 最大可接受回撤 15%\n- 降低单一行业集中度"} className="mt-3 w-full resize-y rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground/60"><span>{preferences.length}/20 条已保存</span>{preferenceUpdatedAt && <span>更新于 {new Date(preferenceUpdatedAt).toLocaleString("zh-CN")}</span>}{preferenceError && <span className="text-warning">{preferenceError}</span>}</div>
      </GlassCard>

      <div className="mb-4 flex gap-2 rounded-lg border border-border/60 bg-muted/20 p-1">
        <button onClick={() => setView("ibkr")} className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${view === "ibkr" ? "bg-background text-primary shadow-sm" : "text-muted-foreground"}`}>IBKR 实际持仓与分析</button>
        <button onClick={() => setView("manual")} className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${view === "manual" ? "bg-background text-primary shadow-sm" : "text-muted-foreground"}`}>手工记录</button>
      </div>

      {view === "ibkr" && <RealPositionPanel preferences={preferences} />}

      {view === "manual" && <>

      {/* 汇总 */}
      {currencyTotals.length > 0 && holdings.length > 0 && (
        <div className="mb-4 space-y-2">
          {currencyTotals.map((total) => (
            <div key={total.currency} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { k: `总市值 · ${total.currency}`, v: fmt(total.market_value), c: "text-foreground" },
                { k: `总成本 · ${total.currency}`, v: fmt(total.cost), c: "text-foreground" },
                { k: "浮动盈亏", v: (total.pnl > 0 ? "+" : "") + fmt(total.pnl), c: pnlColor(total.pnl) },
                { k: "盈亏比例", v: portfolioValuePercent(total.pnl_pct), c: pnlColor(total.pnl) },
              ].map((m) => (
                <GlassCard key={m.k} className="p-3">
                  <p className="text-xs text-muted-foreground">{m.k}</p>
                  <p className={cn("mt-1 font-mono text-lg font-bold", m.c)}>{m.v}</p>
                </GlassCard>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 录入 */}
      <GlassCard className="mb-4">
        <h3 className="mb-3 text-sm font-semibold">添加持仓</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">股票代码</label>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9.-]/g, "").toUpperCase().slice(0, 24))} placeholder="600519 / AAPL / VOD.L"
              className="w-48 rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">数量（股）</label>
            <input value={shares} onChange={(e) => setShares(e.target.value.replace(/[^\d.]/g, ""))} placeholder="如 100"
              className="w-28 rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">成本价</label>
            <input value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.-]/g, "").replace(/(?!^)-/g, ""))} placeholder="如 12.5，可负"
              className="w-28 rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
          </div>
          <button onClick={add} disabled={adding}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary shadow-glow hover:bg-primary/25 disabled:opacity-50">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} 添加
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/60">同一代码再次添加会按加权平均成本合并（加仓）。</p>
      </GlassCard>

      {err && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      {/* 持仓表 */}
      <GlassCard glow>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">持仓明细</h3>
          {data?.updated && <span className="text-xs text-muted-foreground/60">更新于 {data.updated}</span>}
        </div>
        {holdings.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground/60">还没有持仓记录，用上面的表单添加一笔。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                  {["名称", "现价", "数量", "成本", "市值", "浮动盈亏", "盈亏%", "计入总览", ""].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={h.code} className="border-b border-border/30">
                    <td className="px-2 py-2.5">
                      <span className="font-medium">{h.name}</span>
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground/60">{h.code}</span>
                    </td>
                    <td className="px-2 py-2.5 font-mono">{fmtPx(h.price)} <span className="text-[10px] text-muted-foreground">{h.currency}</span></td>
                    <td className="px-2 py-2.5 font-mono text-muted-foreground">{fmt(h.shares)}</td>
                    <td className="px-2 py-2.5 font-mono text-muted-foreground">{fmtPx(h.cost)}</td>
                    <td className="px-2 py-2.5 font-mono">{fmt(h.market_value)}</td>
                    <td className={cn("px-2 py-2.5 font-mono", pnlColor(h.pnl))}>{h.pnl != null && h.pnl > 0 ? "+" : ""}{fmt(h.pnl)}</td>
                    <td className={cn("px-2 py-2.5 font-mono", pnlColor(h.pnl))}>{portfolioValuePercent(h.pnl_pct)}</td>
                    <td className="px-2 py-2.5"><input type="checkbox" checked={h.include_in_total} onChange={async (event) => setData(await api.setHoldingInTotal(h.code, event.target.checked))} aria-label={`${h.code}计入总览`} /></td>
                    <td className="px-2 py-2.5">
                      <button onClick={() => remove(h.code)} className="text-muted-foreground/50 hover:text-destructive" title="删除">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* 清仓录入 */}
      <GlassCard className="mb-4 mt-6">
        <h3 className="mb-3 text-sm font-semibold">添加清仓记录</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">股票代码</label>
            <input value={cCode} onChange={(e) => setCCode(e.target.value.replace(/[^a-zA-Z0-9.-]/g, "").toUpperCase().slice(0, 24))} placeholder="AAPL / SAP.DE"
              className="w-36 rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">清仓日期</label>
            <input type="date" value={cDate} onChange={(e) => setCDate(e.target.value)}
              className="rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">清仓价</label>
            <input value={cPrice} onChange={(e) => setCPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder="卖出价"
              className="w-24 rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">股数</label>
            <input value={cShares} onChange={(e) => setCShares(e.target.value.replace(/[^\d.]/g, ""))} placeholder="如 100"
              className="w-24 rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">买入成本</label>
            <input value={cCost} onChange={(e) => setCCost(e.target.value.replace(/[^\d.-]/g, "").replace(/(?!^)-/g, ""))} placeholder="成本价，可负"
              className="w-24 rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
          </div>
          <button onClick={addClose} disabled={closing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary shadow-glow hover:bg-primary/25 disabled:opacity-50">
            {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} 记录
          </button>
        </div>
      </GlassCard>

      {/* 已清仓列表 */}
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">已清仓</h3>
        {closed.length > 0 && data && (
          <span className="text-sm">
            已实现盈亏 {Object.entries(data.realized_pnl_by_currency || {}).map(([currency, value]) => (
              <b key={currency} className={cn("ml-2 font-mono", pnlColor(value))}>{currency} {value > 0 ? "+" : ""}{fmt(value)}</b>
            ))}
          </span>
        )}
      </div>
      <GlassCard>
        {closed.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground/60">还没有清仓记录。卖出后在上面记一笔，作为已实现盈亏的历史。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                  {["名称", "清仓日期", "清仓价", "股数", "成本", "已实现盈亏", "盈亏%", ""].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closed.map((c, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="px-2 py-2.5">
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground/60">{c.code}</span>
                    </td>
                    <td className="px-2 py-2.5 font-mono text-muted-foreground">{c.date}</td>
                    <td className="px-2 py-2.5 font-mono">{fmtPx(c.price)} <span className="text-[10px] text-muted-foreground">{c.currency}</span></td>
                    <td className="px-2 py-2.5 font-mono text-muted-foreground">{fmt(c.shares)}</td>
                    <td className="px-2 py-2.5 font-mono text-muted-foreground">{fmtPx(c.cost)}</td>
                    <td className={cn("px-2 py-2.5 font-mono", pnlColor(c.pnl))}>{c.pnl > 0 ? "+" : ""}{fmt(c.pnl)}</td>
                    <td className={cn("px-2 py-2.5 font-mono", pnlColor(c.pnl))}>{portfolioValuePercent(c.pnl_pct)}</td>
                    <td className="px-2 py-2.5">
                      <button onClick={() => removeClosed(i)} className="text-muted-foreground/50 hover:text-destructive" title="删除">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      </>}

      </>}

      <Disclaimer />
    </div>
  );
}
