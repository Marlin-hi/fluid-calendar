import { NextRequest, NextResponse } from "next/server";
import { appendFileSync } from "fs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const line = `[${new Date().toISOString()}] ${body}\n`;
    appendFileSync("/tmp/mobile-debug.log", line);
  } catch {
    // ignore
  }
  return NextResponse.json({ ok: true });
}
