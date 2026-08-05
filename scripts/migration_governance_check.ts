import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import postgres from "postgres";

const MIGRATIONS_DIR = path.join(process.cwd(), "db/migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta/_journal.json");

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function readJournal(): Journal {
  const raw = fs.readFileSync(JOURNAL_PATH, "utf8");
  return JSON.parse(raw) as Journal;
}

function fileHash(tag: string): string {
  const filePath = path.join(MIGRATIONS_DIR, `${tag}.sql`);
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function checkJournalOrdering(journal: Journal): string[] {
  const errors: string[] = [];
  const seenTag = new Map<string, number>();
  const seenIdx = new Map<number, string>();

  for (const entry of journal.entries) {
    const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) {
      errors.push(`missing SQL file for migration ${entry.tag}: ${sqlPath}`);
    }

    const duplicateTag = seenTag.get(entry.tag);
    if (duplicateTag !== undefined) {
      errors.push(`duplicate tag ${entry.tag} at idx ${duplicateTag} and ${entry.idx}`);
    }
    seenTag.set(entry.tag, entry.idx);

    const duplicateIdx = seenIdx.get(entry.idx);
    if (duplicateIdx !== undefined) {
      errors.push(`duplicate idx ${entry.idx} for tag ${duplicateIdx} and ${entry.tag}`);
    }
    seenIdx.set(entry.idx, entry.tag);
  }

  return errors;
}

export function checkTimestampAgainstLedger(
  journal: Journal,
  latestLedgerWhen: number | null
): string[] {
  const errors: string[] = [];
  const latestJournal = journal.entries.at(-1);
  if (!latestJournal) return errors;

  // New migrations must be strictly increasing. Historical entries 0000-0019
  // contain duplicate timestamps that must remain unchanged; this check only
  // applies to the latest entry.
  const previousJournal = journal.entries.at(-2);
  if (previousJournal && latestJournal.when <= previousJournal.when) {
    errors.push(
      `latest migration ${latestJournal.tag} timestamp ${latestJournal.when} must be strictly greater than previous ${previousJournal.tag} timestamp ${previousJournal.when}`
    );
  }

  if (latestLedgerWhen !== null && latestJournal.when <= latestLedgerWhen) {
    errors.push(
      `latest migration ${latestJournal.tag} timestamp ${latestJournal.when} must be strictly greater than latest ledger created_at ${latestLedgerWhen}`
    );
  }

  return errors;
}

export async function checkLedgerAgainstJournal(
  databaseUrl: string
): Promise<{ errors: string[]; latestLedgerWhen: number | null }> {
  const errors: string[] = [];
  let latestLedgerWhen: number | null = null;
  const client = postgres(databaseUrl, {
    ssl: process.env.DATABASE_SSL_MODE === "disable" ? false : "require",
    prepare: false,
    max: 1,
    connect_timeout: 10,
  });

  try {
    const tableExists = await client`
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
    `;
    if (tableExists.length === 0) {
      return { errors: [], latestLedgerWhen: null };
    }

    const rows = await client`
      SELECT hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC, id DESC
      LIMIT 1000
    `;

    if (rows.length > 0) {
      latestLedgerWhen = Number(rows[0].created_at);
    }

    const journal = readJournal();
    const ledgerByWhen = new Map<number, string>();
    const ledgerHashes = new Set<string>();
    for (const row of rows) {
      const when = Number(row.created_at);
      const hash = row.hash as string;
      if (ledgerByWhen.has(when) && ledgerByWhen.get(when) !== hash) {
        errors.push(`ledger has duplicate created_at ${when} with different hashes`);
      }
      ledgerByWhen.set(when, hash);
      ledgerHashes.add(hash);
    }

    for (const entry of journal.entries) {
      const expectedHash = fileHash(entry.tag);
      const ledgerHash = ledgerByWhen.get(entry.when);
      if (ledgerHash && ledgerHash !== expectedHash) {
        errors.push(
          `ledger hash mismatch for ${entry.tag}: journal SQL hashes to ${expectedHash}, ledger has ${ledgerHash}`
        );
      }
    }

    // Schema-present / ledger-absent drift detection for governed migrations.
    // Check every unrecorded entry so adding a later migration does not disable
    // drift detection for an earlier governed migration.
    for (const entry of [...journal.entries].reverse()) {
      if (ledgerHashes.has(fileHash(entry.tag))) continue;
      const drift = await detectSchemaDrift(client, entry.tag);
      if (drift.present) {
        errors.push(
          `schema-present/ledger-absent drift: ${entry.tag} schema objects exist (${drift.objects.join(", ")}) but no matching ledger row was found`
        );
      }
    }
  } finally {
    await client.end();
  }

  return { errors, latestLedgerWhen };
}

