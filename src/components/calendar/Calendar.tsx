"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import dynamic from "next/dynamic";
import { HiLightningBolt, HiMenu } from "react-icons/hi";
import { IoChevronBack, IoChevronForward, IoExpand, IoContract } from "react-icons/io5";

import { DayView } from "@/components/calendar/DayView";
import { FeedManager } from "@/components/calendar/FeedManager";
import { MobileTimeline } from "@/components/calendar/MobileTimeline";
import { MonthView } from "@/components/calendar/MonthView";
import { MultiMonthView } from "@/components/calendar/MultiMonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { addDays, formatDate, newDate, subDays } from "@/lib/date-utils";
import { isSaasEnabled } from "@/lib/config";
import { cn } from "@/lib/utils";

import {
  useCalendarStore,
  useCalendarUIStore,
  useViewStore,
} from "@/store/calendar";
import { useTaskStore } from "@/store/task";

import { CalendarEvent, CalendarFeed } from "@/types/calendar";
import { usePanOnRightClick } from "@/hooks/usePanOnRightClick";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";

// Dynamically import the appropriate version of the LifetimeAccessBanner
const LifetimeAccessBanner = dynamic(
  () =>
    import(
      `./LifetimeAccessBanner.${isSaasEnabled ? "saas" : "open"}`
    ).then((mod) => mod.LifetimeAccessBanner),
  { ssr: false }
);

interface CalendarProps {
  initialFeeds?: CalendarFeed[];
  initialEvents?: CalendarEvent[];
}

