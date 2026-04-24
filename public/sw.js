/**
 * FluidCalendar service worker.
 *
 * Three jobs:
 *   1. Precache a shell (/calendar + icons) so the PWA opens offline.
 *   2. Cache-first fall-through on GETs: try the network, fall back to
 *      the last-good cache if it fails. Covers both static assets and
 *      dynamic pages.
 *   3. Drain the offline write-queue via the Background Sync API while
 *      the tab is closed. On `sync` event, open the IDB the page uses
 *      (db name `fluidcal-offline`, store `pendingWrites`) and POST/
 *      PATCH/DELETE each pending row against the real server. Keep
 *      queue entries on 5xx / network errors, drop them on 4xx
 *      (last-writer-wins). 412 is handled the same way — the main-
 *      thread sync worker has richer conflict handling, this is just
 *      the fallback when no tab is open.
 *
 * The CACHE_NAME version suffix is bumped whenever the precache list
 * changes so clients pick up new static assets on their next visit.
 */

const CACHE_NAME = "kalender-v2";
const PRECACHE_URLS = ["/calendar", "/icon-192.png", "/icon-512.png", "/logo.svg"];

// ---- lifecycle ----

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Don't intercept /api/* — the page's offline fetch-patch handles
  // those with proper IDB-backed fallback + delta cursor. Caching the
  // API list in the SW as well would only cause staleness.
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ---- Background Sync: drain the pending-writes queue ----

const DB_NAME = "fluidcal-offline";
const STORE_PENDING = "pendingWrites";
const SYNC_TAG = "fc-sync-pending";

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // `onupgradeneeded` intentionally omitted: the page creates the
    // schema on first load. If the SW runs before the page ever has,
    // there's nothing to sync anyway.
  });
}

function getAllPending(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDING, "readonly");
    const req = tx.objectStore(STORE_PENDING).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function removePending(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDING, "readwrite");
    tx.objectStore(STORE_PENDING).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function bumpAttempt(db, write, errMsg) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDING, "readwrite");
    const os = tx.objectStore(STORE_PENDING);
    const getReq = os.get(write.id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) return resolve();
      os.put({
        ...existing,
        attempts: (existing.attempts || 0) + 1,
        lastError: String(errMsg).slice(0, 200),
      });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function drainPending() {
  const db = await openIdb();
  const queue = await getAllPending(db);
  for (const write of queue) {
    const headers = { "content-type": "application/json" };
    if (write.ifMatch) headers["if-match"] = write.ifMatch;
    try {
      const res = await fetch(write.path, {
        method: write.method,
        headers,
        body: write.body ? JSON.stringify(write.body) : undefined,
        credentials: "include",
      });
      if (res.ok) {
        await removePending(db, write.id);
      } else if (res.status >= 400 && res.status < 500) {
        // last-writer-wins: server refused, drop to avoid an endless
        // retry. The main-thread worker may retry without If-Match
        // when the tab next opens.
        await removePending(db, write.id);
      } else {
        await bumpAttempt(db, write, `HTTP ${res.status}`);
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      // Let the event fail so the browser reschedules the sync.
      await bumpAttempt(db, write, err && err.message ? err.message : String(err));
      throw err;
    }
  }
  // Notify any open clients so their status panels refresh.
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clients) c.postMessage({ type: "fc:pending-changed" });
}

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(drainPending());
  }
});

// Message-driven fallback: browsers without Background Sync API (Safari,
// Firefox) can still trigger a drain by postMessage from the page.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "fc:drain") {
    event.waitUntil ? event.waitUntil(drainPending()) : drainPending();
  }
});
