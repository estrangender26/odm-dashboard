/**
 * Migration journal integrity regression test.
 *
 * Guards against the deployment failure seen after PR #415: the migration
 * journal (db/migrations/meta/_journal.json) referenced entry 0038 while the
 * SQL file db/migrations/0038_monthly_kpi_situation.sql was missing from the
 * repository (db/migrations/*.sql is git-ignored, so the file must be added
 * with `git add -f`). Every journal entry must resolve to an existing SQL
 * migration file.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = resolve(process.cwd(), "db/migrations");
const journalPath = resolve(migrationsDir, "meta/_journal.json");

interface JournalEntry {
  idx: number;
  tag: string;
}

function readJournal(): { entries: JournalEntry[] } {
  return JSON.parse(
    readFileSync(journalPath, "utf8")
  ) as { entries: JournalEntry[] };
}

describe("db/migrations journal integrity", () => {
  it("every journal entry points to an existing SQL migration file", () => {
    const journal = readJournal();
    expect(journal.entries.length).toBeGreaterThan(0);

    const sqlFiles = new Set(
      readdirSync(migrationsDir)
        .filter((name) => name.endsWith(".sql"))
        .map((name) => name)
    );

    for (const entry of journal.entries) {
      const fileName = `${entry.tag}.sql`;
      expect(
        sqlFiles.has(fileName),
        `Journal entry ${entry.idx} (${entry.tag}) is missing its SQL file ${fileName}. ` +
          `db/migrations/*.sql is git-ignored; add the file with "git add -f ${fileName}".`
      ).toBe(true);
    }
  });

  it("journal tags are unique and their files are present", () => {
    const journal = readJournal();
    const tags = journal.entries.map((entry) => entry.tag);
    expect(new Set(tags).size).toBe(tags.length);

    for (const tag of tags) {
      expect(
        existsSync(resolve(migrationsDir, `${tag}.sql`)),
        `Migration file ${tag}.sql must exist for journal tag ${tag}`
      ).toBe(true);
    }
  });
});
