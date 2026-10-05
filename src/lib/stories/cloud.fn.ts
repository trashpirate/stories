import { createServerFn } from "@tanstack/react-start";
import type { CloudStory } from "@/lib/stories/types";

export const cloudStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { cloudStatus: status } = await import("./cloud.server");
  return status();
});

export const unlockFamily = createServerFn({ method: "POST" })
  .validator((data: { passphrase: string }) => {
    if (!data || typeof data.passphrase !== "string") throw new Error("Gib das Familienpasswort ein.");
    return { passphrase: data.passphrase };
  })
  .handler(async ({ data }) => {
    const { unlock } = await import("./cloud.server");
    return unlock(data.passphrase);
  });

export const readCloudLibrary = createServerFn({ method: "GET" }).handler(async () => {
  const { listStories } = await import("./cloud.server");
  return { stories: await listStories() };
});

export const writeCloudStory = createServerFn({ method: "POST" })
  .validator((data: CloudStory) => data)
  .handler(async ({ data }) => {
    const { saveStory } = await import("./cloud.server");
    return saveStory(data);
  });

export const deleteCloudStory = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => {
    if (!data || typeof data.id !== "string") throw new Error("Die Geschichte ließ sich nicht entfernen.");
    return { id: data.id };
  })
  .handler(async ({ data }) => {
    const { removeStory } = await import("./cloud.server");
    return removeStory(data.id);
  });

export const signStoryPaths = createServerFn({ method: "POST" })
  .validator((data: { puts?: string[]; gets?: string[] }) => ({
    puts: Array.isArray(data?.puts) ? data.puts.filter((item) => typeof item === "string") : [],
    gets: Array.isArray(data?.gets) ? data.gets.filter((item) => typeof item === "string") : [],
  }))
  .handler(async ({ data }) => {
    const { signPaths } = await import("./cloud.server");
    return signPaths(data.puts, data.gets);
  });
