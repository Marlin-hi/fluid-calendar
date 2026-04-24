"use client";

/**
 * MobileTimeline — the calendar grid we render on narrow viewports.
 *
 * This is NOT FullCalendar. Desktop (>=768px) uses FullCalendar via
 * `WeekView.tsx`; on mobile we render a bespoke horizontally-scrollable
 * timeline here. `Calendar.tsx` switches between the two based on viewport
 * width. Keep that fork in mind when changing event styling or interaction —
 * a change in one path does not reach the other.
 *
 * Geometry: each day is a flex column of `DAY_WIDTH_VW` vh-wide; the canvas
 * renders `DAYS_BEFORE + 1 + DAYS_AFTER` days preloaded so horizontal
 * swipe/scroll feels infinite. Times are positioned with `HOUR_HEIGHT` px
 * per hour. Overlapping timed events are split into lanes by `assignLanes()`
 * (see below) so they stay individually tappable.
 */

import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { useCalendarStore } from "@/store/calendar";
import { hexToGlass } from "@/lib/utils";
import { CalendarEvent } from "@/types/calendar";
import { EventModal } from "./EventModal";
import { EventQuickView } from "./EventQuickView";

interface MobileTimelineProps {
  currentDate: Date;
  onDateChange?: (date: Date) => void;
}

const HOUR_HEIGHT = 48;
const DAY_WIDTH_VW = 33;
const DAYS_BEFORE = 30; // 1 month before
const DAYS_AFTER = 60; // 2 months after
const TOTAL_DAYS = DAYS_BEFORE + 1 + DAYS_AFTER; // 91
const VISIBLE_HOURS = 32; // 00:00 to 08:00 next day
const HOURS = Array.from({ length: VISIBLE_HOURS }, (_, i) => i);

function getDayStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDaysUtil(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDayHeader(date: Date): string {
  const days = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  return `${days[date.getDay()]} ${date.getDate()}.${date.getMonth() + 1}`;
}

function formatHour(hour: number): string {
  const h = hour % 24;
  return `${h.toString().padStart(2, "0")}:00`;
}

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  );
}

/**
 * Positioned event ready for render. Geometry is in two layers:
 *  - vertical: top/height in pixels (time-to-y at HOUR_HEIGHT per hour)
 *  - horizontal: leftPct/widthPct are percentages of the day column, computed
 *    by `assignLanes()` below to split overlapping timed events into columns
 *    ("lanes"). zIndex makes shorter events paint on top of longer ones when
 *    fully contained.
 */
interface PositionedEvent {
  event: CalendarEvent;
  top: number;
  height: number;
  color: string;
  isAllDay: boolean;
  leftPct: number;
  widthPct: number;
  zIndex: number;
}

/**
 * Split overlapping timed events into lanes so all concurrent events stay
 * visible (matches FullCalendar's behaviour on desktop). Algorithm:
 *
 *   1. Sort by start asc, then duration desc. Longer events at the same
 *      start time claim the leftmost lane; shorter ones land further right.
 *   2. Scan in order and greedily place each event into the lowest-indexed
 *      lane whose previous event has already ended.
 *   3. Within each overlap cluster, derive leftPct/widthPct from the cluster's
 *      lane count. Events in different clusters render independently and each
 *      take the full column width.
 *   4. zIndex follows the lane index: events in higher (right-hand) lanes are
 *      painted on top. With the chosen sort, shorter events that sit inside a
 *      longer one end up on the right AND on top — the behaviour Marlin asked
 *      for ("das Kürzere immer on top, on top und rechts davon").
 *
 * Mutates the input array in place (sets leftPct/widthPct/zIndex on each
 * timed event). All-day events are skipped — they live in their own row above.
 */
