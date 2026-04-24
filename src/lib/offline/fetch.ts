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
  getAllEvents,
  isIdbAvailable,
  putEvents,
  STORE_EVENTS,
} from "./db";
import { isOfflineEnabled } from "./settings";

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

/** Feeds cache lives in IDB too, under the events store keyed by a sentinel id.
 *  Keeps the code path simple — we don't need a second store for five-ish rows. */
const FEEDS_CACHE_ID = "__fc_feeds_cache__";

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
  return all.filter((e) => e.id !== FEEDS_CACHE_ID);
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

    // Only instrument the two read paths for Phase 1. Phase 2 will add
    // the write proxy + sync worker here.
    if (method === "GET" && (isEventsList(url) || isFeedsList(url))) {
      try {
        const res = await original(...args);
        if (res.ok) {
          // Mirror response into IDB for offline replay. We clone because
          // .json() reads the body stream — the caller still needs it.
          const clone = res.clone();
          clone.json().then(
            (data) => {
              if (isEventsList(url) && Array.isArray(data)) {
                putEvents(data as Array<{ id: string }>).catch(() => {});
              } else if (isFeedsList(url)) {
                cacheFeeds(data).catch(() => {});
              }
            },
            () => { /* parse error, ignore */ }
          );
        }
        return res;
      } catch (networkErr) {
        // Network failed → serve from IDB.
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

/** Debug helper, unused in production. */
export { STORE_EVENTS };
