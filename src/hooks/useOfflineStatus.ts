"use client";

import { useEffect, useState } from "react";

import {
  countPending,
  type PendingWrite,
} from "@/lib/offline/db";
import {
  isOfflineEnabled,
  subscribeOfflineEnabled,
} from "@/lib/offline/settings";

/**
 * One-stop state for the UI's offline affordances:
 *   - `offlineEnabled`  the user's feature-flag choice (default false).
 *                       When false, all other fields stay at their no-op
 *                       defaults and we never touch IDB / the queue.
 *   - `online`          navigator.onLine + online/offline events. Note
 *                       that the browser's own signal is famously lazy on
 *                       desktop (doesn't fire for captive portals etc.);
 *                       the sync worker supplements this with its own
 *                       "reachability" pings.
 *   - `pendingCount`    number of mutations queued for sync. Refreshed on
 *                       a custom `fc:pending-changed` event that the
 *                       write-proxy fires after every queue operation,
 *                       plus on `online`.
 */
export function useOfflineStatus() {
  const [offlineEnabled, setOfflineEnabledState] = useState(false);
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    setOfflineEnabledState(isOfflineEnabled());
    if (typeof navigator !== "undefined") {
      setOnline(navigator.onLine);
    }

    const unsubSetting = subscribeOfflineEnabled(setOfflineEnabledState);

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    let stillMounted = true;
    const refreshCount = () => {
      countPending()
        .then((n) => {
          if (stillMounted) setPendingCount(n);
        })
        .catch(() => {
          /* IDB not available; leave at 0 */
        });
    };
    refreshCount();
    const onPendingChanged = () => refreshCount();
    window.addEventListener("fc:pending-changed", onPendingChanged);

    return () => {
      stillMounted = false;
      unsubSetting();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("fc:pending-changed", onPendingChanged);
    };
  }, []);

  return { offlineEnabled, online, pendingCount };
}

/** Helper: fire from the write-proxy after every queue enqueue/drain. */
export function emitPendingChanged(_reason?: PendingWrite["op"]): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("fc:pending-changed"));
}
