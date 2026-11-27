const LIMIT = 256 * 1024 * 1024;
let opening: Promise<IDBDatabase> | undefined;

export function hostedPicture(url: unknown): boolean {
  return typeof url === 'string' && /^https:\/\/i\.ibb\.co\/[A-Za-z0-9]+\/[^/?#]+$/.test(url);
}

function database() {
  return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('vtt-picture-originals', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('files');
      db.createObjectStore('sizes').createIndex('age', ['priority', 'time']);
      db.createObjectStore('totals');
    };
    request.onsuccess = () => {
      const db=request.result;
      db.onversionchange=()=>{db.close();opening=undefined;};
      resolve(db);
    };
    request.onerror = () => {opening=undefined;reject(request.error);};
  });
}

export async function savedPicture(url: string): Promise<Blob | null> {
  try {
    const db = await database();
    return await new Promise<Blob | null>((resolve, reject) => {
      const r = db.transaction('files').objectStore('files').get(url);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
    });
  } catch { return null; }
}

export function keepPicture(url: string, blob: Blob) {
  if (hostedPicture(url)) return storePicture(url, blob, 1);
}

export async function storePicture(url: string, blob: Blob, priority: 0 | 1) {
  if (!blob.size || blob.size > LIMIT) return;
  try {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['files', 'sizes', 'totals'], 'readwrite');
      const files = tx.objectStore('files'), sizes = tx.objectStore('sizes'), totals = tx.objectStore('totals');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      const existing = sizes.get(url);
      existing.onsuccess = () => {
        if (existing.result) {
          sizes.put({ ...existing.result, time: Date.now() }, url);
          return;
        }
        const usage = totals.get('bytes');
        usage.onsuccess = () => {
          let bytes = (usage.result ?? 0) + blob.size;
          const insert = () => {
            files.put(blob, url);
            sizes.put({ bytes: blob.size, priority, time: Date.now() }, url);
            totals.put(bytes, 'bytes');
          };
          if (bytes <= LIMIT) return insert();
          const oldest = sizes.index('age').openCursor();
          oldest.onsuccess = () => {
            const row = oldest.result;
            if (!row || bytes <= LIMIT) return insert();
            if (row.value.priority > priority) { tx.abort(); return; }
            bytes -= row.value.bytes;
            files.delete(row.primaryKey);
            row.delete();
            row.continue();
          };
        };
      };
    });
  } catch { }
}
