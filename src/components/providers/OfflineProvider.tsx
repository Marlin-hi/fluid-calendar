"use client";

import { useEffect } from "react";

import { installOfflineFetchPatch } from "@/lib/offline/fetch";
import { startSyncWorker } from "@/lib/offline/syncWorker";

/**
 * Mount-time hook for the offline-mode runtime. Kept as its own client
 * provider so the fetch monkey-patch runs exactly once during hydration
 * and stays out of the server bundle.
 *
 * We install the patch unconditionally at mount: the patch itself early-
 * returns to a plain `original(...)` when the feature flag is off, so
 * there's no runtime cost for users who don't opt in. Installing
 * unconditionally means that flipping the flag on at runtime (via the
 * Settings UI) immediately takes effect for the next fetch, without
 * reload.
 *
 * The sync worker also runs unconditionally — it early-returns inside
 * syncPendingWrites() when the flag is off, and its listeners are cheap.
 */
export function OfflineProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    installOfflineFetchPatch();
    startSyncWorker();
  }, []);
  return <>{children}</>;
}
