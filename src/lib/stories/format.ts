import type { Lang } from "@/lib/stories/lang";

export function formatLength(durationMs: number, lang: Lang = "en"): string {
  const total = Math.max(0, Math.round(durationMs / 1000));
  if (total < 60) return lang === "de" ? `${total} Sek.` : `${total} sec`;
  const minutes = Math.max(1, Math.round(total / 60));
  return lang === "de" ? `${minutes} Min.` : `${minutes} min`;
}

export function formatClock(durationMs: number): string {
  const total = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
