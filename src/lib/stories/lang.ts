import { useSyncExternalStore } from "react";

export type Lang = "en" | "de";

const KEY = "stories-lang";
const EVENT = "stories-lang-change";

export function readLang(): Lang {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "en" || stored === "de") return stored;
  } catch {
    /* private mode keeps the browser language for this view */
  }
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("de")) return "de";
  return "en";
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener(EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function useLang(): [Lang, (next: Lang) => void] {
  const lang = useSyncExternalStore(subscribe, readLang, () => "en" as Lang);
  const setLang = (next: Lang) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode can refuse; the switch still works for this view */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [lang, setLang];
}
