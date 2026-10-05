/** A clip as the shelf stores it. Only the source module interprets `path`. */
export type ClipSource = {
  path: string;
  durationMs: number;
};

export type Story = {
  id: string;
  title: string;
  cover: Blob;
  durationMs: number;
  unwrapped: boolean;
  createdAt: number;
  updatedAt?: number;
  clips: ClipSource[];
};

/** The private shelf record. No cover bytes, no public URL. */
export type CloudStory = {
  id: string;
  title: string;
  durationMs: number;
  unwrapped: boolean;
  createdAt: number;
  updatedAt: number;
  clips: ClipSource[];
};