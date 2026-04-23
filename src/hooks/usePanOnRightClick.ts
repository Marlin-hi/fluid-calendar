"use client";

import { useEffect, useRef } from "react";

export function usePanOnRightClick(
  containerRef: React.RefObject<HTMLElement | null>
) {
  const isPanning = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const scrollLeft = useRef(0);
  const scrollTop = useRef(0);
  const scrollerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const findScroller = () => {
      // FullCalendar nests its scroller deep in the DOM
      const el =
        container.querySelector<HTMLElement>(
          ".fc-scroller-liquid-absolute"
        ) ||
        container.querySelector<HTMLElement>(
          ".fc-scroller-harness .fc-scroller"
        ) ||
        container.querySelector<HTMLElement>(".fc-scroller");
      scrollerRef.current = el;
      return el;
    };

    // Retry finding scroller after FullCalendar renders
    const timer = setTimeout(findScroller, 500);

    const onContextMenu = (e: MouseEvent) => {
      // Only prevent if we're inside the calendar grid
      if (container.contains(e.target as Node)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      if (!container.contains(e.target as Node)) return;

      const scroller = scrollerRef.current || findScroller();
      if (!scroller) return;

      e.preventDefault();
      e.stopPropagation();
      isPanning.current = true;
      startX.current = e.clientX;
      startY.current = e.clientY;
      scrollLeft.current = scroller.scrollLeft;
      scrollTop.current = scroller.scrollTop;
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isPanning.current) return;
      e.preventDefault();

      const scroller = scrollerRef.current;
      if (!scroller) return;

      const dx = e.clientX - startX.current;
      const dy = e.clientY - startY.current;
      scroller.scrollLeft = scrollLeft.current - dx;
      scroller.scrollTop = scrollTop.current - dy;
    };

    const onMouseUp = () => {
      if (!isPanning.current) return;
      isPanning.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    // Use capture phase to intercept before FullCalendar
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [containerRef]);
}
