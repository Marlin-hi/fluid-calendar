import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { getEventStore } from "@/lib/events-store";
import { logger } from "@/lib/logger";

const LOG_SOURCE = "events-route";

/**
 * List all calendar events for the authenticated user.
 *
 * Supports `?since=<iso>` for incremental sync. The response carries an
 * `X-Sync-Ts` header; clients should store that (not max(updatedAt) from
 * the rows) as their next `since` cursor to avoid missing writes saved
 * in the same ms as the query.
 *
 * The data source is abstracted behind EventStore so either the Prisma
 * DB or a vault (markdown files under CALENDAR_VAULT_PATH) can back the
 * calendar without changing any route code. Pick via CALENDAR_BACKEND=
 * "prisma" | "vault". See src/lib/events-store.
 *
 * Deletes aren't yet represented in the delta stream — clients should
 * fall back to a full list-fetch periodically (on app launch is enough
 * in practice) so server-side deletes converge.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;

    const url = new URL(request.url);
    const sinceParam = url.searchParams.get("since");
    let sinceDate: Date | null = null;
    if (sinceParam) {
      const parsed = new Date(sinceParam);
      if (!Number.isNaN(parsed.getTime())) sinceDate = parsed;
    }

    const store = getEventStore();
    const events = await store.list({ userId: auth.userId, since: sinceDate });

    logger.debug(
      sinceDate
        ? `Delta fetch since ${sinceDate.toISOString()} → ${events.length} events`
        : `Full fetch → ${events.length} events`,
      {},
      LOG_SOURCE
    );

    const res = NextResponse.json(events);
    res.headers.set("X-Sync-Ts", new Date().toISOString());
    return res;
  } catch (error) {
    logger.error(
      "Failed to fetch events:",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;

    const input = await request.json();
    const { feedId, title, start, end } = input ?? {};
    if (!feedId || !title || !start || !end) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const store = getEventStore();
    const row = await store.create(auth.userId, {
      feedId,
      title,
      description: input.description ?? null,
      start,
      end,
      location: input.location ?? null,
      isRecurring: input.isRecurring ?? false,
      recurrenceRule: input.recurrenceRule ?? null,
      allDay: input.allDay ?? false,
    });
    const res = NextResponse.json(row, { status: 201 });
    res.headers.set("ETag", row.updatedAt);
    return res;
  } catch (error) {
    logger.error(
      "Failed to create event",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;

    const input = await request.json();
    if (!input?.id) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }
    const ifMatch = request.headers.get("if-match");

    const store = getEventStore();
    const result = await store.update(
      auth.userId,
      String(input.id),
      {
        title: input.title,
        description: input.description,
        start: input.start,
        end: input.end,
        location: input.location,
        isRecurring: input.isRecurring,
        recurrenceRule: input.recurrenceRule,
        allDay: input.allDay,
      },
      ifMatch
    );
    if (!result.ok) {
      if (result.reason === "not-found") {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Precondition failed", current: result.current },
        { status: 412 }
      );
    }
    const res = NextResponse.json(result.row);
    res.headers.set("ETag", result.row.updatedAt);
    return res;
  } catch (error) {
    logger.error(
      "Failed to update event",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;

    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }
    const ifMatch = request.headers.get("if-match");

    const store = getEventStore();
    const result = await store.remove(auth.userId, String(id), ifMatch);
    if (!result.ok) {
      if (result.reason === "not-found") {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Precondition failed", current: result.current },
        { status: 412 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(
      "Failed to delete event",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json({ error: "Failed to delete event" }, { status: 500 });
  }
}
