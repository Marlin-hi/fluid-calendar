import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { logger } from "@/lib/logger";

const LOG_SOURCE = "feedback-route";

/**
 * In-app feedback sink.
 *
 * Users (well, Marlin) send a short free-form text. We append a line to
 * /opt/fluid-calendar-*/data/feedback.jsonl on the server and also log a
 * FEEDBACK marker so it's grep-able in journalctl. No schema migration,
 * no DB table — the whole point is to capture ideas quickly without
 * tipping the app into "now we need to design a backlog UI" territory.
 *
 * Retrieval: `cat /opt/fluid-calendar-dev/data/feedback.jsonl` over SSH,
 * or `journalctl -u fluid-calendar-dev | grep FEEDBACK`.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request, LOG_SOURCE);
  if ("response" in auth) return auth.response;

  const userId = auth.userId;

  let body: { text?: string } = {};
  try {
    body = (await request.json()) as { text?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  if (text.length > 4000) {
    return NextResponse.json({ error: "text too long (max 4000 chars)" }, { status: 400 });
  }

  const entry = {
    ts: new Date().toISOString(),
    userId,
    userAgent: request.headers.get("user-agent") ?? "",
    text,
  };

  // Tagged log line: grep -F "FEEDBACK " journalctl output or the file.
  logger.info(`FEEDBACK ${JSON.stringify(entry)}`, {}, LOG_SOURCE);

  const dataDir = path.join(process.cwd(), "data");
  const file = path.join(dataDir, "feedback.jsonl");
  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.appendFile(file, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    logger.error(
      "Failed to persist feedback to disk",
      { err: err instanceof Error ? err.message : String(err) },
      LOG_SOURCE
    );
    // Still return success — the log line above is a durable record.
  }

  return NextResponse.json({ ok: true });
}
