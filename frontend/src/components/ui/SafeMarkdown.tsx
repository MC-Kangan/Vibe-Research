import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLocale } from "@/lib/i18n";

function isRemoteImage(src: string): boolean {
  return /^(?:https?:)?\/\//i.test(src);
}

const ConsentImage: Components["img"] = ({ node: _node, src = "", alt = "", ...props }) => {
  const [approved, setApproved] = useState(false);
  const { tr } = useLocale();

  if (!isRemoteImage(src) || approved) {
    return <img {...props} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" />;
  }

  let host = tr("external site", "外部站点");
  try {
    host = new URL(src, window.location.href).host || host;
  } catch {
    // Keep the generic label for malformed URLs; no request is made.
  }

  return (
    <span className="my-2 inline-flex max-w-full flex-col items-start gap-1 rounded-lg border border-border bg-muted/30 p-2 not-prose">
      <span className="text-xs text-muted-foreground">{tr("External image blocked", "外部图片已拦截")}：{alt || host}</span>
      <button
        type="button"
        onClick={() => setApproved(true)}
        className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
      >
        {tr(`Load from ${host}`, `点击后从 ${host} 加载`)}
      </button>
    </span>
  );
};

const MARKDOWN_COMPONENTS: Components = { img: ConsentImage };

export function SafeMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
      {children}
    </ReactMarkdown>
  );
}