async function detectSchemaDrift(
  client: postgres.Sql<{}>,
  tag: string
): Promise<{ present: boolean; objects: string[] }> {
  const objects: string[] = [];

  if (tag === "0020_primavera_lite_shell") {
    const tables = ["gantt_wbs_nodes", "gantt_activities"];
    for (const t of tables) {
      const exists = (await client`SELECT to_regclass('public.' || ${t}) as e`)[0].e !== null;
      if (exists) objects.push(t);
    }

    const cols = [
      { table: "gantt_projects", column: "admin_token_hash" },
      { table: "gantt_projects", column: "archived_at" },
    ];
    for (const c of cols) {
      const exists =
        (
          await client`
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ${c.table}
              AND column_name = ${c.column}
          `
        )[0] !== undefined;
      if (exists) objects.push(`${c.table}.${c.column}`);
    }
  }

  if (tag === "0021_primavera_lite_activity_grid") {
    const column = await client`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gantt_activities' AND column_name = 'sort_order'
    `;
    if (column.length > 0) objects.push("gantt_activities.sort_order");
    const index = (await client`SELECT to_regclass('public.gantt_activities_order_idx') as e`)[0].e;
    if (index !== null) objects.push("gantt_activities_order_idx");
  }

  return { present: objects.length > 0, objects };
}

export async function runGovernanceCheck(databaseUrl?: string): Promise<{
  ok: boolean;
  journalErrors: string[];
  ledgerErrors: string[];
  latestLedgerWhen: number | null;
}> {
  const journal = readJournal();
  const journalErrors = checkJournalOrdering(journal);

  if (journalErrors.length > 0) {
    return { ok: false, journalErrors, ledgerErrors: [], latestLedgerWhen: null };
  }

  if (!databaseUrl) {
    return { ok: true, journalErrors: [], ledgerErrors: [], latestLedgerWhen: null };
  }

  const { errors: ledgerErrors, latestLedgerWhen } = await checkLedgerAgainstJournal(databaseUrl);
  const timestampErrors = checkTimestampAgainstLedger(journal, latestLedgerWhen);
  return {
    ok: ledgerErrors.length === 0 && timestampErrors.length === 0,
    journalErrors: [],
    ledgerErrors: [...ledgerErrors, ...timestampErrors],
    latestLedgerWhen,
  };
}

if (process.argv[1]?.endsWith("migration_governance_check.ts")) {
  const databaseUrl = process.argv[2] || process.env.DATABASE_URL;
  const sync = await runGovernanceCheck(databaseUrl);
  if (!sync.ok) {
    if (sync.journalErrors.length > 0) {
      console.error("Journal ordering errors:");
      for (const e of sync.journalErrors) console.error(" -", e);
    }
    if (sync.ledgerErrors.length > 0) {
      console.error("Ledger reconciliation errors:");
      for (const e of sync.ledgerErrors) console.error(" -", e);
    }
    process.exit(1);
  }
  console.log("Migration governance check passed.");
  console.log("Latest ledger when:", sync.latestLedgerWhen);
  console.log("Latest journal when:", readJournal().entries.at(-1)?.when ?? null);
}
