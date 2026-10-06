import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { deleteCookie, getCookie, getRequestProtocol, setCookie } from "@tanstack/react-start/server";
import { env } from "@/lib/env.server";
import { CODE, fail, isStoriesError, report, type ErrorCode } from "@/lib/stories/log";
import { isStoryId, isStoryObjectKey } from "@/lib/stories/keys";
import type { CloudStory } from "@/lib/stories/types";

const LIBRARY_KEY = "library/stories.json";
const COOKIE = "stories_family";
const MONTH = 60 * 60 * 24 * 30;

function configured(): boolean {
  return Boolean(env("R2_ACCOUNT_ID") && env("R2_BUCKET") && env("R2_ACCESS_KEY_ID") && env("R2_SECRET_ACCESS_KEY") && env("FAMILY_PASSPHRASE"));
}

function required(key: string): string {
  const value = env(key);
  if (!value) fail(CODE.setup, `missing server env ${key}`);
  return value;
}

function bucket(): string {
  return required("R2_BUCKET");
}

let client: S3Client | null = null;

function r2(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: required("R2_ACCESS_KEY_ID"),
        secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

function sameSecret(input: string, expected: string): boolean {
  const left = createHash("sha256").update(input).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function cookieKey(): Buffer {
  return createHash("sha256").update(`stories-session:${required("FAMILY_PASSPHRASE")}`).digest();
}

function seal(exp: number): string {
  const mac = createHmac("sha256", cookieKey()).update(String(exp)).digest("base64url");
  return `${exp}.${mac}`;
}

function sessionValid(token: string | undefined): boolean {
  if (!token || !configured()) return false;
  const [expText, mac] = token.split(".");
  const exp = Number(expText);
  if (!mac || !Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = createHmac("sha256", cookieKey()).update(String(exp)).digest("base64url");
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: getRequestProtocol() === "https",
    sameSite: "lax" as const,
    path: "/",
    maxAge: MONTH,
  };
}

export function cloudStatus(): { enabled: boolean; signedIn: boolean } {
  const enabled = configured();
  return { enabled, signedIn: enabled && sessionValid(getCookie(COOKIE)) };
}

export function unlock(passphrase: string): { ok: true } | { ok: false } {
  if (!configured()) return { ok: false };
  if (!sameSecret(passphrase, required("FAMILY_PASSPHRASE"))) {
    report("family passphrase rejected");
    return { ok: false };
  }
  setCookie(COOKIE, seal(Date.now() + MONTH * 1000), cookieOptions());
  return { ok: true };
}

export function lock(): { ok: true } {
  deleteCookie(COOKIE, cookieOptions());
  return { ok: true };
}

function requireSession(): void {
  if (!configured()) fail(CODE.setup, "private storage is not configured");
  if (!sessionValid(getCookie(COOKIE))) fail(CODE.passphrase, "family session missing or expired");
}

function assertKey(path: string): void {
  if (!isStoryObjectKey(path)) fail(CODE.generic, `rejected object key ${path}`);
}

async function readLibrary(): Promise<{ stories: CloudStory[]; etag?: string }> {
  try {
    const out = await r2().send(new GetObjectCommand({ Bucket: bucket(), Key: LIBRARY_KEY }));
    const text = (await out.Body?.transformToString()) ?? "";
    const parsed = JSON.parse(text) as { stories?: CloudStory[] };
    return { stories: Array.isArray(parsed.stories) ? parsed.stories : [], etag: out.ETag };
  } catch (error) {
    if (error instanceof NoSuchKey || (error as { name?: string }).name === "NoSuchKey") return { stories: [] };
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return { stories: [] };
    fail(CODE.shelf, "library read failed", error);
  }
}

async function writeLibrary(stories: CloudStory[], etag?: string): Promise<void> {
  const body = JSON.stringify({ stories });
  try {
    await r2().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: LIBRARY_KEY,
        Body: body,
        ContentType: "application/json",
        ...(etag ? { IfMatch: etag } : {}),
      }),
    );
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (etag && (status === 412 || status === 409)) throw error;
    if (etag) {
      await r2().send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key: LIBRARY_KEY,
          Body: body,
          ContentType: "application/json",
        }),
      );
      return;
    }
    fail(CODE.save, "library write failed", error);
  }
}

