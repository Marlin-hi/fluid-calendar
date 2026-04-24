/**
 * Offline-aware fetch patch.
 *
 * When the offline feature flag is enabled we monkey-patch `window.fetch`
 * once, at app init, so every existing caller inside FC (the calendar
 * store, hooks, custom components) gets IndexedDB hydration + an offline
 * fallback without having to be rewritten. The patch is a thin wrapper —
 * by default it simply delegates to the original fetch.
 *
 * Behaviour per request:
 *
 *   GET /api/events
 *     - Online:  run the real fetch, and on success mirror the response
 *                array into IDB so the app has fresh data when it next
 *                starts offline.
 *     - Offline: skip the network, return a synthesised 200 JSON Response
 *                built from the cached events in IDB.
 *
 *   GET /api/feeds
 *     - Same pattern as events — feeds are needed to colour-code events
 *       in the offline canvas.
 *
 *   Everything else:
 *     - Passthrough. Write operations are Phase 2 of the offline project
 *       (pending-writes queue + sync worker).
 *
 * We check `navigator.onLine` and catch NetworkError to decide "offline".
 * navigator.onLine alone is famously unreliable (captive portals, stale
 * state on desktop), so the catch-branch is what really matters — if the
 * real fetch throws before we get a response, we fall back to IDB.
 */

import {
  deleteEvent,
  getAllEvents,
  isIdbAvailable,
  pruneEventsOutsideWindow,
  putEvents,
  queueWrite,
  upsertEvent,
} from "./db";
import { isOfflineEnabled } from "./settings";

/** Window we keep hydrated in IDB. Anything older than 30 days or more
 *  than 180 days in the future gets pruned on the next delta-sync so
 *  the local store doesn't grow without bound on a busy calendar.
 *  When the user navigates outside this window in the UI, a subsequent
 *  full-fetch (cursor cleared on app launch) repopulates it. */
const CACHE_DAYS_BACK = 30;
const CACHE_DAYS_FORWARD = 180;

type FetchArgs = Parameters<typeof fetch>;
const ORIGINAL_KEY = "__fcOriginalFetch__" as const;

/** Is this URL the events-list endpoint? Query strings allowed. */
function isEventsList(url: string): boolean {
  try {
    const u = new URL(url, typeof location === "undefined" ? "http://x" : location.origin);
    return u.pathname === "/api/events";
  } catch {
    return false;
  }
}

/**
 * Any endpoint that accepts an event write. `/api/events` is the
 * LOCAL-calendar path; feeds backed by CalDAV / Google / Outlook hit
 * their provider-specific equivalents and must also be queued offline.
 * When the sync worker drains a pending write it re-uses PendingWrite.path
 * so each entry lands back on the endpoint it was originally aimed at.
 */
function isEventWrite(url: string): string | null {
  try {
    const u = new URL(url, typeof location === "undefined" ? "http://x" : location.origin);
    if (u.pathname === "/api/events") return u.pathname;
    if (/^\/api\/calendar\/(caldav|google|outlook)\/events$/.test(u.pathname)) {
      return u.pathname;
    }
    return null;
  } catch {
    return null;
  }
}

/** Is this URL the feeds-list endpoint? */
function isFeedsList(url: string): boolean {
  try {
    const u = new URL(url, typeof location === "undefined" ? "http://x" : location.origin);
    return u.pathname === "/api/feeds";
  } catch {
    return false;
  }
}

function urlOf(input: FetchArgs[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return String(input);
}

function methodOf(input: FetchArgs[0], init?: FetchArgs[1]): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-fc-offline-cache": "1" },
  });
}

/** Pre-synced events get a `local-` id. The sync worker swaps it for the
 *  real server id once the POST has gone through.  */
function tempId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Record a write locally (IDB + queue) and return a synthesized success
 * Response. Returns null if the body couldn't be interpreted, which lets
 * the caller rethrow the network error rather than silently eat it.
 *
 * Emits `fc:pending-changed` so any open UI (the settings status panel,
 * a future 'n pending' badge) picks up the new queue length.
 */
