/**
 * Event store factory. Picks the backend once per process based on
 * CALENDAR_BACKEND. API routes always talk to `getEventStore()` so the
 * read/write path is identical regardless of where the data lives.
 */

import { prismaStore } from "./prisma";
import { getBackend } from "./types";
import { vaultStore } from "./vault";

export type { EventRow, EventStore, ListFilter } from "./types";

let cached: ReturnType<typeof resolve> | null = null;

function resolve() {
  return getBackend() === "vault" ? vaultStore : prismaStore;
}

export function getEventStore() {
  if (!cached) cached = resolve();
  return cached;
}
