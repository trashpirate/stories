import { cloudStatus, deleteCloudStory, readCloudLibrary, signStoryPaths, unlockFamily, writeCloudStory } from "@/lib/stories/cloud.fn";
import { putStory, removeStory } from "@/lib/stories/db";
import { collapseTakes, stamp } from "@/lib/stories/identity";
import { coverKey } from "@/lib/stories/keys";
import { readClipFile, rememberStory } from "@/lib/stories/source";
import type { CloudStory, Story } from "@/lib/stories/types";

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

async function putSigned(url: string, body: Blob): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { method: "PUT", body });
  } catch {
    throw new Error("The private bucket blocked that upload. Allow this site to PUT files in the bucket CORS settings.");
  }
  if (!response.ok) throw new Error("The private bucket refused that file.");
}

/** Upload any local files we still have, then write the private shelf record. */
export async function publishStory(story: Story, onProgress?: (label: string) => void): Promise<void> {
  const status = await cloudStatus();
  if (!status.enabled) return;
  if (!status.signedIn) throw new Error("Enter the family passphrase.");
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
  onProgress?.("Asking for a private upload…");
  const signed = await signStoryPaths({ data: { puts: uploads.map(([path]) => path) } });
  const urls = new Map(signed.puts.map((item) => [item.path, item.url]));
  let clip = 0;
  for (const [path, body] of uploads) {
    const url = urls.get(path);
    if (!url) throw new Error("Couldn't store that story privately.");
    clip += 1;
    onProgress?.(clip === 1 ? "Saving the cover…" : `Saving clip ${clip - 1} of ${uploads.length - 1}…`);
    await putSigned(url, body);
  }
  onProgress?.("Saving the shelf…");
  await writeCloudStory({ data: toCloud(story) });
}

export async function unpublishStory(story: Story): Promise<void> {
  const status = await cloudStatus();
  if (!status.enabled || !status.signedIn) return;
  await deleteCloudStory({ data: { id: story.id } });
}

async function oneCopy(stories: Story[]): Promise<Story[]> {
  const merged = collapseTakes(stories);
  const keep = new Set(merged.map((story) => story.id));
  for (const story of stories) {
    if (keep.has(story.id)) continue;
    try {
      await removeStory(story.id);
    } catch {
      /* the extra card is already hidden */
    }
  }
  return merged;
}

/** Pull the private shelf, keep the newer copy of each story, and upload ones that exist only here. */
export async function reconcileCloud(local: Story[]): Promise<Story[]> {
  const status = await cloudStatus();
  if (!status.enabled || !status.signedIn) return oneCopy(local);
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
      } catch {
        /* the phone copy remains until the next open */
      }
    }
  }

  return oneCopy([...byId.values()]);
}

export async function openFamilyShelf(passphrase: string): Promise<boolean> {
  const result = await unlockFamily({ data: { passphrase } });
  return result.ok;
}

export { cloudStatus };