function cleanStory(input: CloudStory): CloudStory {
  if (!isStoryId(input.id)) fail(CODE.save, "story rejected: id is not a uuid");
  if (!input.title.trim() || input.title.length > 120) fail(CODE.save, `story rejected: title length ${input.title.length}`);
  if (!Array.isArray(input.clips) || input.clips.length === 0 || input.clips.length > 40) {
    fail(CODE.save, `story rejected: clip count ${Array.isArray(input.clips) ? input.clips.length : "not-an-array"}`);
  }
  const clips = input.clips.map((clip) => {
    assertKey(clip.path);
    if (!clip.path.startsWith(`stories/${input.id}/`)) fail(CODE.save, `story rejected: clip path is outside ${input.id}`);
    return { path: clip.path, durationMs: Math.max(0, Math.round(clip.durationMs)) };
  });
  return {
    id: input.id,
    title: input.title.trim(),
    durationMs: Math.max(0, Math.round(input.durationMs)),
    unwrapped: Boolean(input.unwrapped),
    createdAt: Math.round(input.createdAt) || Date.now(),
    updatedAt: Math.round(input.updatedAt) || Date.now(),
    clips,
  };
}

async function mutate(change: (stories: CloudStory[]) => CloudStory[]): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readLibrary();
    const stories = change(current.stories);
    try {
      await writeLibrary(stories, current.etag);
      return;
    } catch (error) {
      if (isStoriesError(error)) throw error;
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 412 || status === 409) continue;
      fail(CODE.save, "library write failed during update", error);
    }
  }
  fail(CODE.save, "library write lost three conflicts");
}

async function guard<T>(code: ErrorCode, detail: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isStoriesError(error)) throw error;
    fail(code, detail, error);
  }
}

export function listStories(): Promise<CloudStory[]> {
  return guard(CODE.shelf, "listStories failed", async () => {
    requireSession();
    return (await readLibrary()).stories;
  });
}

export function saveStory(input: CloudStory): Promise<{ ok: true }> {
  return guard(CODE.save, `saveStory failed for ${input?.id ?? "unknown"}`, async () => {
    requireSession();
    const story = cleanStory(input);
    await mutate((stories) => [story, ...stories.filter((item) => item.id !== story.id)]);
    return { ok: true };
  });
}

export function removeStory(id: string): Promise<{ ok: true }> {
  return guard(CODE.remove, `delete failed for story ${id}`, async () => {
    requireSession();
    if (!isStoryId(id)) fail(CODE.remove, "delete rejected: id is not a uuid");
    const listed = await r2().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: `stories/${id}/` }));
    const keys = (listed.Contents ?? []).map((item) => item.Key).filter((key): key is string => Boolean(key));
    if (keys.length > 0) {
      await r2().send(
        new DeleteObjectsCommand({
          Bucket: bucket(),
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
    }
    await mutate((stories) => stories.filter((item) => item.id !== id));
    return { ok: true };
  });
}

export function dropClips(paths: string[]): Promise<{ ok: true }> {
  return guard(CODE.remove, `drop clips failed for ${paths.length} paths`, async () => {
    requireSession();
    const keys = paths.filter((path) => isStoryObjectKey(path) && !path.endsWith("/cover.jpg"));
    if (keys.length === 0) return { ok: true };
    await r2().send(
      new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    return { ok: true };
  });
}

export function signPaths(
  puts: string[],
  gets: string[],
): Promise<{ puts: { path: string; url: string }[]; gets: { path: string; url: string }[] }> {
  return guard(CODE.generic, `signing failed for ${puts.length} uploads and ${gets.length} reads`, async () => {
    requireSession();
    const signedPuts = await Promise.all(
      puts.map(async (path) => {
        assertKey(path);
        const url = await getSignedUrl(r2(), new PutObjectCommand({ Bucket: bucket(), Key: path }), { expiresIn: 60 * 60 * 6 });
        return { path, url };
      }),
    );
    const signedGets = await Promise.all(
      gets.map(async (path) => {
        assertKey(path);
        const url = await getSignedUrl(r2(), new GetObjectCommand({ Bucket: bucket(), Key: path }), { expiresIn: 60 * 60 * 2 });
        return { path, url };
      }),
    );
    return { puts: signedPuts, gets: signedGets };
  });
}
