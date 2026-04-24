/**
 * Prisma-backed implementation of EventStore. Thin wrapper around the
 * existing CalendarEvent table — semantically identical to what the
 * original /api/events route did inline. Kept here so both backends
 * speak the same interface and the API route can stay boring.
 */

import { prisma } from "@/lib/prisma";

import type { EventRow, EventStore } from "./types";

type PrismaRow = Awaited<ReturnType<typeof prisma.calendarEvent.findMany>>[number] & {
  feed?: { name: string | null; color: string | null } | null;
};

function toRow(r: PrismaRow): EventRow {
  return {
    id: r.id,
    feedId: r.feedId,
    title: r.title,
    description: r.description,
    start: r.start.toISOString(),
    end: r.end.toISOString(),
    allDay: r.allDay,
    location: r.location,
    isRecurring: r.isRecurring,
    recurrenceRule: r.recurrenceRule,
    updatedAt: r.updatedAt.toISOString(),
    feed: r.feed
      ? { name: r.feed.name ?? "", color: r.feed.color ?? "" }
      : undefined,
  };
}

export const prismaStore: EventStore = {
  async list({ userId, since }) {
    const events = await prisma.calendarEvent.findMany({
      where: {
        feed: { userId },
        ...(since ? { updatedAt: { gt: since } } : {}),
      },
      include: { feed: { select: { name: true, color: true } } },
    });
    return events.map(toRow);
  },

  async get(userId, id) {
    const ev = await prisma.calendarEvent.findUnique({
      where: { id },
      include: { feed: true },
    });
    if (!ev || ev.feed.userId !== userId) return null;
    return toRow(ev);
  },

  async create(userId, input) {
    const feed = await prisma.calendarFeed.findUnique({ where: { id: input.feedId } });
    if (!feed || feed.userId !== userId) throw new Error("feed not found");
    const ev = await prisma.calendarEvent.create({
      data: {
        feedId: input.feedId,
        title: input.title,
        description: input.description ?? null,
        start: new Date(input.start),
        end: new Date(input.end),
        location: input.location ?? null,
        isRecurring: input.isRecurring,
        recurrenceRule: input.recurrenceRule ?? null,
        allDay: input.allDay,
      },
      include: { feed: { select: { name: true, color: true } } },
    });
    return toRow(ev);
  },

  async update(userId, id, patch, ifMatch) {
    const existing = await prisma.calendarEvent.findUnique({
      where: { id },
      include: { feed: true },
    });
    if (!existing || existing.feed.userId !== userId) return { ok: false, reason: "not-found" };
    if (ifMatch && ifMatch !== existing.updatedAt.toISOString()) {
      return { ok: false, reason: "precondition-failed", current: toRow(existing as PrismaRow) };
    }
    const row = await prisma.calendarEvent.update({
      where: { id },
      data: {
        title: patch.title,
        description: patch.description,
        start: patch.start ? new Date(patch.start) : undefined,
        end: patch.end ? new Date(patch.end) : undefined,
        location: patch.location,
        isRecurring: patch.isRecurring,
        recurrenceRule: patch.recurrenceRule,
        allDay: patch.allDay,
      },
      include: { feed: { select: { name: true, color: true } } },
    });
    return { ok: true, row: toRow(row) };
  },

  async remove(userId, id, ifMatch) {
    const existing = await prisma.calendarEvent.findUnique({
      where: { id },
      include: { feed: true },
    });
    if (!existing || existing.feed.userId !== userId) return { ok: false, reason: "not-found" };
    if (ifMatch && ifMatch !== existing.updatedAt.toISOString()) {
      return { ok: false, reason: "precondition-failed", current: toRow(existing as PrismaRow) };
    }
    await prisma.calendarEvent.delete({ where: { id } });
    return { ok: true };
  },
};
