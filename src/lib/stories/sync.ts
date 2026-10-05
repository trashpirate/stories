import { cloudStatus, deleteCloudStory, readCloudLibrary, signStoryPaths, unlockFamily, writeCloudStory } from "@/lib/stories/cloud.fn";
import { coverKey } from "@/lib/stories/keys";
import { CODE, fail, report } from "@/lib/stories/log";
import { readClipFile } from "@/lib/stories/source";
import type { CloudStory, Story } from "@/lib/stories/types";

export type SaveStep =
  | { kind: "prepare" }
  | { kind: "cover" }
  | { kind: "clip"; n: number; total: number }
  | { kind: "shelf" };

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

function byNewest<T extends { createdAt: number }>(stories: T[]): T[] {
  return [...stories].sort((a, b) => b.createdAt - a.createdAt);
}

/** The private shelf list, or null when this app is not signed in to the bucket. */
export async function listCloudStories(): Promise<CloudStory[] | null> {
  const status = await cloudStatus();
  if (!status.enabled || !status.signedIn) return null;
  const remote = await readCloudLibrary();
  return remote.stories;
}

/** Keep covers that already arrived, and leave the rest empty until they download. */
export function mergeCloud(remote: CloudStory[], previous: Story[] | null): Story[] {
  const covers = new Map((previous ?? []).filter((story) => story.cover.size > 0).map((story) => [story.id, story.cover]));
  return byNewest(remote).map((story) => ({ ...story, cover: covers.get(story.id) ?? new Blob() }));
}

/** Download covers in parallel. Each one is reported as soon as it arrives. */
export async function loadCovers(stories: CloudStory[], onCover: (id: string, cover: Blob) => void): Promise<void> {
  if (!stories.length) return;
  const signed = await signStoryPaths({ data: { gets: stories.map((story) => coverKey(story.id)) } });
  await Promise.all(
    signed.gets.map(async (item) => {
      try {
        const response = await fetch(item.url);
        if (!response.ok) {
          report(`cover download failed for ${item.path}`, { status: response.status });
          return;
        }
        const id = item.path.split("/")[1];
        if (id) onCover(id, await response.blob());
      } catch (error) {
        report(`cover download failed for ${item.path}`, error);
      }
    }),
  );
}

/** Mark a story opened in the private list. Does not upload the clips again. */
export async function publishUnwrapped(story: Story): Promise<void> {
  const status = await cloudStatus();
  if (!status.enabled || !status.signedIn) return;
  await writeCloudStory({ data: toCloud(story) });
}

export async function openFamilyShelf(passphrase: string): Promise<boolean> {
  const result = await unlockFamily({ data: { passphrase } });
  return result.ok;
}

export { cloudStatus };
