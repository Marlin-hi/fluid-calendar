/**
 * Vault-backed implementation of EventStore.
 *
 * One Markdown file per event under CALENDAR_VAULT_PATH/events/. The
 * YAML frontmatter carries the structured fields (id, start, end,
 * feedId, title, description, location, recurrence). The body of the
 * file is free text the user can edit — we never touch anything after
 * the second `---` line.
 *
 * Filename: `<YYYY-MM-DD>_<slug>_<id>.md` (slug is the title sanitised
 * to path-safe chars, capped at 60 chars). The full cuid at the end
 * keeps filenames unique even when two events share a day and title.
 *
 * Concurrency & durability:
 *   - Writes go through a tmp file + rename so a crashed process can
 *     never leave an mid-flight half-written MD.
 *   - updatedAt is stamped from the server clock at write time. It
 *     goes into the frontmatter and is what If-Match compares against.
 *   - The vault is per-user isolated by a "userId" frontmatter field.
 *     list() filters by it. Multi-user support is currently only
 *     theoretical — Marlin's instance has one user — but we carry the
 *     userId anyway so it stays correct if that ever changes.
 *
 * This backend is selected when process.env.CALENDAR_BACKEND is set to
 * "vault". A matching CALENDAR_VAULT_PATH env var must also be set;
 * default is "<repo>/data/vault" which the deploy-script excludes from
 * rsync so dev / staging / prod each keep their own vault content.
 */

import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import path from "path";

import { prisma } from "@/lib/prisma";

import type { EventRow, EventStore, ListFilter } from "./types";

// --- paths ---

function vaultRoot(): string {
  const raw = process.env.CALENDAR_VAULT_PATH;
  if (raw && raw.trim().length > 0) return raw;
  return path.join(process.cwd(), "data", "vault");
}

