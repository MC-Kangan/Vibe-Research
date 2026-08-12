import { storageGet, storageSet } from "./storage.ts";

export type Locale = "en" | "zh-CN";

const LOCALE_KEY = "vr-locale";
let currentLocale: Locale | undefined;

export function getLocale(): Locale {
  if (!currentLocale) currentLocale = storageGet(LOCALE_KEY) === "zh-CN" ? "zh-CN" : "en";
  return currentLocale;
}

export function setCurrentLocale(locale: Locale): void {
  currentLocale = locale;
  storageSet(LOCALE_KEY, locale);
}
