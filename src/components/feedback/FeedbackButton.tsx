"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Tiny floating feedback button. Lives on the calendar page so Marlin
 * can dump a thought the moment he notices it, without context-switching
 * to a note app or a chat window. The text lands on the server as a
 * JSONL line in data/feedback.jsonl + a FEEDBACK-tagged logger.info
 * entry, both retrievable over SSH.
 *
 * We intentionally render this only inside the (common) routes so it
 * doesn't appear on auth pages.
 */
export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || status === "sending") return;
    setStatus("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("sent");
      setText("");
      window.setTimeout(() => {
        setOpen(false);
        setStatus("idle");
      }, 900);
    } catch {
      setStatus("error");
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-16 right-3 z-[60] flex h-10 w-10 items-center justify-center rounded-full bg-muted/80 text-foreground shadow-md ring-1 ring-border backdrop-blur hover:bg-muted md:bottom-4 md:right-4 md:h-12 md:w-12"
        title="Feedback senden"
        aria-label="Feedback senden"
      >
        <span aria-hidden className="text-base">?</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-t-lg border border-border bg-background/85 backdrop-blur-xl shadow-xl p-4 md:max-w-md md:rounded-lg"
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold">Was nervt, was fehlt?</h3>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
              >
                Abbrechen
              </button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Landet als Log-Eintrag auf dem Server — Mika sammelt das und arbeitet es ab.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="z.B.: 'Tagesheader ist zu groß', 'Swipe nach links bricht bei Tag 30 ab', …"
              className="min-h-[120px] w-full resize-y rounded-md border border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              maxLength={4000}
              autoFocus
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {text.length}/4000
              </span>
              <div className="flex items-center gap-2">
                {status === "sent" && (
                  <span className="text-xs text-emerald-600">Danke, gesendet.</span>
                )}
                {status === "error" && (
                  <span className="text-xs text-red-600">Fehler — nochmal?</span>
                )}
                <Button onClick={send} disabled={!text.trim() || status === "sending"} size="sm">
                  {status === "sending" ? "Sende…" : "Senden"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
