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

async function putSigned(path: string, body: Blob): Promise<void> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const signed = await signStoryPaths({ data: { puts: [path] } });
    const url = signed.puts[0]?.url;
    if (!url) fail(CODE.save, `no signed upload url for ${path}`);
    try {
      const response = await fetch(url, { method: "PUT", body });
      if (response.ok) return;
      last = { status: response.status };
      report(`upload refused for ${path} on attempt ${attempt}`, last);
      if (response.status !== 408 && response.status !== 429 && response.status < 500) {
        fail(CODE.save, `upload refused for ${path}`, last);
      }
    } catch (error) {
      last = error;
      report(`upload did not finish for ${path} on attempt ${attempt}`, error);
    }
  }
  fail(CODE.save, `upload did not finish for ${path}`, last);
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
  const steps: { path: string; load: () => Promise<Blob | null> }[] = [
    { path: coverKey(story.id), load: async () => story.cover },
  ];
  for (const clip of story.clips) {
    steps.push({
      path: clip.path,
      load: async () => {
        try {
          return await readClipFile(clip);
        } catch {
          return null;
        }
      },
    });
  }
  onProgress?.({ kind: "prepare" });
  let sent = 0;
  for (const step of steps) {
    const body = await step.load();
    if (!body) continue;
    sent += 1;
    onProgress?.(sent === 1 ? { kind: "cover" } : { kind: "clip", n: sent - 1, total: steps.length - 1 });
    await putSigned(step.path, body);
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

/** Write the shelf record only. Does not upload the clips again. */
export async function publishRecord(story: Story): Promise<void> {
  const status = await cloudStatus();
  if (!status.enabled || !status.signedIn) return;
  await writeCloudStory({ data: toCloud(story) });
}

export async function openFamilyShelf(passphrase: string): Promise<boolean> {
  const result = await unlockFamily({ data: { passphrase } });
  return result.ok;
}

export { cloudStatus };
