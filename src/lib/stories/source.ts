import type { ClipSource, Story } from "@/lib/stories/types";
import { CODE, fail, isStoriesError, report } from "@/lib/stories/log";

/**
 * Where a clip lives. The shelf and the player only ask for a playable URL.
 * A later cloud store replaces this file and leaves them alone.
 */

function mimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".ogg") || lower.endsWith(".ogv")) return "video/ogg";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  return "video/mp4";
}

function extensionFor(file: File): string {
  const fromName = file.name.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  if (fromName && ["mp4", "mov", "m4v", "webm", "ogg", "ogv", "mkv"].includes(fromName)) {
    return `.${fromName}`;
  }
  if (file.type === "video/webm") return ".webm";
  if (file.type === "video/quicktime") return ".mov";
  if (file.type === "video/ogg") return ".ogg";
  return ".mp4";
}

async function rootDir(): Promise<FileSystemDirectoryHandle> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
    fail(CODE.save, "this browser has no private file storage");
  }
  return navigator.storage.getDirectory();
}

function friendlyWriteError(error: unknown): Error {
  if (isStoriesError(error)) return error;
  if (error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")) {
    report("private file storage is full", error);
    return new Error(CODE.full);
  }
  report("clip write failed", error);
  return new Error(CODE.save);
}

async function fileFromPath(path: string): Promise<File> {
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2 || parts.some((part) => part === "." || part === "..")) {
    fail(CODE.open, `clip path rejected: ${path}`);
  }
  let dir = await rootDir();
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]);
  }
  const handle = await dir.getFileHandle(parts[parts.length - 1]);
  return handle.getFile();
}

export async function readClipFile(clip: ClipSource): Promise<File> {
  return fileFromPath(clip.path);
}

export async function storeClip(storyId: string, index: number, file: File, durationMs: number): Promise<ClipSource> {
  try {
    const root = await rootDir();
    const stories = await root.getDirectoryHandle("stories", { create: true });
    const folder = await stories.getDirectoryHandle(storyId, { create: true });
    const name = `${crypto.randomUUID()}${extensionFor(file)}`;
    const handle = await folder.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(file);
      await writable.close();
    } catch (error) {
      try {
        await writable.abort();
      } catch {
        /* already closed */
      }
      throw error;
    }
    return { path: `stories/${storyId}/${name}`, durationMs };
  } catch (error) {
    throw friendlyWriteError(error);
  }
}

function storyFolderName(storyId: string): string {
  if (!storyId || storyId.includes("/") || storyId.includes("\\") || storyId.includes("..")) {
    fail(CODE.save, "story id rejected");
  }
  return storyId;
}

async function storiesDir(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await rootDir();
  return root.getDirectoryHandle("stories", { create });
}

/** A second copy next to the clips, so the shelf can be rebuilt if the list is lost. */
export async function rememberStory(story: Story): Promise<void> {
  const folder = await (await storiesDir(true)).getDirectoryHandle(storyFolderName(story.id), { create: true });
  const record = {
    id: story.id,
    title: story.title,
    durationMs: story.durationMs,
    unwrapped: story.unwrapped,
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
    clips: story.clips,
  };
  const cover = await folder.getFileHandle("cover.jpg", { create: true });
  const coverWrite = await cover.createWritable();
  await coverWrite.write(story.cover);
  await coverWrite.close();
  const meta = await folder.getFileHandle("story.json", { create: true });
  const metaWrite = await meta.createWritable();
  await metaWrite.write(new Blob([JSON.stringify(record)], { type: "application/json" }));
  await metaWrite.close();
}

export async function hasStoryRecord(storyId: string): Promise<boolean> {
  try {
    const folder = await (await storiesDir(false)).getDirectoryHandle(storyFolderName(storyId));
    await folder.getFileHandle("story.json");
    return true;
  } catch {
    return false;
  }
}

export async function backupStories(stories: Story[]): Promise<void> {
  for (const story of stories) {
    try {
      if (!(await hasStoryRecord(story.id))) await rememberStory(story);
    } catch {
      /* the list copy is enough until the next save */
    }
  }
}

export async function recallStories(): Promise<Story[]> {
  let stories: FileSystemDirectoryHandle;
  try {
    stories = await storiesDir(false);
  } catch {
    return [];
  }
  const found: Story[] = [];
  const listing = stories as FileSystemDirectoryHandle & {
    values(): AsyncIterable<FileSystemHandle>;
  };
  for await (const entry of listing.values()) {
    if (entry.kind !== "directory") continue;
    const folder = entry as FileSystemDirectoryHandle;
    try {
      const meta = await (await folder.getFileHandle("story.json")).getFile();
      const record = JSON.parse(await meta.text()) as Partial<Story>;
      if (!record.id || !record.title || !Array.isArray(record.clips)) continue;
      const cover = await (await folder.getFileHandle("cover.jpg")).getFile();
      found.push({
        id: record.id,
        title: record.title,
        cover,
        durationMs: record.durationMs ?? 0,
        unwrapped: Boolean(record.unwrapped),
        createdAt: record.createdAt ?? 0,
        updatedAt: record.updatedAt,
        clips: record.clips,
      });
    } catch {
      /* a folder without a record can't be shown */
    }
  }
  return found;
}

export async function discardStoryFiles(storyId: string): Promise<void> {
  if (!storyId || storyId.includes("/") || storyId.includes("..")) return;
  try {
    const root = await rootDir();
    const stories = await root.getDirectoryHandle("stories");
    await stories.removeEntry(storyId, { recursive: true });
  } catch {
    /* nothing stored under that id */
  }
}

/** Drop clip copies this story no longer uses. Leaves the cover, the record, and the clips it still names. */
export async function pruneStoryFiles(storyId: string, keepPaths: string[]): Promise<void> {
  let folder: FileSystemDirectoryHandle;
  try {
    folder = await (await storiesDir(false)).getDirectoryHandle(storyFolderName(storyId));
  } catch {
    return;
  }
  const keep = new Set(keepPaths.map((path) => path.split("/").pop()).filter((name): name is string => Boolean(name)));
  keep.add("cover.jpg");
  keep.add("story.json");
  const listing = folder as FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };
  const extra: string[] = [];
  for await (const entry of listing.values()) {
    if (entry.kind === "file" && !keep.has(entry.name)) extra.push(entry.name);
  }
  for (const name of extra) {
    try {
      await folder.removeEntry(name);
    } catch {
      /* already gone */
    }
  }
}

export async function getPlayableUrl(clip: ClipSource): Promise<string> {
  try {
    const file = await fileFromPath(clip.path);
    const type = file.type || mimeFromPath(clip.path);
    const typed = file.type === type ? file : file.slice(0, file.size, type);
    return URL.createObjectURL(typed);
  } catch {
    const { signStoryPaths } = await import("@/lib/stories/cloud.fn");
    const signed = await signStoryPaths({ data: { gets: [clip.path] } });
    const url = signed.gets[0]?.url;
    if (!url) fail(CODE.open, `no signed read url for ${clip.path}`);
    return url;
  }
}

export function releasePlayableUrl(url: string): void {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

export function requestPersistentStorage(): void {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* optional */
  }
}
