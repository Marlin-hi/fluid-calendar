/**
 * Thin IndexedDB wrapper for FluidCalendar's offline mode.
 *
 * Two object stores:
 *   - `events`      keyed by event id. Populated on every successful
 *                   GET /api/events so the canvas has data to render when
 *                   the app launches offline.
 *   - `pendingWrites` a FIFO queue of pending mutations made while offline.
 *                   The sync worker drains it once navigator.onLine flips
 *                   back to true. last-writer-wins: if the cloud has moved
 *                   on, our local change still overwrites it.
 *
 * Deliberately raw IDB rather than a library (Dexie, idb) — FC's build
 * needs to stay Windows-friendly for Marlin's dev loop, and adding
 * dependencies here would drag in a full `npm install` resolution pass
 * that fails on better-sqlite3's native build. Raw IDB is a few dozen
 * lines and doesn't tempt future features either.
 *
 * SSR-safe: every export guards on `typeof indexedDB` so importing this
 * module from a server component / during build doesn't throw.
 */

const DB_NAME = "fluidcal-offline";
const DB_VERSION = 1;

export const STORE_EVENTS = "events";
export const STORE_PENDING = "pendingWrites";

export type PendingOp = "create" | "update" | "delete";

export interface PendingWrite {
  /** autoincrement, assigned by IDB */
  id?: number;
  op: PendingOp;
  /** full API path incl. query, e.g. "/api/events" or "/api/events/abc123" */
  path: string;
  /** HTTP method the server expects */
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  /** body for create/update, null for delete */
  body: unknown | null;
  /** optional: the event id this write refers to — lets the UI show a
   *  "pending" badge on that event while it's queued */
  eventId?: string;
  /** The updatedAt (ISO) the event had when we captured this write. Sent
   *  as `If-Match` during sync so the server can detect that someone else
   *  edited the row in the meantime and respond 412. Only meaningful for
   *  update/delete; absent for create. */
  ifMatch?: string;
  createdAt: number;
  /** how many sync attempts have failed for this write */
  attempts: number;
  /** last error message, if any */
  lastError?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB not available (SSR)"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        db.createObjectStore(STORE_EVENTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        const store = db.createObjectStore(STORE_PENDING, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("eventId", "eventId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export function isIdbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/** Run a transaction and return a promise that resolves on complete. */
function txn<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => void | Promise<T> | T
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const os = tx.objectStore(store);
        let result: T | undefined;
        Promise.resolve(fn(os))
          .then((v) => {
            result = v as T;
          })
          .catch(reject);
        tx.oncomplete = () => resolve(result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("tx aborted"));
      })
  );
}

// ---------- events ----------

export async function putEvents(events: Array<{ id: string } & Record<string, unknown>>): Promise<void> {
  if (!isIdbAvailable() || events.length === 0) return;
  await txn(STORE_EVENTS, "readwrite", (os) => {
    for (const e of events) os.put(e);
  });
}

export async function getAllEvents<T = unknown>(): Promise<T[]> {
  if (!isIdbAvailable()) return [];
  return new Promise<T[]>((resolve, reject) => {
    openDb().then((db) => {
      const tx = db.transaction(STORE_EVENTS, "readonly");
      const os = tx.objectStore(STORE_EVENTS);
      const req = os.getAll();
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror = () => reject(req.error);
    }, reject);
  });
}

export async function deleteEvent(id: string): Promise<void> {
  if (!isIdbAvailable()) return;
  await txn(STORE_EVENTS, "readwrite", (os) => os.delete(id));
}

export async function upsertEvent<T extends { id: string }>(event: T): Promise<void> {
  if (!isIdbAvailable()) return;
  await txn(STORE_EVENTS, "readwrite", (os) => os.put(event));
}

// ---------- pendingWrites ----------

export async function queueWrite(
  write: Omit<PendingWrite, "id" | "createdAt" | "attempts">
): Promise<number> {
  if (!isIdbAvailable()) throw new Error("IDB not available");
  return new Promise<number>((resolve, reject) => {
    openDb().then((db) => {
      const tx = db.transaction(STORE_PENDING, "readwrite");
      const os = tx.objectStore(STORE_PENDING);
      const record: Omit<PendingWrite, "id"> = {
        ...write,
        createdAt: Date.now(),
        attempts: 0,
      };
      const req = os.add(record);
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    }, reject);
  });
}

export async function getPendingWrites(): Promise<PendingWrite[]> {
  if (!isIdbAvailable()) return [];
  return new Promise<PendingWrite[]>((resolve, reject) => {
    openDb().then((db) => {
      const tx = db.transaction(STORE_PENDING, "readonly");
      const os = tx.objectStore(STORE_PENDING);
      const req = os.getAll();
      req.onsuccess = () => resolve((req.result as PendingWrite[]) ?? []);
      req.onerror = () => reject(req.error);
    }, reject);
  });
}

export async function removePendingWrite(id: number): Promise<void> {
  if (!isIdbAvailable()) return;
  await txn(STORE_PENDING, "readwrite", (os) => os.delete(id));
}

export async function updatePendingWrite(
  id: number,
  patch: Partial<Pick<PendingWrite, "attempts" | "lastError">>
): Promise<void> {
  if (!isIdbAvailable()) return;
  return new Promise<void>((resolve, reject) => {
    openDb().then((db) => {
      const tx = db.transaction(STORE_PENDING, "readwrite");
      const os = tx.objectStore(STORE_PENDING);
      const getReq = os.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result as PendingWrite | undefined;
        if (!existing) return resolve();
        const updated: PendingWrite = { ...existing, ...patch };
        os.put(updated);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }, reject);
  });
}

export async function countPending(): Promise<number> {
  if (!isIdbAvailable()) return 0;
  return new Promise<number>((resolve, reject) => {
    openDb().then((db) => {
      const tx = db.transaction(STORE_PENDING, "readonly");
      const os = tx.objectStore(STORE_PENDING);
      const req = os.count();
      req.onsuccess = () => resolve(req.result ?? 0);
      req.onerror = () => reject(req.error);
    }, reject);
  });
}