async function handleOfflineWrite(
  method: string,
  body: Record<string, unknown> | null,
  path: string
): Promise<Response | null> {
  if (method === "POST" && body) {
    const id = tempId();
    const feedId = String(body.feedId ?? "");
    const feedMeta = await getCachedFeedMeta(feedId);
    const optimistic = {
      id,
      feedId,
      title: body.title ?? "",
      description: body.description ?? null,
      start: body.start,
      end: body.end,
      location: body.location ?? null,
      isRecurring: body.isRecurring ?? false,
      recurrenceRule: body.recurrenceRule ?? null,
      allDay: body.allDay ?? false,
      feed: { name: feedMeta.name ?? null, color: feedMeta.color ?? null },
      _pending: true as const,
    };
    await upsertEvent(optimistic);
    await queueWrite({
      op: "create",
      path, // preserve the original write endpoint (LOCAL vs CalDAV vs Google vs Outlook)
      method: "POST",
      body,
      eventId: id,
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("fc:pending-changed"));
    }
    return jsonResponse(optimistic, 201);
  }
  if (method === "PATCH" && body?.id) {
    const id = String(body.id);
    const all = await getAllEvents<{ id: string; updatedAt?: string }>();
    const existing = all.find((e) => e.id === id) ?? { id };
    const merged = { ...existing, ...body, _pending: true as const };
    await upsertEvent(merged);
    await queueWrite({
      op: "update",
      path,
      method: "PATCH",
      body,
      eventId: id,
      // Snapshot the server version so the sync worker can send it as
      // If-Match and the server can detect concurrent edits.
      ifMatch: existing.updatedAt,
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("fc:pending-changed"));
    }
    return jsonResponse(merged, 200);
  }
  if (method === "DELETE" && body?.id) {
    const id = String(body.id);
    const all = await getAllEvents<{ id: string; updatedAt?: string }>();
    const existing = all.find((e) => e.id === id);
    await deleteEvent(id);
    await queueWrite({
      op: "delete",
      path,
      method: "DELETE",
      body,
      eventId: id,
      ifMatch: existing?.updatedAt,
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("fc:pending-changed"));
    }
    return jsonResponse({ success: true }, 200);
  }
  return null;
}

async function readJsonBody(init?: FetchArgs[1]): Promise<Record<string, unknown> | null> {
  if (!init?.body) return null;
  try {
    if (typeof init.body === "string") return JSON.parse(init.body) as Record<string, unknown>;
    // FormData / Blob / ReadableStream are not used for /api/events in FC.
    return null;
  } catch {
    return null;
  }
}

/** Pull the cached feed array back out of the events store. Needed so that
 *  the synthesized event we return from a POST has the feed name/color the
 *  calendar UI expects to render the tile. */
async function getCachedFeedMeta(feedId: string): Promise<{ name?: string; color?: string }> {
  try {
    const all = await getAllEvents<{ id: string; data?: Array<{ id: string; name?: string; color?: string }> }>();
    const bundle = all.find((r) => r.id === "__fc_feeds_cache__");
    const feed = Array.isArray(bundle?.data) ? bundle!.data.find((f) => f.id === feedId) : undefined;
    return feed ? { name: feed.name, color: feed.color } : {};
  } catch {
    return {};
  }
}

/** Feeds cache lives in IDB too, under the events store keyed by a sentinel id.
 *  Keeps the code path simple — we don't need a second store for five-ish rows. */
const FEEDS_CACHE_ID = "__fc_feeds_cache__";
/** Incremental-sync cursor (ISO timestamp from the server's X-Sync-Ts). */
const SYNC_CURSOR_ID = "__fc_sync_cursor__";

async function getSyncCursor(): Promise<string | null> {
  const all = await getAllEvents<{ id: string; lastSyncTs?: string }>();
  const record = all.find((r) => r.id === SYNC_CURSOR_ID);
  return record?.lastSyncTs ?? null;
}

async function setSyncCursor(ts: string): Promise<void> {
  await upsertEvent({ id: SYNC_CURSOR_ID, lastSyncTs: ts });
}

/** Reserved sentinel ids that live in the events store for bookkeeping
 *  (feeds cache, sync cursor). Filter these out when returning events
 *  to callers — they're never real calendar rows. */
function isSentinel(id: string): boolean {
  return id === FEEDS_CACHE_ID || id === SYNC_CURSOR_ID;
}

async function cacheFeeds(feeds: unknown): Promise<void> {
  if (!Array.isArray(feeds)) return;
  await putEvents([{ id: FEEDS_CACHE_ID, data: feeds } as { id: string } & Record<string, unknown>]);
}

async function getCachedFeeds(): Promise<unknown[]> {
  const all = await getAllEvents<{ id: string; data?: unknown[] }>();
  const record = all.find((r) => r.id === FEEDS_CACHE_ID);
  return Array.isArray(record?.data) ? (record!.data as unknown[]) : [];
}

async function getCachedEvents(): Promise<unknown[]> {
  const all = await getAllEvents<{ id: string }>();
  return all.filter((e) => !isSentinel(e.id));
}

