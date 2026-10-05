type Take = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  clips: { durationMs: number }[];
};

export function stamp(story: Take): number {
  return story.updatedAt || story.createdAt || 0;
}

function sameTake(a: Take, b: Take): boolean {
  if (a.id === b.id) return true;
  if (a.title.trim() !== b.title.trim()) return false;
  if (a.clips.length === 0 || a.clips.length !== b.clips.length) return false;
  const sameLengths = a.clips.every((clip, index) => Math.round(clip.durationMs) === Math.round(b.clips[index].durationMs));
  return sameLengths && Math.abs((a.createdAt || 0) - (b.createdAt || 0)) < 60_000;
}

/** Newest copy of a story that was saved twice, newest shelf first. */
export function collapseTakes<T extends Take>(stories: T[]): T[] {
  const kept: T[] = [];
  for (const story of stories) {
    const index = kept.findIndex((item) => sameTake(item, story));
    if (index === -1) kept.push(story);
    else if (stamp(story) >= stamp(kept[index])) kept[index] = story;
  }
  return kept.sort((a, b) => b.createdAt - a.createdAt);
}
