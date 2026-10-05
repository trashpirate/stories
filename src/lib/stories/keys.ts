const STORY_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function isStoryId(id: string): boolean {
  return new RegExp(`^${STORY_ID}$`, "i").test(id);
}

/** A private object key for a clip or a cover. Never a public URL. */
export function isStoryObjectKey(path: string): boolean {
  return new RegExp(`^stories/${STORY_ID}/(cover\\.jpg|${STORY_ID}\\.(mp4|mov|m4v|webm|ogg|ogv|mkv))$`, "i").test(path);
}

export function coverKey(storyId: string): string {
  if (!isStoryId(storyId)) throw new Error("Couldn't store that story.");
  return `stories/${storyId}/cover.jpg`;
}
