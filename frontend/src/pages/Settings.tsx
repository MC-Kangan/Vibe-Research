import { useEffect, useState } from "react";
import { KeyRound, Sparkles, ShieldCheck, Check, Trash2, Terminal } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { toast } from "sonner";
import { apiCredentialsAllowedOnOrigin, loadLlm, saveLlm, clearLlm } from "@/lib/llm";
import { api, loadAccessKey, saveAccessKey, type DataSourceStatus } from "@/lib/api";
import { subscriptionModels, apiModels, PROVIDER_BASE, isCliProvider, aiModels, type ProviderId } from "@/lib/ai-models";
import { storageGet, storageSet } from "@/lib/storage";
import { useLocale } from "@/lib/i18n";

export function Settings() {
  const { locale, tr } = useLocale();
  const existing = loadLlm();
  const existingIsCli = existing ? isCliProvider(existing.provider) : false;

  const [mode, setMode] = useState<"api" | "subscription">(existing && existingIsCli ? "subscription" : "api");
  // 订阅：选中的 CLI model id
  const [cliId, setCliId] = useState(existing && existingIsCli ? existing.model : "");
  // API：选中的模型 id + 可编辑的 baseURL / model / key
  const firstApi = apiModels[0];
  const [apiId, setApiId] = useState(existing && !existingIsCli ? existing.model : firstApi.id);
  const [baseURL, setBaseURL] = useState(existing && !existingIsCli ? existing.baseURL : (PROVIDER_BASE[firstApi.provider] || ""));
  const [modelName, setModelName] = useState(existing && !existingIsCli ? existing.model : firstApi.id);
  const [apiKey, setApiKey] = useState(existing && !existingIsCli ? existing.apiKey : "");
  // 后端访问密钥（对应部署时的 VR_API_KEY）；本机自用不设鉴权时留空
  const [accessKey, setAccessKey] = useState(loadAccessKey());
  const [dataSources, setDataSources] = useState<DataSourceStatus | null>(null);
  const [reportingCurrency, setReportingCurrency] = useState(() => storageGet("vr-reporting-currency") || "AUTO");

  useEffect(() => { api.dataSourceStatus().then(setDataSources).catch(() => setDataSources(null)); }, []);

  const providerOf = (id: string): ProviderId => aiModels.find((m) => m.id === id)?.provider ?? "openai-compatible";

  const pickApiModel = (id: string) => {
    const m = apiModels.find((x) => x.id === id);
    if (!m) return;
    setApiId(id);
    setModelName(id);
    setBaseURL(PROVIDER_BASE[m.provider] || "");
  };

  const saveApi = () => {
    if (!apiCredentialsAllowedOnOrigin()) {
      toast.error(tr("API mode requires HTTPS on a LAN address. Use HTTPS or local CLI mode.", "局域网地址使用 API 模式必须启用 HTTPS；请启用 HTTPS 或改用本机 CLI 模式。"));
      return;
    }
    if (!baseURL.trim() || !apiKey.trim() || !modelName.trim()) {
      toast.error(tr("Complete Base URL, API Key and Model", "请填完 Base URL、API Key、Model"));
      return;
    }
    saveLlm({ provider: providerOf(apiId), baseURL: baseURL.trim(), apiKey: apiKey.trim(), model: modelName.trim() });
    toast.success(tr("Saved locally. Ask AI and reviews are now available throughout the app.", "已保存到本地，全站「问 AI / 复盘」现在可用"));
  };

  const saveSubscription = () => {
    const m = subscriptionModels.find((x) => x.id === cliId);
    if (!m || m.comingSoon) {
      toast.error(tr("Choose an available subscription", "请选择一个可用的订阅（暂不支持标「即将支持」的）"));
      return;
    }
    saveLlm({ provider: m.provider, baseURL: "", apiKey: "", model: m.id });
    toast.success(tr(`${m.name} selected. AI features will use the local ${m.name} CLI.`, `已选「${m.name}」订阅，全站「问 AI / 复盘」将调用本机 ${m.name}`));
  };

  const forget = () => {
    clearLlm();
    setApiKey("");
    setCliId("");
    toast.success(tr("Local configuration cleared", "已清除本地配置"));
  };

  const saveAccess = () => {
    const k = accessKey.trim();
    saveAccessKey(k);
    setAccessKey(k);
    toast.success(k ? tr("Backend access key saved locally", "已保存后端访问密钥（存本地）") : tr("Backend access key cleared", "已清除后端访问密钥"));
  };

  return (
    <div>
      <PageHeader title={tr("AI Setup", "接入 AI")} subtitle={tr("Configure once to use your own model for Ask AI and reviews throughout the app", "配置一次，全站的「问 AI」「复盘」都能用你自己的模型")} />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-success/25 bg-success/5 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <span>{tr("Your API key ", "API key ")}<b className="text-foreground">{tr("exists only in this browser", "只存在你本地浏览器")}</b>{tr(" and is sent to your backend only when you ask a question. API mode is blocked on insecure LAN origins; use HTTPS or local CLI mode. It is never committed. Your model produces the analysis.", "，仅在你提问时发给你自己的后端去调模型。非安全的局域网地址会禁用 API 模式，请使用 HTTPS 或本机 CLI。密钥不会进入仓库，所有分析由你的模型给出。")}</span>
      </div>

      {/* 两种接入方式 */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <GlassCard glow={mode === "subscription"} onClick={() => setMode("subscription")}
          className={mode === "subscription" ? "ring-1 ring-primary/40" : "opacity-80"}>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">{tr("Subscription", "订阅接入")}</h3>
            {mode === "subscription" && <Check className="ml-auto h-4 w-4 text-primary" />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{tr("Use a locally authenticated AI CLI with your subscription allowance and ", "调本机已登录的 AI CLI（Claude Code / Qwen / DeepSeek / Codex…），用订阅额度，")}<b className="text-foreground">{tr("no API key", "免 API key")}</b>{tr(". The backend must run locally.", "。需后端在本机跑。")}</p>
        </GlassCard>

        <GlassCard glow={mode === "api"} onClick={() => setMode("api")}
          className={mode === "api" ? "ring-1 ring-primary/40" : "opacity-80"}>
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">{tr("API", "API 接入")}</h3>
            {mode === "api" && <Check className="ml-auto h-4 w-4 text-primary" />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{tr("Use your API key with DeepSeek, Doubao, MiniMax, OpenAI, OpenRouter, or another compatible endpoint. ", "粘贴 API key，支持 DeepSeek / 豆包 / MiniMax / OpenAI / OpenRouter / 任意兼容端点。")}<b className="text-foreground">{tr("Available now.", "现已可用。")}</b></p>
        </GlassCard>
      </div>

      <GlassCard>
        {mode === "subscription" ? (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              {tr("Choose a CLI installed and authenticated on this machine. Vibe-Research will use your subscription allowance with ", "选一个你本机已安装并登录的 CLI。Vibe-Research 后端会用它以你的订阅额度作答，")}<b className="text-foreground">{tr("no API key", "不用填 key")}</b>.
              <span className="text-muted-foreground/60"> {tr("Available only when the backend runs locally.", "（仅当后端跑在你本机时可用；复盘 / 今日要点 / 个股问 AI 等场景。）")}</span>
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {subscriptionModels.map((m) => {
                const on = cliId === m.id;
                return (
                  <button key={m.id} disabled={m.comingSoon} onClick={() => setCliId(m.id)}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      m.comingSoon
                        ? "cursor-not-allowed border-border/50 opacity-40"
                        : on
                        ? "border-primary/50 bg-primary/10"
                        : "border-border hover:bg-muted/40"
                    }`}>
                    <Terminal className={`h-4 w-4 shrink-0 ${on ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-medium">
                        {m.name}
                        {m.comingSoon && <span className="rounded bg-muted/60 px-1 py-0.5 text-[9px] text-muted-foreground">{tr("Coming soon", "即将支持")}</span>}
                        {on && <Check className="h-3.5 w-3.5 text-primary" />}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">{locale === "zh-CN" ? m.description : m.descriptionEn}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={saveSubscription} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary shadow-glow hover:bg-primary/25">
                {tr("Save", "保存")}
              </button>
              {existing && (
                <button onClick={forget} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" /> {tr("Clear", "清除")}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{tr("Choose model", "选择模型")}</label>
              <select value={apiId} onChange={(e) => pickApiModel(e.target.value)}
                className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50">
                {apiModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} —— {locale === "zh-CN" ? m.description : m.descriptionEn}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Base URL</label>
              <input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://api.deepseek.com"
                className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Model</label>
              <input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder={tr("Model name (use the ep-… endpoint ID for Doubao)", "模型名称（豆包填 ep-… 接入点 ID）")}
                className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">API Key</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…"
                className="w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
            </div>

            <div className="flex items-center gap-2">
              <button onClick={saveApi} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary shadow-glow hover:bg-primary/25">
                {tr("Save locally", "保存（存本地）")}
              </button>
              {existing && (
                <button onClick={forget} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" /> {tr("Clear", "清除")}
                </button>
              )}
            </div>
          </div>
        )}
      </GlassCard>

      <GlassCard className="mt-4">
        <h3 className="mb-1 text-sm font-semibold">{tr("Portfolio reporting currency", "组合报告币种")}</h3>
        <p className="mb-3 text-xs text-muted-foreground">{tr("Auto uses a single IBKR reporting currency when available, otherwise USD. This setting remains in the browser.", "自动模式优先使用单一 IBKR 报告币种，否则使用 USD。此设置只保存在本地浏览器。")}</p>
        <select value={reportingCurrency} onChange={(event) => { setReportingCurrency(event.target.value); storageSet("vr-reporting-currency", event.target.value); toast.success(tr("Portfolio reporting currency saved", "组合报告币种已保存")); }} className="rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="AUTO">{tr("Auto", "自动")}</option><option value="USD">USD</option><option value="GBP">GBP</option><option value="EUR">EUR</option><option value="CNY">CNY</option></select>
      </GlassCard>

      <GlassCard className="mt-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" /> {tr("Market data sources", "市场数据源状态")}
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          {tr("Market-data keys are stored in backend environment variables and never enter the browser or AI requests. Restart the backend after changes.", "市场数据 key 保存在后端环境变量中，不会进入浏览器或 AI 请求。修改环境变量后请重启 backend。")}
        </p>
        <div className="space-y-2">
          {dataSources ? Object.entries(dataSources).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2 border-b border-border/30 pb-2 text-xs last:border-0">
              <span className={value.configured ? "text-success" : "text-warning"}>{value.configured ? tr("Configured", "已配置") : tr("Not configured", "待配置")}</span>
              <span className="font-medium">{key}</span>
              <span className="ml-auto text-right text-muted-foreground">{value.coverage}</span>
            </div>
          )) : <p className="text-xs text-muted-foreground/60">{tr("Data-source status is unavailable.", "数据源状态暂不可用。")}</p>}
        </div>
      </GlassCard>

      {/* 后端访问密钥：仅当后端部署时设置了 VR_API_KEY（公网防蹭用）才需要填 */}
      <GlassCard className="mt-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <KeyRound className="h-4 w-4 text-primary" /> {tr("Backend access key (optional)", "后端访问密钥（可选）")}
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          {tr("Required only when the backend defines ", "仅当后端部署时设置了 ")}<code className="rounded bg-muted/50 px-1">VR_API_KEY</code>{tr(". Enter the same value; leave blank for an unauthenticated local backend. Stored only in this browser.", "（公网部署防蹭用）才需要填，填后端同一个值；本机自用没设鉴权就留空。同样只存本地浏览器。")}
        </p>
        <div className="flex items-center gap-2">
          <input type="password" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} placeholder={tr("Same value as backend VR_API_KEY", "与后端 VR_API_KEY 保持一致")}
            className="flex-1 rounded-lg border border-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-primary/50" />
          <button onClick={saveAccess} className="rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/25">
            {tr("Save", "保存")}
          </button>
        </div>
      </GlassCard>
    </div>
  );
}