export function installOfflineFetchPatch(): void {
  if (typeof window === "undefined") return;
  // idempotent: don't double-wrap on HMR or StrictMode re-run
  const w = window as unknown as { [ORIGINAL_KEY]?: typeof fetch };
  if (w[ORIGINAL_KEY]) return;
  const original = window.fetch.bind(window);
  w[ORIGINAL_KEY] = original;

  window.fetch = (async (...args: FetchArgs): Promise<Response> => {
    // Bail out fast if the user hasn't opted in — zero overhead on the
    // default path.
    if (!isOfflineEnabled() || !isIdbAvailable()) {
      return original(...args);
    }

    const [input, init] = args;
    const url = urlOf(input);
    const method = methodOf(input, init);

    // --- Task auto-schedule: swallow offline; the server will schedule on
    //     its own the next time we're online. Blocking the user's Create
    //     dialog on a network round-trip to /api/tasks/schedule-all is
    //     what made offline creates surface "Failed to fetch" alerts even
    //     though the event itself had landed in IDB correctly. ---
    if (method === "POST") {
      try {
        const u = new URL(url, typeof location === "undefined" ? "http://x" : location.origin);
        if (
          u.pathname === "/api/tasks/schedule-all" ||
          u.pathname === "/api/tasks/schedule-all/queue"
        ) {
          if (typeof navigator !== "undefined" && navigator.onLine === false) {
            return jsonResponse([], 200);
          }
          try {
            return await original(...args);
          } catch {
            return jsonResponse([], 200);
          }
        }
      } catch {
        /* URL parse failed — leave to default handling */
      }
    }

    // --- Writes on any event endpoint: always optimistic ---
    //
    // Marlin reported that deletes (and to a lesser degree patches)
    // hung the UI while online because the calendar store awaited
    //   1. the write round-trip,
    //   2. a full loadFromDatabase() GET,
    //   3. a task schedule-all POST,
    // all serialised. On a 1-second RTT that's 3 s of spinner.
    //
    // We already have a full offline-write pipeline: optimistic IDB
    // update, pending-writes queue, sync worker that drains
    // immediately when online. So just route EVERY write through that
    // pipeline — the sync worker kicks off on the fc:pending-changed
    // event we emit inside handleOfflineWrite, which fires
    // sub-millisecond after the user's action. The user sees UI react
    // instantly; the real server call happens in the background and
    // reconciles IDB when it succeeds. If-Match conflict detection
    // still runs on the sync-worker pass and the 412 retry keeps the
    // last-writer-wins semantics we had before.
    const writePath = isEventWrite(url);
    if (writePath && (method === "POST" || method === "PATCH" || method === "DELETE")) {
      const body = await readJsonBody(init);
      const optimistic = await handleOfflineWrite(method, body, writePath);
      if (optimistic) return optimistic;
      // Body wasn't parseable — nothing we can optimistically apply;
      // fall through to the real fetch so the error is surfaced.
      return original(...args);
    }

    // --- GET /api/events and /api/feeds: hydrate + read-fallback ---
    if (method === "GET" && (isEventsList(url) || isFeedsList(url))) {
      // Fast-path: same reason as the write branch. Skip the browser's
      // ~30s connect timeout when we already know we're offline.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        try {
          if (isEventsList(url)) return jsonResponse(await getCachedEvents());
          if (isFeedsList(url)) return jsonResponse(await getCachedFeeds());
        } catch {
          /* fall through to the normal fetch + catch */
        }
      }
      // Incremental sync: if we already have a cursor, append ?since=<ts>
      // so the server only returns deltas. The first call of the session
      // (empty IDB → no cursor) falls through as a full fetch.
      let fetchArgs: FetchArgs = args;
      let usedCursor: string | null = null;
      if (isEventsList(url)) {
        usedCursor = await getSyncCursor().catch(() => null);
        if (usedCursor) {
          try {
            const u = new URL(url, location.origin);
            u.searchParams.set("since", usedCursor);
            fetchArgs = [u.toString(), init];
          } catch {
            /* URL parse failed — fall back to full fetch */
          }
        }
      }

      try {
        const res = await original(...fetchArgs);
        if (!res.ok) return res;

        if (isEventsList(url)) {
          const delta = (await res.clone().json()) as Array<{ id: string }>;
          if (Array.isArray(delta)) {
            // Upsert the delta rows into IDB (keep untouched rows intact
            // on a server-side delta fetch). If we did a full fetch (no
            // cursor), the delta IS the whole dataset.
            if (delta.length > 0) await putEvents(delta).catch(() => {});
            // Store the server's X-Sync-Ts as the cursor for next time —
            // NOT max(updatedAt) from the rows, which would miss writes
            // saved in the same ms as the query.
            const newCursor = res.headers.get("X-Sync-Ts");
            if (newCursor) await setSyncCursor(newCursor).catch(() => {});
            // Trim events outside the sliding cache window. Pending rows
            // and sentinels are preserved by the helper.
            await pruneEventsOutsideWindow(
              new Date(),
              CACHE_DAYS_BACK,
              CACHE_DAYS_FORWARD
            ).catch(() => {});

            // Always return the full picture to the caller, not just the
            // delta — the calendar store overwrites its state with the
            // response, so a delta would drop everything that wasn't in
            // this tick's changes.
            const everything = await getCachedEvents();
            return jsonResponse(everything);
          }
          return res;
        }

        if (isFeedsList(url)) {
          const clone = res.clone();
          clone.json().then(
            (data) => cacheFeeds(data).catch(() => {}),
            () => {}
          );
          return res;
        }

        return res;
      } catch (networkErr) {
        // Network failed → serve from IDB. Includes any pending rows.
        try {
          if (isEventsList(url)) {
            const events = await getCachedEvents();
            return jsonResponse(events);
          }
          if (isFeedsList(url)) {
            const feeds = await getCachedFeeds();
            return jsonResponse(feeds);
          }
        } catch {
          /* fall through to rethrow */
        }
        throw networkErr;
      }
    }

    return original(...args);
  }) as typeof fetch;
}

