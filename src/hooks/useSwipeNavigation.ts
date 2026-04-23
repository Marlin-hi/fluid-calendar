"use client";

import { useEffect, useRef, useCallback } from "react";

interface SwipeOptions {
  onSwipe: (days: number) => void; // positive = forward, negative = back
  threshold?: number;
}

export function useSwipeNavigation(
  containerRef: React.RefObject<HTMLElement | null>,
  { onSwipe, threshold = 50 }: SwipeOptions
) {
  const startX = useRef(0);
  const startY = useRef(0);
  const currentX = useRef(0);
  const isSwiping = useRef(false);
  const isHorizontal = useRef<boolean | null>(null);

  const animateOut = useCallback(
    (direction: "left" | "right", callback: () => void) => {
      const container = containerRef.current;
      if (!container) {
        callback();
        return;
      }

      const grid = container.querySelector(".fc") as HTMLElement;
      if (!grid) {
        callback();
        return;
      }

      // Slide out completely in swipe direction
      const slideOut = direction === "left"
        ? -container.offsetWidth
        : container.offsetWidth;

      grid.style.transition = "transform 0.2s ease-out";
      grid.style.transform = `translateX(${slideOut}px)`;

      setTimeout(() => {
        // Jump to opposite side (no transition)
        grid.style.transition = "none";
        grid.style.transform = `translateX(${-slideOut}px)`;

        callback();

        // Slide in from opposite side
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            grid.style.transition = "transform 0.2s ease-out";
            grid.style.transform = "translateX(0)";

            setTimeout(() => {
              grid.style.transition = "";
              grid.style.transform = "";
            }, 220);
          });
        });
      }, 200);
    },
    [containerRef]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!("ontouchstart" in window)) return;

    const grid = () =>
      container.querySelector(".fc") as HTMLElement | null;

    const onTouchStart = (e: TouchEvent) => {
      startX.current = e.touches[0].clientX;
      startY.current = e.touches[0].clientY;
      currentX.current = startX.current;
      isSwiping.current = true;
      isHorizontal.current = null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isSwiping.current) return;

      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const dx = x - startX.current;
      const dy = y - startY.current;

      if (
        isHorizontal.current === null &&
        (Math.abs(dx) > 10 || Math.abs(dy) > 10)
      ) {
        isHorizontal.current = Math.abs(dx) > Math.abs(dy);
      }

      if (!isHorizontal.current) return;

      currentX.current = x;

      const g = grid();
      if (g) {
        g.style.transition = "none";
        g.style.transform = `translateX(${dx}px)`;
      }
    };

    const onTouchEnd = () => {
      if (!isSwiping.current) return;
      isSwiping.current = false;

      if (!isHorizontal.current) {
        const g = grid();
        if (g) {
          g.style.transition = "";
          g.style.transform = "";
        }
        return;
      }

      const dx = currentX.current - startX.current;
      const absDx = Math.abs(dx);

      if (absDx > threshold) {
        // Calculate days based on swipe strength
        // 50-150px = 1 day, 150-250px = 2 days, 250+ = 3 days
        const days = Math.min(3, Math.max(1, Math.ceil(absDx / 120)));
        const direction = dx < 0 ? "left" : "right";
        const signedDays = dx < 0 ? days : -days;

        animateOut(direction, () => onSwipe(signedDays));
      } else {
        const g = grid();
        if (g) {
          g.style.transition = "transform 0.2s ease-out";
          g.style.transform = "translateX(0)";
          setTimeout(() => {
            g.style.transition = "";
            g.style.transform = "";
          }, 220);
        }
      }
    };

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    container.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
    };
  }, [containerRef, onSwipe, threshold, animateOut]);
}
