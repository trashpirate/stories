import { backupStories, recallStories, requestPersistentStorage } from "@/lib/stories/source";
import type { Story } from "@/lib/stories/types";

const DB_NAME = "stories";
const DB_VERSION = 1;
const STORE = "stories";

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => {
        opening = null;
      };
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      opening = null;
      reject(request.error ?? new Error("Couldn't open the shelf."));
    };
    request.onblocked = () => {
      opening = null;
      reject(new Error("Couldn't open the shelf."));
    };
  });
  return opening;
}

function settle(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Couldn't update the shelf."));
    tx.onabort = () => reject(tx.error ?? new Error("Couldn't update the shelf."));
  });
}

export async function listStories(): Promise<Story[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).getAll();
  const finished = settle(tx);
  const rows = await new Promise<Story[]>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result as Story[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error("Couldn't open the shelf."));
  });
  await finished;
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function putStory(story: Story): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(story);
  await settle(tx);
}

export async function markUnwrapped(id: string): Promise<Story | null> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const current = await new Promise<Story | undefined>((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result as Story | undefined);
    request.onerror = () => reject(request.error ?? new Error("Couldn't open that present."));
  });
  if (!current || current.unwrapped) {
    await settle(tx);
    return current ?? null;
  }
  current.unwrapped = true;
  current.updatedAt = Date.now();
  store.put(current);
  await settle(tx);
  return current;
}

export async function removeStory(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await settle(tx);
}

/** The shelf list, rebuilt from the saved clips when the list itself is missing. */
export async function loadShelf(): Promise<Story[]> {
  requestPersistentStorage();
  try {
    const rows = await listStories();
    if (rows.length > 0) {
      void backupStories(rows);
      return rows;
    }
  } catch {
    /* the copies next to the clips can still rebuild the shelf */
  }
  const recovered = await recallStories();
  for (const story of recovered) {
    try {
      await putStory(story);
    } catch {
      /* shown from the file copy until the list can be written */
    }
  }
  return recovered.sort((a, b) => b.createdAt - a.createdAt);
}