export function Calendar({
  initialFeeds = [],
  initialEvents = [],
}: CalendarProps) {
  const { date: currentDate, setDate, view, setView } = useViewStore();
  const { isSidebarOpen, setSidebarOpen, isHydrated } = useCalendarUIStore();
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Auto-fullscreen on first touch on mobile
  useEffect(() => {
    if (window.innerWidth < 768 && !document.fullscreenElement) {
      const handleFirstTouch = () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      };
      document.addEventListener("touchstart", handleFirstTouch, { once: true });
      return () => document.removeEventListener("touchstart", handleFirstTouch);
    }
  }, []);
  const { scheduleAllTasks } = useTaskStore();
  const { setFeeds, setEvents } = useCalendarStore();
  const calendarGridRef = useRef<HTMLDivElement>(null);
  usePanOnRightClick(calendarGridRef);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const handleSwipe = useCallback(
    (days: number) => {
      // days: positive = forward, negative = back
      if (view === "month" || view === "multiMonth") {
        const d = new Date(currentDate);
        d.setMonth(d.getMonth() + (days > 0 ? 1 : -1));
        setDate(d);
      } else {
        if (days > 0) {
          setDate(addDays(currentDate, days));
        } else {
          setDate(subDays(currentDate, Math.abs(days)));
        }
      }
    },
    [view, currentDate, setDate]
  );

  useSwipeNavigation(calendarGridRef, {
    onSwipe: handleSwipe,
  });

  // Date picker for mobile tap-on-date
  const dateInputRef = useRef<HTMLInputElement>(null);
  const handleDateTap = () => {
    dateInputRef.current?.showPicker?.();
    dateInputRef.current?.click();
  };
  const handleDatePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      const [y, m, d] = e.target.value.split("-").map(Number);
      setDate(new Date(y, m - 1, d));
    }
  };

  // Use initial data from server for hydration
  useEffect(() => {
    if (initialFeeds.length > 0) {
      setFeeds(initialFeeds);
    }

    if (initialEvents.length > 0) {
      setEvents(initialEvents);
    }

    // Only fetch from database if we didn't get initial data
    if (!initialFeeds.length || !initialEvents.length) {
      useCalendarStore.getState().loadFromDatabase();
    }

    // Always fetch tasks since they're not pre-loaded
    useTaskStore.getState().fetchTasks();
  }, [initialFeeds, initialEvents, setFeeds, setEvents]);

  // Close sidebar on mobile on initial load
  useEffect(() => {
    if (window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close sidebar on mobile when switching views or navigating
  const closeSidebarOnMobile = () => {
    if (window.innerWidth < 768 && isSidebarOpen) {
      setSidebarOpen(false);
    }
  };

  const handlePrevWeek = () => {
    if (view === "month" || view === "multiMonth") {
      const newDate = new Date(currentDate);
      newDate.setMonth(newDate.getMonth() - 1);
      setDate(newDate);
    } else {
      const days = view === "day" ? 1 : 7;
      setDate(subDays(currentDate, days));
    }
  };

  const handleNextWeek = () => {
    if (view === "month" || view === "multiMonth") {
      const newDate = new Date(currentDate);
      newDate.setMonth(newDate.getMonth() + 1);
      setDate(newDate);
    } else {
      const days = view === "day" ? 1 : 7;
      setDate(addDays(currentDate, days));
    }
  };

  const handleAutoSchedule = async () => {
    await scheduleAllTasks();
  };

  // Short date format for mobile
  const formatDateShort = (date: Date) => {
    return date.toLocaleDateString("de-DE", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div className="relative flex h-full w-full overflow-hidden">
      {/* Mobile overlay backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "h-full w-72 flex-none border-r border-gray-200 bg-white dark:bg-background",
          "transform transition-transform duration-300 ease-in-out",
          "fixed z-40 md:relative md:z-auto",
          !isHydrated && "opacity-0 duration-0",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full",
          !isSidebarOpen && "md:hidden"
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex-1 overflow-y-auto">
            <FeedManager />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <LifetimeAccessBanner />
        {/* Header */}
        <header className="flex h-12 flex-none items-center border-b border-border px-2 md:h-16 md:px-4">
          <button
            onClick={() => setSidebarOpen(!isSidebarOpen)}
            className="rounded-lg p-1.5 text-foreground hover:bg-muted md:p-2"
            title="Toggle Sidebar (b)"
          >
            <HiMenu className="h-5 w-5" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="rounded-lg p-1.5 text-foreground hover:bg-muted md:hidden"
            title="Fullscreen"
          >
            {isFullscreen ? (
              <IoContract className="h-5 w-5" />
            ) : (
              <IoExpand className="h-5 w-5" />
            )}
          </button>

          <div className="ml-2 flex items-center gap-1 md:ml-4 md:gap-4">
            <button
              onClick={() => setDate(newDate())}
              className="rounded-lg px-2 py-1 text-xs font-medium text-foreground hover:bg-muted md:px-3 md:py-1.5 md:text-sm"
              title="Go to Today (t)"
            >
              Today
            </button>

            <button
              onClick={handleAutoSchedule}
              className="flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 md:px-3 md:py-1.5 md:text-sm"
              title="Auto Schedule"
            >
              <HiLightningBolt className="h-4 w-4" />
              <span className="hidden md:inline">Auto Schedule</span>
            </button>

            <div className="flex items-center gap-0.5 md:gap-2">
              <button
                onClick={handlePrevWeek}
                className="rounded-lg p-1 text-foreground hover:bg-muted md:p-1.5"
                data-testid="calendar-prev-week"
                title="Previous Week"
              >
                <IoChevronBack className="h-4 w-4 md:h-5 md:w-5" />
              </button>
              <button
                onClick={handleNextWeek}
                className="rounded-lg p-1 text-foreground hover:bg-muted md:p-1.5"
                data-testid="calendar-next-week"
                title="Next Week"
              >
                <IoChevronForward className="h-4 w-4 md:h-5 md:w-5" />
              </button>
            </div>

            <h1 className="text-sm font-semibold text-foreground md:text-xl">
              <span className="hidden md:inline">
                {formatDate(currentDate)}
              </span>
              <span
                className="cursor-pointer md:hidden"
                onClick={handleDateTap}
              >
                {formatDateShort(currentDate)}
              </span>
              <input
                ref={dateInputRef}
                type="date"
                className="invisible absolute h-0 w-0"
                value={currentDate.toISOString().slice(0, 10)}
                onChange={handleDatePick}
              />
            </h1>
          </div>

          {/* View Switching Buttons */}
          <div className="ml-auto flex items-center gap-0.5 md:gap-2">
            <button
              onClick={() => {
                setView("day");
                closeSidebarOnMobile();
              }}
              className={cn(
                "rounded-lg px-2 py-1 text-xs font-medium md:px-3 md:py-1.5 md:text-sm",
                view === "day"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              Day
            </button>
            <button
              onClick={() => {
                setView("week");
                closeSidebarOnMobile();
              }}
              className={cn(
                "rounded-lg px-2 py-1 text-xs font-medium md:px-3 md:py-1.5 md:text-sm",
                view === "week"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              Week
            </button>
            <button
              onClick={() => {
                setView("month");
                closeSidebarOnMobile();
              }}
              className={cn(
                "rounded-lg px-2 py-1 text-xs font-medium md:px-3 md:py-1.5 md:text-sm",
                view === "month"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              Mon
            </button>
            <button
              onClick={() => {
                setView("multiMonth");
                closeSidebarOnMobile();
              }}
              className={cn(
                "hidden rounded-lg px-3 py-1.5 text-sm font-medium md:block",
                view === "multiMonth"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              Year
            </button>
          </div>
        </header>

        {/* Calendar Grid.
         * The weekly view forks by viewport: mobile (<768px) uses our own
         * horizontally-scrollable MobileTimeline; desktop uses FullCalendar
         * via WeekView. Styling and interaction drift between the two if you
         * forget — touch both paths when changing weekly-view behaviour. */}
        <div ref={calendarGridRef} className="flex-1 overflow-hidden">
          {isMobile && view === "week" ? (
            <MobileTimeline
              currentDate={currentDate}
              onDateChange={setDate}
            />
          ) : view === "day" ? (
            <DayView currentDate={currentDate} onDateClick={setDate} />
          ) : view === "week" ? (
            <WeekView currentDate={currentDate} onDateClick={setDate} />
          ) : view === "month" ? (
            <MonthView currentDate={currentDate} onDateClick={setDate} />
          ) : (
            <MultiMonthView currentDate={currentDate} onDateClick={setDate} />
          )}
        </div>
      </main>
    </div>
  );
}
