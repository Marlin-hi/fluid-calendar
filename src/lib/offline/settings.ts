/**
 * Feature flag for offline mode. Default: off.
 *
 * Persisted in localStorage rather than the Prisma user-settings table so
 * an offline user can turn it on without round-tripping to the server.
 * When we later surface this in the Settings UI we'll mirror it into the
 * user-settings store too, but this localStorage key remains the source of
 * truth for the client runtime.
 *
 * Key shape is versioned so we can tighten / loosen defaults later without
 * stale preferences lingering.
 */

const KEY = "fc.offline.enabled.v1";

export function isOfflineEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

export function setOfflineEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, enabled ? "true" : "false");
    window.dispatchEvent(new CustomEvent("fc:offline-setting-changed", { detail: enabled }));
  } catch {
    // Private-mode Safari / storage disabled — silent: the rest of the app
    // just sees the default (off).
  }
}

export function subscribeOfflineEnabled(listener: (enabled: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const ce = e as CustomEvent<boolean>;
    listener(Boolean(ce.detail));
  };
  window.addEventListener("fc:offline-setting-changed", handler);
  return () => window.removeEventListener("fc:offline-setting-changed", handler);
}
