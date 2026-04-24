import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { newDate } from "@/lib/date-utils";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const LOG_SOURCE = "events-route";

// List all calendar events
//
// Supports an incremental-sync query `?since=<iso>`: when present, only
// events whose updatedAt is strictly greater than `since` are returned.
// Clients track the highest updatedAt they've seen (the "sync token")
// and pass it on subsequent polls to avoid re-downloading the whole
// calendar every time.
//
// The response sets an `X-Sync-Ts` header with the server's current
// timestamp. Clients should store that (not the max(updatedAt) from the
// rows) as their next `since` — otherwise a row that was saved in the
// same millisecond as the query would be skipped on the next delta.
//
// Deletes aren't yet represented in the delta stream (no tombstone
// table). Clients should fall back to a full list-fetch periodically —
// e.g. on app launch — so server-side deletes converge.
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const userId = auth.userId;

    const url = new URL(request.url);
    const sinceParam = url.searchParams.get("since");
    let sinceDate: Date | null = null;
    if (sinceParam) {
      const parsed = new Date(sinceParam);
      if (!Number.isNaN(parsed.getTime())) sinceDate = parsed;
    }

    logger.debug(
      sinceDate ? `Fetching delta since ${sinceDate.toISOString()}` : "Fetching all events",
      {},
      LOG_SOURCE
    );

    const events = await prisma.calendarEvent.findMany({
      where: {
        feed: { userId },
        ...(sinceDate ? { updatedAt: { gt: sinceDate } } : {}),
      },
      include: {
        feed: {
          select: {
            name: true,
            color: true,
          },
        },
      },
    });

    logger.debug(`Returning ${events.length} events`, {}, LOG_SOURCE);

    const res = NextResponse.json(events);
    // The sync cursor for the next poll — use the server's 'now' rather
    // than the max(updatedAt) to avoid missing rows saved within the
    // same ms window as this query.
    res.headers.set("X-Sync-Ts", new Date().toISOString());
    return res;
  } catch (error) {
    logger.error(
      "Failed to fetch events:",
      {
        error: error instanceof Error ? error.message : String(error),
      },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }
}

// Create a new event
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const userId = auth.userId;

    const {
      feedId,
      title,
      description,
      start,
      end,
      location,
      isRecurring,
      recurrenceRule,
      allDay,
    } = await request.json();

    if (!feedId || !title || !start || !end) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Check if the feed belongs to the current user
    const feed = await prisma.calendarFeed.findUnique({
      where: {
        id: feedId,
        userId,
      },
      include: {
        account: true,
      },
    });

    if (!feed) {
      return NextResponse.json(
        {
          error:
            "Calendar feed not found or you don't have permission to access it",
        },
        { status: 404 }
      );
    }

    // Create event in database
    const event = await prisma.calendarEvent.create({
      data: {
        feedId,
        title,
        description,
        start: newDate(start),
        end: newDate(end),
        location,
        isRecurring: isRecurring || false,
        recurrenceRule,
        allDay: allDay || false,
      },
    });

    const res = NextResponse.json(event, { status: 201 });
    res.headers.set("ETag", event.updatedAt.toISOString());
    return res;
  } catch (error) {
    logger.error(
      "Failed to create calendar event:",
      {
        error: error instanceof Error ? error.message : String(error),
      },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to create calendar event" },
      { status: 500 }
    );
  }
}

// Update an event
//
// Optimistic concurrency: if the caller sends `If-Match: <iso-ts>`, we
// compare it against the current row's updatedAt. A mismatch means
// someone else changed the event since the client last read it, and we
// respond 412 Precondition Failed with the current server version so
// the client can offer a merge UI or apply its last-writer-wins policy.
export async function PATCH(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const userId = auth.userId;

    const {
      id,
      title,
      description,
      start,
      end,
      location,
      isRecurring,
      recurrenceRule,
      allDay,
    } = await request.json();

    if (!id) {
      return NextResponse.json(
        { error: "Event ID is required" },
        { status: 400 }
      );
    }

    // Check if the event belongs to a feed owned by the current user
    const existingEvent = await prisma.calendarEvent.findUnique({
      where: { id },
      include: {
        feed: true,
      },
    });

    if (!existingEvent || existingEvent.feed.userId !== userId) {
      return NextResponse.json(
        { error: "Event not found or you don't have permission to update it" },
        { status: 404 }
      );
    }

    const ifMatch = request.headers.get("if-match");
    if (ifMatch && ifMatch !== existingEvent.updatedAt.toISOString()) {
      return NextResponse.json(
        { error: "Precondition failed", current: existingEvent },
        { status: 412 }
      );
    }

    const event = await prisma.calendarEvent.update({
      where: { id },
      data: {
        title,
        description,
        start: start ? newDate(start) : undefined,
        end: end ? newDate(end) : undefined,
        location,
        isRecurring,
        recurrenceRule,
        allDay,
      },
    });

    const res = NextResponse.json(event);
    res.headers.set("ETag", event.updatedAt.toISOString());
    return res;
  } catch (error) {
    logger.error(
      "Failed to update calendar event:",
      {
        error: error instanceof Error ? error.message : String(error),
      },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to update calendar event" },
      { status: 500 }
    );
  }
}

// Delete an event
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const userId = auth.userId;

    const { id } = await request.json();

    if (!id) {
      return NextResponse.json(
        { error: "Event ID is required" },
        { status: 400 }
      );
    }

    // Check if the event belongs to a feed owned by the current user
    const existingEvent = await prisma.calendarEvent.findUnique({
      where: { id },
      include: {
        feed: true,
      },
    });

    if (!existingEvent || existingEvent.feed.userId !== userId) {
      return NextResponse.json(
        { error: "Event not found or you don't have permission to delete it" },
        { status: 404 }
      );
    }

    const ifMatch = request.headers.get("if-match");
    if (ifMatch && ifMatch !== existingEvent.updatedAt.toISOString()) {
      return NextResponse.json(
        { error: "Precondition failed", current: existingEvent },
        { status: 412 }
      );
    }

    await prisma.calendarEvent.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(
      "Failed to delete calendar event:",
      {
        error: error instanceof Error ? error.message : String(error),
      },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to delete calendar event" },
      { status: 500 }
    );
  }
}
