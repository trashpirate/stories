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

function matchedCode(error: unknown): ErrorCode | null {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  for (const code of Object.values(CODE)) {
    if (raw.includes(code)) return code;
  }
  return null;
}

export function isStoriesError(error: unknown): error is Error {
  return error instanceof Error && matchedCode(error) !== null;
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

export function noted(code: ErrorCode, detail: string, error?: unknown): Error {
  report(detail, error);
  return new Error(code);
}

export function fail(code: ErrorCode, detail: string, error?: unknown): never {
  throw noted(code, detail, error);
}

/** Map a thrown error to a short code. Unknown errors are logged here in English. */
export function codeOf(error: unknown): ErrorCode {
  const found = matchedCode(error);
  if (found) return found;
  report("unmapped error", error);
  return CODE.generic;
}
