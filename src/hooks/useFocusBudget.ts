import { useMemo } from "react";

import { endOfWeek, startOfWeek } from "date-fns";
import { RRule } from "rrule";

import { newDate } from "@/lib/date-utils";

import { useCalendarStore } from "@/store/calendar";
import { useSettingsStore } from "@/store/settings";

import { CalendarEvent } from "@/types/calendar";

export type FocusBudgetState = "ok" | "low" | "high" | "disabled";

export interface FocusBudgetResult {
  enabled: boolean;
  configured: boolean;
  usedHours: number;
  targetHours: number;
  toleranceHours: number;
  state: FocusBudgetState;
  weekStart: Date;
  weekEnd: Date;
}

function minutesInWeek(
  event: CalendarEvent,
  weekStart: Date,
  weekEnd: Date
): number {
  const start = event.start instanceof Date ? event.start : newDate(event.start);
  const end = event.end instanceof Date ? event.end : newDate(event.end);

  const overlapStart = start > weekStart ? start : weekStart;
  const overlapEnd = end < weekEnd ? end : weekEnd;
  if (overlapEnd <= overlapStart) return 0;

  return (overlapEnd.getTime() - overlapStart.getTime()) / 60000;
}

function expandRecurringMinutes(
  event: CalendarEvent,
  weekStart: Date,
  weekEnd: Date
): number {
  if (!event.recurrenceRule) return 0;
  const start = event.start instanceof Date ? event.start : newDate(event.start);
  const end = event.end instanceof Date ? event.end : newDate(event.end);
  const durationMs = end.getTime() - start.getTime();
  if (durationMs <= 0) return 0;

  try {
    const options = RRule.parseString(event.recurrenceRule);
    const rule = new RRule({ ...options, dtstart: start });
    const occurrences = rule.between(weekStart, weekEnd, true);
    let total = 0;
    for (const occ of occurrences) {
      const occStart = occ;
      const occEnd = new Date(occ.getTime() + durationMs);
      const os = occStart > weekStart ? occStart : weekStart;
      const oe = occEnd < weekEnd ? occEnd : weekEnd;
      if (oe > os) {
        total += (oe.getTime() - os.getTime()) / 60000;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export function useFocusBudget(): FocusBudgetResult {
  const focusBudget = useSettingsStore((s) => s.focusBudget);
  const weekStartDay = useSettingsStore((s) => s.user.weekStartDay);
  const events = useCalendarStore((s) => s.events);

  return useMemo(() => {
    const weekStartsOn = weekStartDay === "monday" ? 1 : 0;
    const now = newDate();
    const weekStart = startOfWeek(now, { weekStartsOn });
    const weekEnd = endOfWeek(now, { weekStartsOn });

    if (!focusBudget.enabled || !focusBudget.feedId) {
      return {
        enabled: focusBudget.enabled,
        configured: Boolean(focusBudget.feedId),
        usedHours: 0,
        targetHours: focusBudget.targetHours,
        toleranceHours: focusBudget.toleranceHours,
        state: "disabled" as FocusBudgetState,
        weekStart,
        weekEnd,
      };
    }

    const focusFeedId = focusBudget.feedId;
    let totalMinutes = 0;

    for (const event of events) {
      if (event.feedId !== focusFeedId) continue;
      if (event.allDay) continue;
      if (event.masterEventId) continue;

      if (event.isRecurring && event.recurrenceRule) {
        totalMinutes += expandRecurringMinutes(event, weekStart, weekEnd);
      } else {
        totalMinutes += minutesInWeek(event, weekStart, weekEnd);
      }
    }

    const usedHours = totalMinutes / 60;
    const { targetHours, toleranceHours } = focusBudget;

    let state: FocusBudgetState;
    if (usedHours < targetHours - toleranceHours) {
      state = "low";
    } else if (usedHours > targetHours + toleranceHours) {
      state = "high";
    } else {
      state = "ok";
    }

    return {
      enabled: true,
      configured: true,
      usedHours,
      targetHours,
      toleranceHours,
      state,
      weekStart,
      weekEnd,
    };
  }, [events, focusBudget, weekStartDay]);
}
