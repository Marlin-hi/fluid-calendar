/**
 * Drains the pending-writes queue against the real server.
 *
 * Trigger points:
 *   - `navigator`'s `online` event  (user's network just came back)
 *   - A periodic tick while the tab is open (30s) — covers cases where the
 *     browser missed the online event or the initial connection was flaky.
 *   - Explicit `syncPendingWrites()` call after the user queues a write
 *     while still online (rare, but possible if the network flapped mid-
 *     request and we already queued).
 *
 * Conflict model: **last-writer-wins**. If the server rejects a write
 * with a 4xx because the resource has been changed or removed server-
 * side, we still consider our intent expressed — drop the queue entry
 * rather than retry forever. 5xx responses and network errors stay in
 * the queue with an incremented attempt counter.
 *
 * ID reconciliation: when a POST succeeds the server responds with the
 * real UUID. We delete the temp `local-…` row from the events store and
 * insert the real one, so the next GET merges cleanly.
 */

import {
  deleteEvent,
  getAllEvents,
  getPendingWrites,
  type PendingWrite,
  removePendingWrite,
  updatePendingWrite,
  upsertEvent,
} from "./db";
import { isOfflineEnabled } from "./settings";

const ORIGINAL_KEY = "__fcOriginalFetch__" as const;

function originalFetch(): typeof fetch {
  const w = window as unknown as { [ORIGINAL_KEY]?: typeof fetch };
  return w[ORIGINAL_KEY] ?? window.fetch.bind(window);
}

let syncInFlight = false;

export async function syncPendingWrites(): Promise<{ drained: number; remaining: number }> {
  if (typeof window === "undefined") return { drained: 0, remaining: 0 };
  if (!isOfflineEnabled()) return { drained: 0, remaining: 0 };
  if (!navigator.onLine) return { drained: 0, remaining: 0 };
  if (syncInFlight) return { drained: 0, remaining: 0 };
  syncInFlight = true;

  let drained = 0;
  try {
    const queue = await getPendingWrites();
    const fetch = originalFetch();
    for (const write of queue) {
      try {
        const res = await fetch(write.path, {
          method: write.method,
          headers: { "content-type": "application/json" },
          body: write.body ? JSON.stringify(write.body) : undefined,
          credentials: "include",
        });
        if (res.ok) {
          await handleServerSuccess(write, res);
          if (write.id !== undefined) await removePendingWrite(write.id);
          drained++;
        } else if (res.status >= 400 && res.status < 500) {
          // last-writer-wins: server said no, but we already made the
          // local change stick. Drop the queue entry to avoid an infinite
          // retry loop and surface the local state as authoritative.
          if (write.id !== undefined) await removePendingWrite(write.id);
          drained++;
        } else {
          await markAttempt(write, `HTTP ${res.status}`);
        }
      } catch (err) {
        await markAttempt(write, err instanceof Error ? err.message : String(err));
        break; // network likely still broken — stop draining.
      }
    }
  } finally {
    syncInFlight = false;
    window.dispatchEvent(new CustomEvent("fc:pending-changed"));
  }

  const remaining = (await getPendingWrites()).length;
  return { drained, remaining };
}

async function handleServerSuccess(write: PendingWrite, res: Response): Promise<void> {
  if (write.op === "delete") {
    // Already removed from IDB at queue time. Nothing to reconcile.
    return;
  }
  try {
    const data = (await res.clone().json()) as { id?: string };
    if (!data?.id) return;

    if (write.op === "create" && write.eventId && write.eventId !== data.id) {
      // Replace the temp row with the real one so the next GET merges
      // cleanly and the UI can drop the `_pending` badge.
      await deleteEvent(write.eventId);
      await upsertEvent({ ...data, id: data.id } as { id: string });
    } else {
      await upsertEvent(data as { id: string });
    }
  } catch {
    /* response didn't parse as JSON — server changed the response shape;
     * leave IDB as-is, next GET will reconcile. */
  }
}

async function markAttempt(write: PendingWrite, errMsg: string): Promise<void> {
  if (write.id === undefined) return;
  await updatePendingWrite(write.id, {
    attempts: (write.attempts ?? 0) + 1,
    lastError: errMsg.slice(0, 200),
  });
}

/** Bootstrap listeners that push drains into the background. Call once
 *  from the OfflineProvider. Idempotent. */
let listenersInstalled = false;
export function startSyncWorker(): void {
  if (typeof window === "undefined") return;
  if (listenersInstalled) return;
  listenersInstalled = true;

  const trigger = () => {
    void syncPendingWrites();
  };

  window.addEventListener("online", trigger);
  // Gentle periodic retry for flaky networks / missed online events.
  window.setInterval(trigger, 30_000);
  // Also drain when a new write was just queued, in case we're still
  // online but landed on the queue because of a transient error.
  window.addEventListener("fc:pending-changed", trigger);

  // First kick: if the queue has stale entries from a previous session,
  // push them through as soon as the tab starts.
  trigger();
}

// Re-export via deleteEvent because the worker references only our own
// local events store — keeping the import surface small so tree-shaking
// can drop this module entirely for users with offline disabled.
export { getAllEvents };
