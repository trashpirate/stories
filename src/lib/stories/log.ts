export const CODE = {
  shelf: "stories:shelf",
  save: "stories:save",
  open: "stories:open",
  play: "stories:play",
  remove: "stories:remove",
  passphrase: "stories:passphrase",
  full: "stories:full",
  video: "stories:video",
  read: "stories:read",
  setup: "stories:setup",
  generic: "stories:generic",
} as const;

export type ErrorCode = (typeof CODE)[keyof typeof CODE];

const CODES = new Set<string>(Object.values(CODE));

export function isStoriesError(error: unknown): error is Error {
  return error instanceof Error && [...CODES].some((code) => error.message.includes(code));
}

function loggedShape(error: unknown): unknown {
  if (error instanceof Error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    return { name: error.name, message: error.message, status };
  }
  return error;
}

/** English detail for the server log or the browser console. Never shown on screen. */
export function report(detail: string, error?: unknown): void {
  if (error === undefined) console.error(`[stories] ${detail}`);
  else console.error(`[stories] ${detail}`, loggedShape(error));
}

export function fail(code: ErrorCode, detail: string, error?: unknown): never {
  report(detail, error);
  throw new Error(code);
}

/** Map a thrown error to a short code. Unknown errors are logged here in English. */
export function codeOf(error: unknown): ErrorCode {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const found = (Object.values(CODE) as ErrorCode[]).find((code) => raw.includes(code));
  if (found) return found;
  report("unmapped error", error);
  return CODE.generic;
}
