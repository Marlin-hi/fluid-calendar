import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { CalDAVCalendarService } from "@/lib/caldav-calendar";
import { getEvent, validateEvent } from "@/lib/calendar-db";
import { newDate } from "@/lib/date-utils";
import { getBackend, getEventStore } from "@/lib/events-store";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const LOG_SOURCE = "CalDAVEventsAPI";

// In vault mode, this whole route is a thin shim over the EventStore —
// no CalDAV server is talked to, the event lives as a Markdown file.
// The client still calls these URLs because the feed is still typed
// as CALDAV, but for the vault-backed instance that is purely a label.
const isVault = () => getBackend() === "vault";

// Create a new event
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const userId = auth.userId;

    const { feedId, ...eventData } = await request.json();

    logger.info(
      "Creating new CalDAV event",
      {
        feedId,
        title: eventData.title,
        start: new Date(eventData.start).toISOString(),
      },
      LOG_SOURCE
    );

    if (isVault()) {
      const created = await getEventStore().create(userId, {
        feedId,
        title: eventData.title,
        description: eventData.description ?? null,
        location: eventData.location ?? null,
        start: newDate(eventData.start).toISOString(),
        end: newDate(eventData.end).toISOString(),
        allDay: !!eventData.allDay,
        isRecurring: !!eventData.isRecurring,
        recurrenceRule: eventData.recurrenceRule ?? null,
      });
      return NextResponse.json(created);
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

    if (!feed || feed.type !== "CALDAV" || !feed.accountId) {
      logger.error(
        "Invalid calendar feed for CalDAV event creation",
        { feedId },
        LOG_SOURCE
      );
      return NextResponse.json(
        { error: "Invalid calendar feed" },
        { status: 400 }
      );
    }

    // Get the calendar URL (path)
    const calendarPath = feed.url;
    if (!calendarPath) {
      logger.error(
        "Missing calendar path for CalDAV event creation",
        { feedId },
        LOG_SOURCE
      );
      return NextResponse.json(
        { error: "Missing calendar path" },
        { status: 400 }
      );
    }

    // Check if account exists
    if (!feed.account) {
      logger.error(
        "Missing account for CalDAV event creation",
        { feedId },
        LOG_SOURCE
      );
      return NextResponse.json({ error: "Missing account" }, { status: 400 });
    }

    // Create CalDAV service
    const caldavService = new CalDAVCalendarService(feed.account);

    // Create event in CalDAV calendar
    const createdEvent = await caldavService.createEvent(
      calendarPath,
      {
        title: eventData.title,
        description: eventData.description,
        location: eventData.location,
        start: newDate(eventData.start),
        end: newDate(eventData.end),
        allDay: eventData.allDay,
        isRecurring: eventData.isRecurring,
        recurrenceRule: eventData.recurrenceRule,
      },
      userId
    );

    logger.info(
      "Successfully created CalDAV event",
      {
        eventId: createdEvent.id,
        feedId,
      },
      LOG_SOURCE
    );

    return NextResponse.json(createdEvent);
  } catch (error) {
    logger.error(
      "Failed to create CalDAV event",
      {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack || null : null,
      },
      LOG_SOURCE
    );
    return NextResponse.json(
      {
        error: "Failed to create event",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// Update an existing event
export async function PUT(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const userId = auth.userId;

    const { eventId, mode, ...updates } = await request.json();

    logger.info(
      "Updating CalDAV event",
      {
        eventId,
        mode,
        updates: JSON.stringify(updates),
      },
      LOG_SOURCE
    );

    if (isVault()) {
      const patch: Record<string, unknown> = {};
      if ("title" in updates) patch.title = updates.title;
      if ("description" in updates) patch.description = updates.description ?? null;
      if ("location" in updates) patch.location = updates.location ?? null;
      if ("start" in updates) patch.start = newDate(updates.start).toISOString();
      if ("end" in updates) patch.end = newDate(updates.end).toISOString();
      if ("allDay" in updates) patch.allDay = !!updates.allDay;
      if ("isRecurring" in updates) patch.isRecurring = !!updates.isRecurring;
      if ("recurrenceRule" in updates) patch.recurrenceRule = updates.recurrenceRule ?? null;

      const result = await getEventStore().update(userId, eventId, patch);
      if (!result.ok) {
        const status = result.reason === "not-found" ? 404 : 412;
        return NextResponse.json({ error: result.reason }, { status });
      }
      return NextResponse.json(result.row);
    }

    // Get the event from the database
    const event = await getEvent(eventId);
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Check if the event belongs to a feed owned by the current user
    if (event.feed.userId !== userId) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const validatedEvent = await validateEvent(event, "CALDAV");

    if (validatedEvent instanceof NextResponse) {
      return validatedEvent;
    }

    // Get the calendar path
    const calendarPath =
      validatedEvent.feed.url || validatedEvent.feed.caldavPath;
    if (!calendarPath) {
      return NextResponse.json(
        { error: "No CalDAV calendar path found" },
        { status: 400 }
      );
    }

    // Get the account
    const account = await prisma.connectedAccount.findUnique({
      where: {
        id: validatedEvent.feed.accountId,
        userId,
      },
    });

    if (!account) {
      logger.error(
        "Account not found for CalDAV event update",
        { eventId },
        LOG_SOURCE
      );
      return NextResponse.json({ error: "Account not found" }, { status: 400 });
    }

    // Create CalDAV service
    const caldavService = new CalDAVCalendarService(account);

    // Update the event in CalDAV
    const updatedEvent = await caldavService.updateEvent(
      event,
      calendarPath,
      validatedEvent.externalEventId,
      {
        title: updates.title || validatedEvent.title,
        description: updates.description ?? validatedEvent.description,
        location: updates.location ?? validatedEvent.location,
        start: updates.start ? newDate(updates.start) : validatedEvent.start,
        end: updates.end ? newDate(updates.end) : validatedEvent.end,
        allDay: updates.allDay ?? validatedEvent.allDay,
        isRecurring: updates.isRecurring ?? validatedEvent.isRecurring,
        recurrenceRule: updates.recurrenceRule ?? validatedEvent.recurrenceRule,
      },
      "series", //todo: implement editing a single instance correctly.
      userId
    );

    logger.info(
      "Successfully updated CalDAV event",
      {
        eventId,
      },
      LOG_SOURCE
    );

    return NextResponse.json(updatedEvent);
  } catch (error) {
    logger.error(
      "Failed to update CalDAV event",
      {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack || null : null,
      },
      LOG_SOURCE
    );
    return NextResponse.json(
      {
        error: "Failed to update event",
        details: error instanceof Error ? error.message : "Unknown error",
      },
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

    const { eventId, mode } = await request.json();

    logger.info(
      "Deleting CalDAV event",
      {
        eventId,
        mode,
      },
      LOG_SOURCE
    );

    if (isVault()) {
      const result = await getEventStore().remove(userId, eventId);
      if (!result.ok) {
        const status = result.reason === "not-found" ? 404 : 412;
        return NextResponse.json({ error: result.reason }, { status });
      }
      return NextResponse.json({ success: true });
    }

    // Get the event from the database
    const event = await getEvent(eventId);
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Check if the event belongs to a feed owned by the current user
    if (event.feed.userId !== userId) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const validatedEvent = await validateEvent(event, "CALDAV");

    if (validatedEvent instanceof NextResponse) {
      return validatedEvent;
    }

    // Get the calendar path
    const calendarPath =
      validatedEvent.feed.url || validatedEvent.feed.caldavPath;
    if (!calendarPath) {
      return NextResponse.json(
        { error: "No CalDAV calendar path found" },
        { status: 400 }
      );
    }

    // Get the account
    const account = await prisma.connectedAccount.findUnique({
      where: {
        id: validatedEvent.feed.accountId,
        userId,
      },
    });

    if (!account) {
      logger.error(
        "Account not found for CalDAV event deletion",
        { eventId },
        LOG_SOURCE
      );
      return NextResponse.json({ error: "Account not found" }, { status: 400 });
    }

    // Create CalDAV service
    const caldavService = new CalDAVCalendarService(account);

    // Delete the event from CalDAV
    await caldavService.deleteEvent(
      event,
      calendarPath,
      validatedEvent.externalEventId,
      mode || "single",
      userId
    );

    logger.info(
      "Successfully deleted CalDAV event",
      {
        eventId,
      },
      LOG_SOURCE
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(
      "Failed to delete CalDAV event",
      {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack || null : null,
      },
      LOG_SOURCE
    );
    return NextResponse.json(
      {
        error: "Failed to delete event",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
