import { useEffect } from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { t } from "@/lib/stories/copy";
import { useLang } from "@/lib/stories/lang";
import { CODE, report } from "@/lib/stories/log";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message && !error.message.startsWith("stories:")) return error.message;
  if (typeof error === "string" && error && !error.startsWith("stories:")) return error;
  return fallback;
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const [lang] = useLang();
  const text = t(lang);
  useEffect(() => {
    report("screen failed", error);
  }, [error]);
  return (
    <main
      className={
        "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
      }
    >
      <span className="text-red-500" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">{text.crash}</h1>
      <p className="max-w-md text-sm break-words text-zinc-500 dark:text-zinc-400">
        {errorMessage(error, text.err[CODE.generic])}
      </p>
    </main>
  );
}