import type { HistoryItem, ShotMode } from "@/mahyar/types";

const DB_NAME = "mahyar-image-tools";
const STORE = "shots";
const MAX_ITEMS = 18;

type Row = {
  id: string;
  createdAt: number;
  mode: ShotMode;
  text: string;
  confidence: number | null;
  blob: Blob;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function shrink(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const maxEdge = 1600;
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return blob;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
  return out ?? blob;
}

export async function listShots(): Promise<HistoryItem[]> {
  const db = await openDb();
  const rows = await new Promise<Row[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as Row[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      mode: row.mode,
      text: row.text,
      confidence: row.confidence,
      url: URL.createObjectURL(row.blob),
    }));
}

export async function getShotBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  const row = await new Promise<Row | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as Row | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return row?.blob ?? null;
}

export async function addShot(input: {
  id: string;
  mode: ShotMode;
  text: string;
  confidence: number | null;
  blob: Blob;
}): Promise<void> {
  const db = await openDb();
  const row: Row = {
    id: input.id,
    createdAt: Date.now(),
    mode: input.mode,
    text: input.text,
    confidence: input.confidence,
    blob: await shrink(input.blob),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (keys.length > MAX_ITEMS) {
    const all = await new Promise<Row[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as Row[]);
      req.onerror = () => reject(req.error);
    });
    const extra = all.sort((a, b) => a.createdAt - b.createdAt).slice(0, all.length - MAX_ITEMS);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const item of extra) store.delete(item.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  db.close();
}

export async function updateShotText(
  id: string,
  text: string,
  confidence: number | null,
): Promise<void> {
  const db = await openDb();
  const row = await new Promise<Row | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as Row | undefined);
    req.onerror = () => reject(req.error);
  });
  if (!row) {
    db.close();
    return;
  }
  row.text = text;
  row.confidence = confidence;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function deleteShot(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
