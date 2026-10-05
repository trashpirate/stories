type Take = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  clips: { durationMs: number }[];
};

function stamp(story: Take): number {
  return story.updatedAt || story.createdAt || 0;
}

/** Two saves of the same clips, a few seconds apart, are one story. */
export function sameTake(a: Take, b: Take): boolean {
  if (a.id === b.id) return true;
  if (a.title.trim() !== b.title.trim()) return false;
  if (a.clips.length === 0 || a.clips.length !== b.clips.length) return false;
  const sameLengths = a.clips.every((clip, index) => Math.round(clip.durationMs) === Math.round(b.clips[index].durationMs));
  if (!sameLengths) return false;
  return Math.abs((a.createdAt || 0) - (b.createdAt || 0)) < 60_000;
}

/** Keep the newest copy when the same story was stored twice. */
export function collapseTakes<T extends Take>(stories: T[]): T[] {
  const kept: T[] = [];
  for (const story of stories) {
    const index = kept.findIndex((item) => sameTake(item, story));
    if (index === -1) {
      kept.push(story);
      continue;
    }
    if (stamp(story) >= stamp(kept[index])) kept[index] = story;
  }
  return kept;
}
