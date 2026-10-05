import { useSyncExternalStore } from "react";

const KEY = "stories-kids";
const EVENT = "stories-kids-change";

function readKids(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener(EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

const LIMIT_KEY = "stories-max-min";
const LIMIT_EVENT = "stories-limit-change";

function readLimit(): number {
  try {
    const raw = Number(localStorage.getItem(LIMIT_KEY));
    if (!Number.isFinite(raw)) return 10;
    return Math.min(180, Math.max(1, Math.round(raw)));
  } catch {
    return 10;
  }
}

function subscribeLimit(onStoreChange: () => void): () => void {
  window.addEventListener(LIMIT_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(LIMIT_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function useMaxMinutes(): [number, (next: number) => void] {
  const minutes = useSyncExternalStore(subscribeLimit, readLimit, () => 10);
  const setMinutes = (next: number) => {
    const stored = Math.min(180, Math.max(1, Math.round(next)));
    try {
      localStorage.setItem(LIMIT_KEY, String(stored));
    } catch {
      /* private mode can refuse; the slider still works for this view */
    }
    window.dispatchEvent(new Event(LIMIT_EVENT));
  };
  return [minutes, setMinutes];
}

export function useKidsMode(): [boolean, (next: boolean) => void] {
  const kids = useSyncExternalStore(subscribe, readKids, () => false);
  const setKids = (next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* private mode can refuse; the switch still works for this view */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [kids, setKids];
}
