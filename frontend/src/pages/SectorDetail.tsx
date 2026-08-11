import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Plus, Wrench } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { Disclaimer } from "@/components/ui/Disclaimer";
import sectorsData from "@/data/sectors.json";
import { useLocale } from "@/lib/i18n";

export function SectorDetail() {
  const { locale, tr } = useLocale();
  const { key } = useParams();
  const sector = sectorsData.sectors.find((s) => s.key === key);

  if (!sector) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        {tr("Sector not found. ", "未找到该板块。")}<Link to="/sectors" className="text-primary">{tr("Return to sectors", "返回板块中心")}</Link>
      </div>
    );
  }

  const displayLabel = locale === "zh-CN" ? sector.label : sector.label_en;
  const displayTagline = locale === "zh-CN" ? sector.tagline : sector.tagline_en;
  const displayNodes = locale === "zh-CN" ? sector.nodes : sector.nodes_en;
  const aiContext = `Sector: ${sector.label_en}\nPositioning: ${sector.tagline_en}\nValue-chain stages: ` +
    (sector.nodes_en.length ? sector.nodes_en.join(", ") : "mapping in progress");

  return (
    <div>
      <Link to="/sectors" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {tr("Sectors", "板块中心")}
      </Link>

      <PageHeader
        title={displayLabel}
        subtitle={displayTagline}
        actions={
          <AskAiButton
            workflow="sector"
            context={aiContext}
            label={tr("Ask AI to map this sector", "让 AI 拆这个板块")}
            suggestions={locale === "zh-CN" ? ["按七维框架拆解", "这个板块的产业链地图", "哪个环节卡脖子", "有什么风险信号"] : ["Analyse using the seven-dimension framework", "Map this sector's value chain", "Which stages are bottlenecks?", "What risk signals matter?"]}
          />
        }
      />

      {sector.verified ? (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{tr("Core stages", "核心环节")}（{displayNodes.length}）</h3>
          <div className="flex flex-wrap gap-2.5">
            {displayNodes.map((n) => (
              <span key={n} className="rounded-full border border-primary/40 bg-primary/15 px-3.5 py-1.5 text-sm font-medium text-foreground shadow-glow transition-colors hover:bg-primary/25">
                {n}
              </span>
            ))}
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Plus className="h-3.5 w-3.5" /> {tr("Want to attach securities you follow to a stage? Data stays local and is never uploaded or committed.", "想在某个环节挂上自己关注的标的？数据存在你本地，不会上传、不进仓库。")}
          </p>
        </div>
      ) : (
        <GlassCard>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Wrench className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {tr("This sector map is still being ", "该板块的环节骨架尚在")}<b className="text-foreground">{tr("verified", "实时核实")}</b>{tr(" using live evidence rather than model memory.", "补全中（不靠模型记忆）——已核实的板块见左侧。")}
            </p>
            <p className="max-w-md text-xs text-muted-foreground/70">
              {tr("You can also ask your configured AI to map the value chain using the seven-dimension framework.", "也可以点右上角「让 AI 拆这个板块」，用你自己的 AI 按七维框架当场梳理它的产业链。")}
            </p>
          </div>
        </GlassCard>
      )}

      <Disclaimer />
    </div>
  );
}
