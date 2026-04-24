/**
 * One-shot migration: copy every CalendarEvent row into the vault as a
 * Markdown file, so switching CALENDAR_BACKEND=prisma → vault doesn't
 * look like "all events disappeared".
 *
 * Usage:
 *   npx tsx scripts/migrate-events-to-vault.ts [--dry-run]
 *
 * - Respects CALENDAR_VAULT_PATH; defaults to <repo>/data/vault.
 * - Idempotent: files whose id already exists in the vault are not
 *   overwritten (body text the user may already have added stays put).
 * - Does not touch the prisma rows. Safe to run with prisma still live.
 */

import { PrismaClient } from "@prisma/client";
import { promises as fs } from "fs";
import path from "path";

const prisma = new PrismaClient();

function vaultRoot(): string {
  const raw = process.env.CALENDAR_VAULT_PATH;
  if (raw && raw.trim().length > 0) return raw;
  return path.join(process.cwd(), "data", "vault");
}

function slugify(title: string): string {
  return title
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function escapeYaml(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const dir = path.join(vaultRoot(), "events");
  if (!dryRun) await fs.mkdir(dir, { recursive: true });

  console.log(`Vault directory: ${dir}${dryRun ? " (dry-run)" : ""}`);

  const existing = !dryRun
    ? new Set(await fs.readdir(dir).catch(() => [] as string[]))
    : new Set<string>();

  const total = await prisma.calendarEvent.count();
  console.log(`Found ${total} events in Prisma`);

  let created = 0;
  let skipped = 0;
  const batchSize = 500;
  for (let skip = 0; skip < total; skip += batchSize) {
    const batch = await prisma.calendarEvent.findMany({
      skip,
      take: batchSize,
      include: { feed: { select: { userId: true } } },
      orderBy: { id: "asc" },
    });
    for (const ev of batch) {
      const title = ev.title || "(ohne Titel)";
      const day = ev.start.toISOString().slice(0, 10);
      const fname = `${day}_${slugify(title)}_${ev.id}.md`;
      // Also skip if any existing filename already has this id — the
      // user may have renamed it.
      const alreadyThere = existing.has(fname)
        || Array.from(existing).some((f) => f.endsWith(`_${ev.id}.md`));
      if (alreadyThere) {
        skipped++;
        continue;
      }
      const lines = [
        "---",
        `id: ${escapeYaml(ev.id)}`,
        `userId: ${escapeYaml(ev.feed.userId ?? "")}`,
        `feedId: ${escapeYaml(ev.feedId)}`,
        `title: ${escapeYaml(title)}`,
      ];
      if (ev.description) lines.push(`description: ${escapeYaml(ev.description)}`);
      lines.push(`start: ${escapeYaml(ev.start.toISOString())}`);
      lines.push(`end: ${escapeYaml(ev.end.toISOString())}`);
      lines.push(`allDay: ${ev.allDay}`);
      if (ev.location) lines.push(`location: ${escapeYaml(ev.location)}`);
      lines.push(`isRecurring: ${ev.isRecurring}`);
      if (ev.recurrenceRule) lines.push(`recurrenceRule: ${escapeYaml(ev.recurrenceRule)}`);
      lines.push(`updatedAt: ${escapeYaml(ev.updatedAt.toISOString())}`);
      lines.push("---", "", `# ${title}`, "", "");
      const content = lines.join("\n");
      if (!dryRun) {
        await fs.writeFile(path.join(dir, fname), content, "utf8");
        existing.add(fname);
      }
      created++;
    }
    process.stdout.write(`  ${Math.min(skip + batchSize, total)}/${total} processed\r`);
  }
  console.log();
  console.log(`created=${created} skipped=${skipped}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