function assignLanes(events: PositionedEvent[]): void {
  const timed = events.filter((e) => !e.isAllDay);
  if (timed.length === 0) return;

  timed.sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top;
    return b.height - a.height; // longer first at equal start
  });

  type WithLane = PositionedEvent & { _lane: number };
  let cluster: WithLane[] = [];
  let clusterMaxEnd = -Infinity;

  const finalise = (group: WithLane[]) => {
    if (group.length === 0) return;
    const lanes = Math.max(...group.map((g) => g._lane)) + 1;
    for (const e of group) {
      e.leftPct = (e._lane / lanes) * 100;
      e.widthPct = (1 / lanes) * 100;
      e.zIndex = 10 + e._lane;
    }
  };

  for (const raw of timed) {
    const e = raw as WithLane;
    const end = e.top + e.height;
    // A new cluster starts once we hit an event that begins at or after the
    // latest end we've seen so far — nothing in the previous cluster still
    // conflicts with it.
    if (e.top >= clusterMaxEnd) {
      finalise(cluster);
      cluster = [];
      clusterMaxEnd = -Infinity;
    }
    // Greedy: lowest free lane within this cluster.
    let lane = 0;
    const laneEnds: number[] = [];
    for (const other of cluster) laneEnds[other._lane] = Math.max(laneEnds[other._lane] ?? -Infinity, other.top + other.height);
    while (laneEnds[lane] !== undefined && laneEnds[lane] > e.top) lane++;
    e._lane = lane;
    cluster.push(e);
    clusterMaxEnd = Math.max(clusterMaxEnd, end);
  }
  finalise(cluster);
}

