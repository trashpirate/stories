import { cloudStatus, deleteCloudStory, readCloudLibrary, signStoryPaths, unlockFamily, writeCloudStory } from "@/lib/stories/cloud.fn";
import { putStory } from "@/lib/stories/db";
import { coverKey } from "@/lib/stories/keys";
import { CODE, fail, isStoriesError, report } from "@/lib/stories/log";
import { readClipFile, rememberStory } from "@/lib/stories/source";
import type { CloudStory, Story } from "@/lib/stories/types";

export type SaveStep =
  | { kind: "prepare" }
  | { kind: "cover" }
  | { kind: "clip"; n: number; total: number }
  | { kind: "shelf" };

function stamp(story: { updatedAt?: number; createdAt: number }): number {
  return story.updatedAt || story.createdAt || 0;
}

function toCloud(story: Story): CloudStory {
  return {
    id: story.id,
    title: story.title,
    durationMs: story.durationMs,
    unwrapped: story.unwrapped,
    createdAt: story.createdAt,
    updatedAt: story.updatedAt || Date.now(),
    clips: story.clips.map((clip) => ({ path: clip.path, durationMs: clip.durationMs })),
  };
}

async function putSigned(path: string, url: string, body: Blob): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { method: "PUT", body });
  } catch (error) {
    fail(CODE.save, `upload blocked for ${path}. Bucket CORS must allow PUT from this site.`, error);
  }
  if (!response.ok) fail(CODE.save, `upload refused for ${path}`, { status: response.status });
}

/** Upload any local files we still have, then write the private shelf record. */
const publishing = new Map<string, Promise<void>>();

export async function publishStory(story: Story, onProgress?: (step: SaveStep) => void): Promise<void> {
  const current = publishing.get(story.id);
  if (current) {
    await current;
    return;
  }
  const run = uploadStory(story, onProgress).finally(() => {
    if (publishing.get(story.id) === run) publishing.delete(story.id);
  });
  publishing.set(story.id, run);
  await run;
}

async function uploadStory(story: Story, onProgress?: (step: SaveStep) => void): Promise<void> {
  const status = await cloudStatus();
  if (!status.enabled) return;
  if (!status.signedIn) fail(CODE.passphrase, "publish while signed out");
  const bodies = new Map<string, Blob>();
  bodies.set(coverKey(story.id), story.cover);
  for (const clip of story.clips) {
    try {
      bodies.set(clip.path, await readClipFile(clip));
    } catch {
      /* this phone does not have the clip; the private copy is already stored */
    }
  }
  const uploads = [...bodies.entries()];
  onProgress?.({ kind: "prepare" });
  const signed = await signStoryPaths({ data: { puts: uploads.map(([path]) => path) } });
  const urls = new Map(signed.puts.map((item) => [item.path, item.url]));
  let clip = 0;
  for (const [path, body] of uploads) {
    const url = urls.get(path);
    if (!url) fail(CODE.save, `no signed upload url for ${path}`);
    clip += 1;
    onProgress?.(clip === 1 ? { kind: "cover" } : { kind: "clip", n: clip - 1, total: uploads.length - 1 });
    await putSigned(path, url, body);
  }
  onProgress?.({ kind: "shelf" });
  await writeCloudStory({ data: toCloud(story) });
}

export async function unpublishStory(story: Story): Promise<void> {
  const status = await cloudStatus();
  if (!status.enabled || !status.signedIn) return;
  await deleteCloudStory({ data: { id: story.id } });
}

function byNewest(stories: Story[]): Story[] {
  return [...stories].sort((a, b) => b.createdAt - a.createdAt);
}

/** Pull the private shelf, keep the newer copy of each story, and upload ones that exist only here. */
export async function reconcileCloud(local: Story[]): Promise<Story[]> {
  const status = await cloudStatus();
  if (!status.enabled || !status.signedIn) return byNewest(local);
  const remote = await readCloudLibrary();
  const byId = new Map(local.map((story) => [story.id, story]));
  const remoteIds = new Set(remote.stories.map((story) => story.id));

  for (const story of remote.stories) {
    const have = byId.get(story.id);
    if (have && stamp(have) >= stamp(story)) continue;
    const signed = await signStoryPaths({ data: { gets: [coverKey(story.id)] } });
    const url = signed.gets[0]?.url;
    if (!url) continue;
    const response = await fetch(url);
    if (!response.ok) continue;
    const next: Story = { ...story, cover: await response.blob() };
    await rememberStory(next);
    await putStory(next);
    byId.set(story.id, next);
  }

  for (const story of byId.values()) {
    const cloud = remote.stories.find((item) => item.id === story.id);
    if (!remoteIds.has(story.id) || (cloud && stamp(story) > stamp(cloud))) {
      try {
        await publishStory(story);
      } catch (error) {
        if (!isStoriesError(error)) report(`cloud publish skipped for ${story.id}`, error);
      }
    }
  }

  return byNewest([...byId.values()]);
}

export async function openFamilyShelf(passphrase: string): Promise<boolean> {
  const result = await unlockFamily({ data: { passphrase } });
  return result.ok;
}

export { cloudStatus };
