import { describe, it, expect } from "vitest";
import { checkJournalOrdering, checkTimestampAgainstLedger } from "../../scripts/migration_governance_check";

const baseEntry = { version: "7", breakpoints: true };

function makeJournal(entries: { idx: number; tag: string; when: number }[]) {
  return {
    version: "7",
    dialect: "postgresql",
    entries: entries.map((e) => ({ ...baseEntry, ...e })),
  };
}

describe("migration governance check", () => {
  it("allows historical duplicate timestamps and rejects only the latest when not increasing", () => {
    const journal = makeJournal([
      { idx: 0, tag: "0000_serious_echo", when: 1 },
      { idx: 1, tag: "0001_familiarity_column", when: 2 },
      { idx: 2, tag: "0002_gantt_projects", when: 3 },
      { idx: 3, tag: "0003_tasks_procedure_familiarity", when: 4 },
      { idx: 4, tag: "0004_require_tasks_procedure_familiarity", when: 4 }, // historical duplicate
      { idx: 5, tag: "0020_primavera_lite_shell", when: 5 },
    ]);
    expect(checkJournalOrdering(journal)).toEqual([]);
    const ledgerErrors = checkTimestampAgainstLedger(journal, 4);
    expect(ledgerErrors).toEqual([]);
  });

  it("rejects latest migration timestamp equal to previous", () => {
    const journal = makeJournal([
      { idx: 0, tag: "0000_serious_echo", when: 1 },
      { idx: 1, tag: "0020_primavera_lite_shell", when: 1 },
    ]);
    const ledgerErrors = checkTimestampAgainstLedger(journal, 0);
    expect(ledgerErrors.length).toBeGreaterThan(0);
    expect(ledgerErrors[0]).toMatch(/must be strictly greater than previous/);
  });

  it("rejects latest migration timestamp not greater than ledger", () => {
    const journal = makeJournal([
      { idx: 0, tag: "0019_gantt_link_sharing", when: 100 },
      { idx: 1, tag: "0020_primavera_lite_shell", when: 100 },
    ]);
    const ledgerErrors = checkTimestampAgainstLedger(journal, 100);
    expect(ledgerErrors.length).toBeGreaterThan(0);
    expect(ledgerErrors.some((e) => e.includes("latest ledger created_at"))).toBe(true);
  });

  it("flags duplicate tags and indices", () => {
    const journal = makeJournal([
      { idx: 0, tag: "0000_serious_echo", when: 1 },
      { idx: 1, tag: "0000_serious_echo", when: 2 },
    ]);
    const errors = checkJournalOrdering(journal);
    expect(errors.some((e) => e.includes("duplicate tag"))).toBe(true);
  });
});