export function MobileTimeline({ currentDate, onDateChange }: MobileTimelineProps) {
  const { feeds, getAllCalendarItems } = useCalendarStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const allDayRef = useRef<HTMLDivElement>(null);
  const lastScrollLeft = useRef(0);
  const rafId = useRef(0);
  const mountedRef = useRef(false);

  // Event creation
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedEndDate, setSelectedEndDate] = useState<Date>();
  const [selectedEvent, setSelectedEvent] = useState<Partial<CalendarEvent>>();
  const [quickViewItem, setQuickViewItem] = useState<CalendarEvent>();
  const [clickedElement, setClickedElement] = useState<HTMLElement | null>(null);

  const handleEventClick = useCallback((event: CalendarEvent, el: HTMLElement) => {
    setClickedElement(el);
    setQuickViewItem(event);
  }, []);

  const handleQuickViewClose = useCallback(() => {
    setQuickViewItem(undefined);
    setClickedElement(null);
  }, []);

  const handleQuickViewEdit = useCallback(() => {
    if (!quickViewItem) return;
    setSelectedEvent(quickViewItem);
    setSelectedDate(new Date(quickViewItem.start));
    setSelectedEndDate(new Date(quickViewItem.end));
    setQuickViewItem(undefined);
    setIsEventModalOpen(true);
  }, [quickViewItem]);

  const handleQuickViewDelete = useCallback(async () => {
    if (!quickViewItem) return;
    const store = useCalendarStore.getState();
    await store.removeEvent(
      quickViewItem.id,
      quickViewItem.isRecurring ? "series" : "single"
    );
    setQuickViewItem(undefined);
  }, [quickViewItem]);

  /**
   * Long-press + drag interaction for creating new events.
   *
   * Why long-press? A quick tap on an empty slot shouldn't surprise-create an
   * event — too easy to hit while scrolling. Instead the user has to press
   * and hold for ~400ms. Once the press is "armed", a one-hour ghost block
   * appears at finger position and follows the finger vertically (snapped to
   * 15-min slots) until release. Release opens the normal event-create
   * dialog with the chosen start time prefilled and the title defaulting to
   * "Block". Tapping an existing event still goes through handleEventClick
   * (separate onClick on the event div with stopPropagation).
   *
   * State:
   *   previewState == null           → no interaction in progress
   *   previewState.armed === false   → finger down, waiting for the 400ms threshold
   *   previewState.armed === true    → ghost block visible, following finger
   */
  interface PreviewState {
    day: Date;
    dayIndex: number;
    startHour: number;      // originally-touched hour (snapped to 15min)
    currentHour: number;    // live hour while dragging
    armed: boolean;
    startClientY: number;
    columnTop: number;      // viewport y of the day column top
  }
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const longPressTimer = useRef<number | null>(null);

  const SNAP_MIN = 15;
  const PRESS_MS = 400;
  const CANCEL_MOVE_PX = 10; // finger travel before arming cancels the press

  const snapQuarterHour = (hour: number) => {
    const slot = SNAP_MIN / 60;
    return Math.round(hour / slot) * slot;
  };

  const openCreateModal = useCallback((day: Date, hour: number) => {
    const snapped = snapQuarterHour(hour);
    const start = new Date(day);
    start.setHours(Math.floor(snapped), Math.round((snapped % 1) * 60), 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 1);
    setSelectedDate(start);
    setSelectedEndDate(end);
    // Default title "Block" so users who don't type anything still get a
    // sensible label rather than "(No title)".
    setSelectedEvent({ allDay: false, title: "Block" } as Partial<CalendarEvent>);
    setIsEventModalOpen(true);
  }, []);

  const clearLongPressTimer = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const yToHour = (clientY: number, columnTop: number): number => {
    // getBoundingClientRect().top already reflects the current scrollTop
    // (it's viewport-relative after scroll). Adding scrollTop again was a
    // long-standing bug in this canvas — it dropped the caller ~8h too low
    // at the app's default scroll position ((now.getHours() - 2) * 48px).
    return (clientY - columnTop) / HOUR_HEIGHT;
  };

  // If the touch started on an event tile, remember it — a short tap will
  // open that event's QuickView, a long-press creates a ghost at the same
  // position (same behaviour as the empty grid). This lets the user create
  // a conflicting event by long-pressing an occupied slot.
  const touchedEvent = useRef<{ event: CalendarEvent; el: HTMLElement } | null>(null);

  const handleColumnTouchStart = (day: Date, dayIndex: number) => (e: React.TouchEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const tile = target.closest("[data-event-tile]") as HTMLElement | null;
    if (tile) {
      const id = tile.getAttribute("data-event-id");
      const ev = id ? allItems.find((x) => x.id === id) : undefined;
      touchedEvent.current = ev ? { event: ev, el: tile } : null;
    } else {
      touchedEvent.current = null;
    }

    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const hour = yToHour(touch.clientY, rect.top);

    clearLongPressTimer();
    longPressTimer.current = window.setTimeout(() => {
      setPreview({
        day,
        dayIndex,
        startHour: snapQuarterHour(hour),
        currentHour: snapQuarterHour(hour),
        armed: true,
        startClientY: touch.clientY,
        columnTop: rect.top,
      });
      longPressTimer.current = null;
    }, PRESS_MS);

    // Stash a non-armed preview so touchmove can check for cancel-travel.
    setPreview({
      day,
      dayIndex,
      startHour: snapQuarterHour(hour),
      currentHour: snapQuarterHour(hour),
      armed: false,
      startClientY: touch.clientY,
      columnTop: rect.top,
    });
  };

  const handleColumnTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!preview) return;
    const touch = e.touches[0];
    if (!preview.armed) {
      // Before the long-press fires: treat any travel as a scroll, back off.
      if (Math.abs(touch.clientY - preview.startClientY) > CANCEL_MOVE_PX) {
        clearLongPressTimer();
        setPreview(null);
      }
      return;
    }
    // Armed: drag the ghost. Prevent the scroller from eating the move.
    e.preventDefault();
    const hour = yToHour(touch.clientY, preview.columnTop);
    setPreview({ ...preview, currentHour: snapQuarterHour(hour) });
  };

  const handleColumnTouchEnd = () => {
    clearLongPressTimer();
    if (preview?.armed) {
      // Long-press released → create (even if start was on an existing event).
      openCreateModal(preview.day, preview.currentHour);
    } else if (touchedEvent.current) {
      // Short tap on an event tile → open its QuickView.
      handleEventClick(touchedEvent.current.event, touchedEvent.current.el);
    }
    touchedEvent.current = null;
    setPreview(null);
  };

  const handleColumnTouchCancel = () => {
    clearLongPressTimer();
    touchedEvent.current = null;
    setPreview(null);
  };

  // Scroll-freeze while the ghost is being dragged.
  //
  // CSS `touch-action: none` only applies to NEW touch sequences — once a
  // touch has already started and the browser has decided "this is a
  // scroll", flipping touch-action mid-gesture does nothing. So we also
  // register a native, non-passive touchmove listener on the scroller and
  // call preventDefault() while the ghost is armed. React's synthetic
  // handlers are passive by default; only a native listener can cancel
  // scroll mid-touch.
  const previewArmed = preview?.armed === true;
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onMove = (e: TouchEvent) => {
      if (previewArmed) e.preventDefault();
    };
    container.addEventListener("touchmove", onMove, { passive: false });
    return () => container.removeEventListener("touchmove", onMove);
  }, [previewArmed]);

  const handleEventModalClose = useCallback(() => {
    setIsEventModalOpen(false);
    setSelectedEvent(undefined);
    setSelectedDate(undefined);
    setSelectedEndDate(undefined);
  }, []);

  // Center date for the canvas, reset on date picker jumps
  const [canvasCenter, setCanvasCenter] = useState(() => getDayStart(currentDate));
  const lastExternalDate = useRef(getDayStart(currentDate));

  // Detect date picker jumps (>3 day difference = jump, not scroll)
  useEffect(() => {
    const newDate = getDayStart(currentDate);
    const diff = Math.abs(newDate.getTime() - lastExternalDate.current.getTime());
    const diffDays = diff / (24 * 60 * 60 * 1000);
    lastExternalDate.current = newDate;

    if (diffDays > 3 && mountedRef.current) {
      // Date picker jump: reload canvas centered on new date
      setCanvasCenter(newDate);
      mountedRef.current = false; // trigger scroll-to on next render
    }
  }, [currentDate]);

  const days = useMemo(() => {
    const result: Date[] = [];
    for (let i = -DAYS_BEFORE; i <= DAYS_AFTER; i++) {
      result.push(addDaysUtil(canvasCenter, i));
    }
    return result;
  }, [canvasCenter]);

  const rangeStart = days[0];
  const rangeEnd = addDaysUtil(days[days.length - 1], 1);
  const allItems = useMemo(
    () => getAllCalendarItems(rangeStart, rangeEnd),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getAllCalendarItems, rangeStart.getTime(), rangeEnd.getTime()]
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, PositionedEvent[]>();

    for (const day of days) {
      const key = day.toISOString().slice(0, 10);
      const dayEvents: PositionedEvent[] = [];
      const dayEnd = addDaysUtil(day, 1);

      for (const item of allItems) {
        const itemStart = new Date(item.start);
        const itemEnd = new Date(item.end);

        if (itemStart < dayEnd && itemEnd > day) {
          const feed = feeds.find((f) => f.id === item.feedId);
          const color = feed?.color || "#3b82f6";

          if (item.allDay) {
            dayEvents.push({
              event: item,
              top: 0,
              height: 24,
              color,
              isAllDay: true,
              leftPct: 0,
              widthPct: 100,
              zIndex: 10,
            });
          } else {
            const startHour = isSameDay(itemStart, day)
              ? itemStart.getHours() + itemStart.getMinutes() / 60
              : 0;
            const endHour = isSameDay(itemEnd, day)
              ? itemEnd.getHours() + itemEnd.getMinutes() / 60
              : 24;
            const top = startHour * HOUR_HEIGHT;
            const height = Math.max((endHour - startHour) * HOUR_HEIGHT, 20);
            dayEvents.push({
              event: item,
              top,
              height,
              color,
              isAllDay: false,
              leftPct: 0,
              widthPct: 100,
              zIndex: 10,
            });
          }
        }
      }
      // Split overlapping timed events into side-by-side lanes. See
      // assignLanes() above for the exact ordering / z-index behaviour.
      assignLanes(dayEvents);
      map.set(key, dayEvents);
    }
    return map;
  }, [days, allItems, feeds]);

  // Compute spanning all-day bars
  interface AllDayBar {
    event: CalendarEvent;
    startIndex: number; // index in days[]
    endIndex: number; // exclusive
    row: number;
    color: string;
  }

  const allDayBars = useMemo(() => {
    const seen = new Set<string>();
    const bars: AllDayBar[] = [];

    for (const item of allItems) {
      if (!item.allDay || seen.has(item.id)) continue;
      seen.add(item.id);

      const itemStart = getDayStart(new Date(item.start));
      const itemEnd = new Date(item.end);
      const feed = feeds.find((f) => f.id === item.feedId);
      const color = feed?.color || "#3b82f6";

      // Find start/end index in days array
      let startIdx = -1;
      let endIdx = -1;
      for (let i = 0; i < days.length; i++) {
        const dayEnd = addDaysUtil(days[i], 1);
        if (startIdx === -1 && itemEnd > days[i] && itemStart < dayEnd) {
          startIdx = i;
        }
        if (itemEnd > days[i] && itemStart < dayEnd) {
          endIdx = i + 1;
        }
      }

      if (startIdx >= 0 && endIdx > startIdx) {
        bars.push({ event: item, startIndex: startIdx, endIndex: endIdx, row: 0, color });
      }
    }

    // Assign rows (stack overlapping bars)
    bars.sort((a, b) => a.startIndex - b.startIndex || (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex));
    for (const bar of bars) {
      let row = 0;
      while (bars.some((other) => other !== bar && other.row === row &&
        other.startIndex < bar.endIndex && other.endIndex > bar.startIndex)) {
        row++;
      }
      bar.row = row;
    }

    return bars;
  }, [allItems, days, feeds]);

  const maxAllDayRows = useMemo(() => {
    let max = 0;
    for (const bar of allDayBars) {
      max = Math.max(max, bar.row + 1);
    }
    return max;
  }, [allDayBars]);

  const allDayHeight = maxAllDayRows > 0 ? maxAllDayRows * 26 + 4 : 0;

  function scrollToDate(target: Date, smooth: boolean = false) {
    const container = scrollContainerRef.current;
    if (!container) return;

    const dayWidth = container.clientWidth * (DAY_WIDTH_VW / 100);
    const diffMs = target.getTime() - canvasCenter.getTime();
    const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
    const dayIndex = DAYS_BEFORE + diffDays;

    if (dayIndex >= 0 && dayIndex < TOTAL_DAYS) {
      container.scrollTo({
        left: dayIndex * dayWidth,
        behavior: smooth ? "smooth" : ("instant" as ScrollBehavior),
      });
      lastScrollLeft.current = container.scrollLeft;
    }
  }

  // Scroll to center date on mount or canvas reload
  useEffect(() => {
    if (mountedRef.current) return;

    // Small delay to ensure DOM is ready
    requestAnimationFrame(() => {
      mountedRef.current = true;
      scrollToDate(canvasCenter, false);

      const container = scrollContainerRef.current;
      if (container) {
        const now = new Date();
        const targetTop = Math.max(0, (now.getHours() - 2) * HOUR_HEIGHT);
        container.scrollTop = targetTop;
      }
    });
  }, [canvasCenter]);

  // Scroll to date when Today button is pressed (small jumps within canvas)
  useEffect(() => {
    if (!mountedRef.current) return;
    const newDate = getDayStart(currentDate);
    const diff = Math.abs(newDate.getTime() - lastExternalDate.current.getTime());
    const diffDays = diff / (24 * 60 * 60 * 1000);
    // Only smooth-scroll for small jumps (Today button etc.), big jumps reload canvas
    if (diffDays <= 3 && diffDays > 0) {
      scrollToDate(newDate, true);
    }
  }, [currentDate]);

  // Sync header/all-day + update visible date
  const handleScroll = useCallback(() => {
    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const currentLeft = container.scrollLeft;

      // Sync header and all-day horizontally
      if (Math.abs(currentLeft - lastScrollLeft.current) > 0.5) {
        lastScrollLeft.current = currentLeft;
        if (headerRef.current) headerRef.current.scrollLeft = currentLeft;
        if (allDayRef.current) allDayRef.current.scrollLeft = currentLeft;

        // Update date display: find the leftmost fully visible day
        if (onDateChange) {
          const dayWidth = container.clientWidth * (DAY_WIDTH_VW / 100);
          const dayIndex = Math.ceil(currentLeft / dayWidth);
          if (dayIndex >= 0 && dayIndex < days.length) {
            lastExternalDate.current = days[dayIndex];
            onDateChange(days[dayIndex]);
          }
        }
      }
    });
  }, [onDateChange, days]);

  const totalWidth = `calc(48px + ${TOTAL_DAYS * DAY_WIDTH_VW}vw)`;
  const daysWidth = `${TOTAL_DAYS * DAY_WIDTH_VW}vw`;
  const gridHeight = VISIBLE_HOURS * HOUR_HEIGHT;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex border-b border-border">
        <div className="w-12 flex-none" />
        <div ref={headerRef} className="flex-1 overflow-hidden" style={{ scrollbarWidth: "none" }}>
          <div className="flex" style={{ width: daysWidth }}>
            {days.map((day) => (
              <div
                key={day.toISOString()}
                className={`flex-none border-r border-border/30 px-1 py-1.5 text-center text-xs font-medium ${
                  isToday(day) ? "bg-primary/10 text-primary" : "text-muted-foreground"
                }`}
                style={{ width: `${DAY_WIDTH_VW}vw` }}
              >
                {formatDayHeader(day)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* All-day row */}
      {allDayHeight > 0 && (
        <div className="flex border-b border-border" style={{ height: allDayHeight }}>
          <div className="w-12 flex-none text-[10px] text-muted-foreground px-1 py-0.5">ganzt.</div>
          <div ref={allDayRef} className="relative flex-1 overflow-hidden" style={{ scrollbarWidth: "none" }}>
            <div className="relative" style={{ width: daysWidth, height: allDayHeight }}>
              {/* Day column borders */}
              <div className="absolute inset-0 flex">
                {days.map((day) => (
                  <div key={day.toISOString()} className="flex-none border-r border-border/30" style={{ width: `${DAY_WIDTH_VW}vw` }} />
                ))}
              </div>
              {/* Spanning bars */}
              {allDayBars.map((bar) => (
                <div
                  key={bar.event.id}
                  className="absolute truncate rounded px-1.5 py-0.5 text-[10px] text-white font-medium cursor-pointer"
                  style={{
                    left: `${bar.startIndex * DAY_WIDTH_VW}vw`,
                    width: `${(bar.endIndex - bar.startIndex) * DAY_WIDTH_VW}vw`,
                    top: bar.row * 26 + 2,
                    height: 22,
                    backgroundColor: hexToGlass(bar.color, 0.55),
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEventClick(bar.event, e.currentTarget);
                  }}
                >
                  {bar.event.title}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main timeline */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-scroll overscroll-none"
        onScroll={handleScroll}
        style={{
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch",
          // Freeze every axis of the scroller while a ghost block is being
          // dragged. Without this the horizontal swipe-between-days or a
          // stray vertical scroll can hijack the finger and the ghost gets
          // lost. preventDefault on touchmove also helps but only works
          // reliably once touch-action has been switched off first.
          touchAction: preview?.armed ? "none" : undefined,
        }}
      >
        <div className="relative flex" style={{ width: totalWidth, height: gridHeight }}>
          {/* Time axis */}
          <div className="sticky left-0 z-10 w-12 flex-none backdrop-blur-xl bg-background/85">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className={`border-b pr-1 text-right text-[10px] text-muted-foreground ${
                  hour === 24 ? "border-border" : "border-border/20"
                }`}
                style={{ height: HOUR_HEIGHT }}
              >
                {formatHour(hour)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day, dayIndex) => {
            const key = day.toISOString().slice(0, 10);
            const dayEvents = (eventsByDay.get(key) || []).filter((e) => !e.isAllDay);
            const isPreviewColumn = preview?.armed && preview.dayIndex === dayIndex;

            return (
              <div
                key={key}
                className={`relative flex-none border-r border-border/20 ${isToday(day) ? "bg-primary/5" : ""}`}
                style={{
                  width: `${DAY_WIDTH_VW}vw`,
                  height: gridHeight,
                  // While armed, stop the scroller from hijacking the finger so
                  // the ghost block follows the drag.
                  touchAction: isPreviewColumn ? "none" : undefined,
                }}
                onTouchStart={handleColumnTouchStart(day, dayIndex)}
                onTouchMove={handleColumnTouchMove}
                onTouchEnd={handleColumnTouchEnd}
                onTouchCancel={handleColumnTouchCancel}
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className={`border-b ${hour === 24 ? "border-border" : "border-border/10"} ${
                      hour >= 10 && hour < 18 ? "bg-white/[0.03]" : ""
                    }`}
                    style={{ height: HOUR_HEIGHT }}
                  />
                ))}

                {/* Long-press create preview: 1h ghost block at the current
                    drag position. Rendered on top of the grid (z-20) but below
                    the real events so the user still sees conflicts. */}
                {isPreviewColumn && preview && (
                  <div
                    className="pointer-events-none absolute left-0.5 right-0.5 rounded-lg border-2 border-dashed border-primary bg-primary/20 px-1 py-0.5 text-[10px] leading-tight text-primary-foreground z-20"
                    style={{
                      top: preview.currentHour * HOUR_HEIGHT,
                      height: HOUR_HEIGHT,
                    }}
                  >
                    <div className="font-medium">Block</div>
                    <div className="text-[9px] opacity-80">
                      {(() => {
                        // formatHour(9) returns "09:00" already — appending a
                        // minute value produced "09:00:15" instead of "09:15".
                        const h = Math.floor(preview.currentHour).toString().padStart(2, "0");
                        const m = Math.round((preview.currentHour % 1) * 60).toString().padStart(2, "0");
                        return `${h}:${m}`;
                      })()}
                    </div>
                  </div>
                )}

                {dayEvents.map((pe) => (
                  <div
                    key={pe.event.id}
                    // data-event-tile + data-event-id let the column's
                    // touchStart/End handler route short taps to edit and
                    // long-presses to create (even on top of an event). All
                    // interaction goes through the column's touch handlers —
                    // no onClick here so click and long-press don't both fire
                    // at the end of the same gesture.
                    data-event-tile="true"
                    data-event-id={pe.event.id}
                    // left/width come from assignLanes(); the fixed 2px inset
                    // on each side keeps events from touching the column
                    // borders even when they span the full lane.
                    className="absolute overflow-hidden rounded-lg px-1 py-0.5 text-[10px] leading-tight text-white cursor-pointer"
                    style={{
                      top: pe.top,
                      height: pe.height,
                      left: `calc(${pe.leftPct}% + 2px)`,
                      width: `calc(${pe.widthPct}% - 4px)`,
                      zIndex: pe.zIndex,
                      backgroundColor: hexToGlass(pe.color, 0.55),
                      backdropFilter: "blur(8px)",
                    }}
                  >
                    <div className="font-medium truncate">{pe.event.title}</div>
                  </div>
                ))}

                {isToday(day) && (
                  <div
                    className="absolute left-0 right-0 z-[5] border-t-2 border-red-500"
                    style={{ top: (new Date().getHours() + new Date().getMinutes() / 60) * HOUR_HEIGHT }}
                  >
                    <div className="absolute -left-1 -top-1.5 h-3 w-3 rounded-full bg-red-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <EventModal
        isOpen={isEventModalOpen}
        onClose={handleEventModalClose}
        event={selectedEvent}
        defaultDate={selectedDate}
        defaultEndDate={selectedEndDate}
      />
      {quickViewItem && (
        <EventQuickView
          isOpen={!!quickViewItem}
          onClose={handleQuickViewClose}
          item={quickViewItem}
          onEdit={handleQuickViewEdit}
          onDelete={handleQuickViewDelete}
          isTask={false}
          referenceElement={clickedElement}
        />
      )}
    </div>
  );
}
