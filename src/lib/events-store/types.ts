/**
 * Abstract event store used by /api/events*.
 *
 * Two implementations:
 *   - prisma:  rows in the CalendarEvent table (FC's original default).
 *   - vault:   one Markdown file per event under CALENDAR_VAULT_PATH,
 *              YAML frontmatter carries the structured data, the body
 *              is free text the user can edit (notes, links, etc).
 *
 * Which one is live at runtime is determined by the env var
 * CALENDAR_BACKEND ("prisma" | "vault"; defaults to "prisma" to keep
 * existing installs working).
 *
 * The shape here is intentionally the subset of the Prisma model that
 * the calendar UI actually reads / writes. Extra Prisma-only fields
 * (attendees, organizer, externalEventId, status, sequence, created,
 * lastModified) can be added later — both backends just need to know
 * about them.
 */

export interface EventRow {
  id: string;
  feedId: string;
  title: string;
  description: string | null;
  start: string; // ISO 8601
  end: string;   // ISO 8601
  allDay: boolean;
  location: string | null;
  isRecurring: boolean;
  recurrenceRule: string | null;
  /** Server-side updatedAt. Stored in the frontmatter as an ISO string
   *  so the If-Match round-trip keeps working in vault mode. */
  updatedAt: string;
  /** Joined feed meta — calendars render colour + label from this.
   *  Populated by the store on read. */
  feed?: { name: string; color: string };
}

export interface ListFilter {
  userId: string;
  since?: Date | null;
}

export interface EventStore {
  list(filter: ListFilter): Promise<EventRow[]>;
  get(userId: string, id: string): Promise<EventRow | null>;
  create(userId: string, input: Omit<EventRow, "id" | "updatedAt" | "feed">): Promise<EventRow>;
  update(
    userId: string,
    id: string,
    patch: Partial<Omit<EventRow, "id" | "feedId" | "updatedAt" | "feed">>,
    ifMatch?: string | null
  ): Promise<{ ok: true; row: EventRow } | { ok: false; reason: "not-found" | "precondition-failed"; current?: EventRow }>;
  remove(
    userId: string,
    id: string,
    ifMatch?: string | null
  ): Promise<{ ok: true } | { ok: false; reason: "not-found" | "precondition-failed"; current?: EventRow }>;
}

export type CalendarBackend = "prisma" | "vault";

export function getBackend(): CalendarBackend {
  const v = (process.env.CALENDAR_BACKEND ?? "prisma").toLowerCase();
  return v === "vault" ? "vault" : "prisma";
}