function eventsDir(): string {
  return path.join(vaultRoot(), "events");
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// --- filename ---

function slugify(title: string): string {
  return title
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function filenameFor(row: Pick<EventRow, "id" | "title" | "start">): string {
  const day = row.start.slice(0, 10);
  return `${day}_${slugify(row.title || "(ohne Titel)")}_${row.id}.md`;
}

async function pathById(id: string): Promise<string | null> {
  const dir = eventsDir();
  try {
    const entries = await fs.readdir(dir);
    const match = entries.find((e) => e.endsWith(`_${id}.md`));
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

// --- YAML (minimal: we control what goes in here, so we don't need a full parser) ---

function escapeYaml(value: string): string {
  // Safe quoting: always double-quote strings, escape " and \.
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function writeFrontmatter(row: EventRow & { userId: string }): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${escapeYaml(row.id)}`);
  lines.push(`userId: ${escapeYaml(row.userId)}`);
  lines.push(`feedId: ${escapeYaml(row.feedId)}`);
  lines.push(`title: ${escapeYaml(row.title)}`);
  if (row.description) lines.push(`description: ${escapeYaml(row.description)}`);
  lines.push(`start: ${escapeYaml(row.start)}`);
  lines.push(`end: ${escapeYaml(row.end)}`);
  lines.push(`allDay: ${row.allDay}`);
  if (row.location) lines.push(`location: ${escapeYaml(row.location)}`);
  lines.push(`isRecurring: ${row.isRecurring}`);
  if (row.recurrenceRule) lines.push(`recurrenceRule: ${escapeYaml(row.recurrenceRule)}`);
  lines.push(`updatedAt: ${escapeYaml(row.updatedAt)}`);
  lines.push("---");
  return lines.join("\n") + "\n";
}

function parseFrontmatter(content: string): Record<string, string | boolean> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const body = match[1];
  const out: Record<string, string | boolean> = {};
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let raw = m[2];
    if (raw === "true") {
      out[key] = true;
    } else if (raw === "false") {
      out[key] = false;
    } else {
      // Strip wrapping quotes and unescape our known sequences.
      const q = raw.match(/^"((?:[^"\\]|\\.)*)"$/);
      if (q) raw = q[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      out[key] = raw;
    }
  }
  return out;
}

function frontmatterToRow(fm: Record<string, string | boolean>): EventRow | null {
  const required = ["id", "feedId", "title", "start", "end", "updatedAt"];
  for (const k of required) if (typeof fm[k] !== "string" || !fm[k]) return null;
  return {
    id: String(fm.id),
    feedId: String(fm.feedId),
    title: String(fm.title),
    description: typeof fm.description === "string" ? String(fm.description) : null,
    start: String(fm.start),
    end: String(fm.end),
    allDay: fm.allDay === true,
    location: typeof fm.location === "string" ? String(fm.location) : null,
    isRecurring: fm.isRecurring === true,
    recurrenceRule: typeof fm.recurrenceRule === "string" ? String(fm.recurrenceRule) : null,
    updatedAt: String(fm.updatedAt),
  };
}

// --- store impl ---

async function readEventFile(p: string): Promise<{ row: EventRow | null; userId: string | null; body: string }> {
  const content = await fs.readFile(p, "utf8");
  const fm = parseFrontmatter(content);
  const row = frontmatterToRow(fm);
  const userId = typeof fm.userId === "string" ? String(fm.userId) : null;
  // body = everything past the second '---' line
  const lines = content.split(/\r?\n/);
  let sepCount = 0;
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "---") {
      sepCount++;
      if (sepCount === 2) { bodyStart = i + 1; break; }
    }
  }
  const body = lines.slice(bodyStart).join("\n");
  return { row, userId, body };
}

async function writeEventFile(
  row: EventRow,
  userId: string,
  body: string
): Promise<string> {
  await ensureDir(eventsDir());
  const fname = filenameFor(row);
  const target = path.join(eventsDir(), fname);
  const tmp = `${target}.tmp-${randomUUID()}`;
  const fm = writeFrontmatter({ ...row, userId });
  const content = fm + "\n" + (body || `# ${row.title}\n\n`);
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, target);
  return target;
}

async function joinFeed(row: EventRow): Promise<EventRow> {
  if (row.feed) return row;
  const feed = await prisma.calendarFeed.findUnique({
    where: { id: row.feedId },
    select: { name: true, color: true },
  });
  if (feed) row.feed = { name: feed.name ?? "", color: feed.color ?? "" };
  return row;
}

export const vaultStore: EventStore = {
  async list({ userId, since }) {
    await ensureDir(eventsDir());
    let entries: string[] = [];
    try {
      entries = await fs.readdir(eventsDir());
    } catch {
      return [];
    }
    const sinceMs = since instanceof Date ? since.getTime() : null;
    const rows: EventRow[] = [];
    for (const name of entries) {
      if (!name.endsWith(".md")) continue;
      const full = path.join(eventsDir(), name);
      try {
        const { row, userId: rowUser } = await readEventFile(full);
        if (!row || rowUser !== userId) continue;
        if (sinceMs !== null && Date.parse(row.updatedAt) <= sinceMs) continue;
        rows.push(row);
      } catch {
        /* malformed file — skip */
      }
    }
    // Join feed meta in a single query for all rows.
    const feedIds = Array.from(new Set(rows.map((r) => r.feedId)));
    if (feedIds.length > 0) {
      const feeds = await prisma.calendarFeed.findMany({
        where: { id: { in: feedIds } },
        select: { id: true, name: true, color: true },
      });
      const byId = new Map(feeds.map((f) => [f.id, { name: f.name ?? "", color: f.color ?? "" }]));
      for (const r of rows) r.feed = byId.get(r.feedId);
    }
    return rows;
  },

  async get(userId, id) {
    const p = await pathById(id);
    if (!p) return null;
    const { row, userId: rowUser } = await readEventFile(p);
    if (!row || rowUser !== userId) return null;
    return joinFeed(row);
  },

  async create(userId, input) {
    const feed = await prisma.calendarFeed.findUnique({ where: { id: input.feedId } });
    if (!feed || feed.userId !== userId) throw new Error("feed not found");
    const id = randomUUID();
    const now = new Date().toISOString();
    const row: EventRow = { ...input, id, updatedAt: now };
    await writeEventFile(row, userId, "");
    return joinFeed(row);
  },

  async update(userId, id, patch, ifMatch) {
    const p = await pathById(id);
    if (!p) return { ok: false, reason: "not-found" };
    const { row, userId: rowUser, body } = await readEventFile(p);
    if (!row || rowUser !== userId) return { ok: false, reason: "not-found" };
    if (ifMatch && ifMatch !== row.updatedAt) {
      return { ok: false, reason: "precondition-failed", current: await joinFeed(row) };
    }
    const merged: EventRow = {
      ...row,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    // If the filename-relevant fields (title or start day) change, write
    // to the new filename and remove the old.
    const newName = filenameFor(merged);
    const newPath = path.join(eventsDir(), newName);
    await writeEventFile(merged, userId, body);
    if (newPath !== p) {
      try { await fs.unlink(p); } catch { /* ignore */ }
    }
    return { ok: true, row: await joinFeed(merged) };
  },

  async remove(userId, id, ifMatch) {
    const p = await pathById(id);
    if (!p) return { ok: false, reason: "not-found" };
    const { row, userId: rowUser } = await readEventFile(p);
    if (!row || rowUser !== userId) return { ok: false, reason: "not-found" };
    if (ifMatch && ifMatch !== row.updatedAt) {
      return { ok: false, reason: "precondition-failed", current: await joinFeed(row) };
    }
    await fs.unlink(p);
    return { ok: true };
  },
};
