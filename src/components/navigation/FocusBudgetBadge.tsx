"use client";

import { HiArrowDown, HiArrowUp } from "react-icons/hi";

import { cn } from "@/lib/utils";

import { useFocusBudget } from "@/hooks/useFocusBudget";

export function FocusBudgetBadge() {
  const budget = useFocusBudget();

  if (!budget.enabled) return null;

  if (!budget.configured) {
    return (
      <a
        href="/settings#focus-budget"
        className="hidden items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted sm:inline-flex"
        title="Pick a focus calendar in Settings"
      >
        Focus: set up
      </a>
    );
  }

  const { usedHours, targetHours, state } = budget;
  const colorClass =
    state === "ok"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
      : "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30";

  const arrow =
    state === "low" ? (
      <HiArrowUp className="h-3 w-3" />
    ) : state === "high" ? (
      <HiArrowDown className="h-3 w-3" />
    ) : null;

  const formattedUsed = usedHours.toFixed(1);
  const title =
    state === "ok"
      ? `Focus budget on track (${formattedUsed}h of ${targetHours}h)`
      : state === "low"
        ? `Below focus budget: ${formattedUsed}h of ${targetHours}h this week`
        : `Over focus budget: ${formattedUsed}h of ${targetHours}h this week`;

  return (
    <a
      href="/settings#focus-budget"
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
        colorClass
      )}
      title={title}
    >
      {arrow}
      <span>{formattedUsed}</span>
      <span className="hidden sm:inline text-muted-foreground">
        / {targetHours}h
      </span>
      <span className="sm:hidden text-muted-foreground">h</span>
    </a>
  );
}
