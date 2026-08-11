import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { storageGet, storageSet } from "@/lib/storage";

export type Locale = "en" | "zh-CN";

const LOCALE_KEY = "vr-locale";
let currentLocale: Locale | undefined;

export function getLocale(): Locale {
  if (!currentLocale) currentLocale = storageGet(LOCALE_KEY) === "zh-CN" ? "zh-CN" : "en";
  return currentLocale;
}

export function translate(locale: Locale, english: string, chinese: string): string {
  return locale === "zh-CN" ? chinese : english;
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  tr: (english: string, chinese: string) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getLocale);
  const setLocale = useCallback((next: Locale) => {
    currentLocale = next;
    storageSet(LOCALE_KEY, next);
    setLocaleState(next);
  }, []);
  const tr = useCallback((english: string, chinese: string) => translate(getLocale(), english, chinese), []);
  const value = useMemo(() => ({ locale, setLocale, tr }), [locale, setLocale, tr]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, "Vibe-Research · Personal AI Investment Research", "Vibe-Research · 个人 AI 投资研究");
    document.querySelector('meta[name="description"]')?.setAttribute("content", translate(
      locale,
      "Vibe-Research is a personal AI investment-research workspace for US, European, Chinese equities, and crypto.",
      "Vibe-Research 是面向美股、欧洲股票、A 股与加密资产的个人 AI 投资研究工作台。",
    ));
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used within LocaleProvider");
  return value;
}
