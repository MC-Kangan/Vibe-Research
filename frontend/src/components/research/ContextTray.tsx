import { useRef, useState } from "react";
import { FilePlus2, FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { api, ApiError, type ExtractedResearchContext } from "@/lib/api";
import type { ResearchContextItem } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n";

export interface ContextEntry extends ResearchContextItem {
  id: string;
  truncated?: boolean;
  originalCharacters?: number;
  pages?: number | null;
}

const fileToB64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

let contextSequence = 0;
const nextContextId = () => `research-context-${Date.now().toString(36)}-${++contextSequence}`;

const fromExtracted = (item: ExtractedResearchContext): ContextEntry => ({
  id: nextContextId(), name: item.name, content: item.content,
  truncated: item.truncated, originalCharacters: item.original_characters, pages: item.pages,
});

export function ContextTray({ entries, onChange, disabled = false }: {
  entries: ContextEntry[];
  onChange: (items: ContextEntry[]) => void;
  disabled?: boolean;
}) {
  const { locale, tr } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState("");

  const addNote = () => {
    if (entries.length >= 8) { setError(tr("A maximum of 8 research items is allowed", "补充材料最多 8 项")); return; }
    onChange([...entries, { id: nextContextId(), name: `${tr("Research note", "研究笔记")} ${entries.length + 1}`, content: "" }]);
  };

  const upload = async (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (!selected.length) return;
    if (entries.length + selected.length > 8) { setError(tr("A maximum of 8 research items is allowed", "补充材料最多 8 项")); return; }
    if (selected.reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024) { setError(tr("Selected files cannot exceed 25 MB in total", "本次选择的文件合计不能超过 25MB")); return; }
    setBusy(true); setError("");
    try {
      const extracted: ExtractedResearchContext[] = [];
      for (const file of selected) {
        const result = await api.extractResearchContexts([{ name: file.name, content_b64: await fileToB64(file) }]);
        extracted.push(...result);
      }
      onChange([...entries, ...extracted.map(fromExtracted)]);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : tr("Unable to read the file", "文件读取失败"));
    } finally { setBusy(false); }
  };

  const update = (id: string, field: "name" | "content", value: string) =>
    onChange(entries.map((item) => item.id === id ? { ...item, [field]: value } : item));

  const total = entries.reduce((sum, item) => sum + item.content.trim().length, 0);
  return (
    <div className="mt-4 border-t border-border/40 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <p className="text-sm font-semibold">{tr("Supplemental research", "补充研究材料")}</p>
          <p className="text-[11px] text-muted-foreground">{tr("Used only for this run and never saved. Materials are marked unverified and embedded instructions are ignored.", "每次运行临时使用，不保存。材料会标记为未经验证，并要求模型忽略其中的指令。")}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={addNote} disabled={disabled || entries.length >= 8} className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs disabled:opacity-50"><Plus className="h-3.5 w-3.5" />{tr("Paste text", "粘贴文字")}</button>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || busy || entries.length >= 8} className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FilePlus2 className="h-3.5 w-3.5" />}{tr("Choose files", "选择文件")}</button>
          <input ref={inputRef} type="file" multiple accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf" className="hidden" onChange={(event) => { if (event.target.files) upload(event.target.files); event.target.value = ""; }} />
        </div>
      </div>
      <div onDragOver={(event) => { event.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(event) => { event.preventDefault(); setDrag(false); if (!disabled) upload(event.dataTransfer.files); }} className={cn("mt-3 rounded-xl border border-dashed p-3 transition-colors", drag ? "border-primary bg-primary/5" : "border-border/50")}>
        {entries.length === 0 ? <p className="py-3 text-center text-xs text-muted-foreground">{tr("Drop multiple TXT, Markdown, or text-based PDF files here, or add pasted notes. Maximum 25 MB per batch.", "可一次拖入多个 TXT、Markdown 或文字型 PDF，也可添加多条粘贴笔记。每批文件合计 ≤ 25MB。")}</p> : (
          <div className="space-y-3">
            {entries.map((item) => <div key={item.id} className="rounded-lg border border-border/50 bg-background/30 p-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <input value={item.name} onChange={(event) => update(item.id, "name", event.target.value.slice(0, 160))} disabled={disabled} aria-label={tr("Material name", "材料名称")} className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none" />
                <span className="text-[10px] text-muted-foreground">{item.content.length.toLocaleString(locale)} {tr("characters", "字")}{item.pages ? ` · ${item.pages} ${tr("pages", "页")}` : ""}</span>
                <button type="button" onClick={() => onChange(entries.filter((entry) => entry.id !== item.id))} disabled={disabled} aria-label={`${tr("Remove", "移除")} ${item.name}`} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              </div>
              <textarea value={item.content} onChange={(event) => update(item.id, "content", event.target.value.slice(0, 20_000))} disabled={disabled} maxLength={20_000} rows={4} placeholder={tr("Paste research notes, meeting notes, or claims to verify…", "粘贴研究笔记、会议记录或需要验证的观点…")} className="mt-2 w-full resize-y rounded-lg border border-border/50 bg-black/10 px-3 py-2 text-xs leading-relaxed outline-none focus:border-primary/50" />
              {item.truncated && <p className="mt-1 text-[11px] text-warning">{tr(`The original had ${item.originalCharacters?.toLocaleString(locale)} characters; only the first 20,000 were retained. Paste the most relevant passages instead.`, `原文 ${item.originalCharacters?.toLocaleString(locale)} 字，已截取前 20,000 字。建议粘贴最相关段落。`)}</p>}
            </div>)}
          </div>
        )}
      </div>
      <div className="mt-1.5 flex gap-3 text-[10px] text-muted-foreground"><span>{entries.length}/8 {tr("items", "项")}</span><span>{total.toLocaleString(locale)}/50,000 {tr("characters", "字")}</span>{total > 50_000 && <span className="text-destructive">{tr("Total length exceeded", "超过总长度上限")}</span>}</div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
