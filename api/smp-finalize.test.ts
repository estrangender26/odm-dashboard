import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { finalizeSmpRevision, type SmpFinalizeTx } from "./smp-finalize";

/**
 * REGRESSION TESTS for the controlled-document revision-state invariant.
 *
 * The previous implementation inserted the new revision as `current` and then
 * superseded every row matching `document_id = X AND status = 'current'` —
 * which matched the freshly inserted row, making the new revision supersede
 * ITSELF. These tests drive the real finalize logic through a minimal
 * in-memory transaction and assert the RESULTING revision-state semantics:
 *
 *   - exactly one current revision per document series after finalize;
 *   - the new revision remains current with superseded_by_revision_id = NULL;
 *   - the previous current revision becomes superseded and points at the new
 *     revision;
 *   - a second current revision for the same document is rejected (mirrors
 *     the migration 0035 partial unique index).
 */

type RevisionRow = {
  id: number;
  documentId: number;
  revision: string;
  revisionNumber: number;
  status: string;
  supersededByRevisionId: number | null;
};

class MemoryTx implements SmpFinalizeTx {
  revisions: RevisionRow[] = [];
  documents: Array<{ id: number; code: string; codeKey: string; title: string }> = [];
  sections: Array<{ documentId: number; revisionId: number; title: string; body: string }> = [];
  tasks: Array<{ documentId: number; revisionId: number; category: string; taskText: string; applicabilityTags?: string[] }> = [];
  nextRevisionId = 1;
  nextDocumentId = 1;
  nextSectionId = 1;
  nextTaskId = 1;

  // Mirrors migration 0035: a document series can have at most one current
  // revision.
  private assertCanInsertCurrent(documentId: number) {
    if (this.revisions.some((r) => r.documentId === documentId && r.status === "current")) {
      throw new Error("unique violation: a current revision already exists for this document");
    }
  }

  async selectRevisions(documentId: number) {
    return this.revisions
      .filter((r) => r.documentId === documentId)
      .map((r) => ({ id: r.id, revision: r.revision, status: r.status }));
  }

  async selectDocumentByCodeKey(codeKey: string) {
    return this.documents.filter((d) => d.codeKey === codeKey).map((d) => ({ id: d.id }));
  }

  async insertDocument(values: Record<string, unknown>) {
    const id = this.nextDocumentId++;
    this.documents.push({ id, ...(values as Partial<typeof this.documents[0]>) } as typeof this.documents[0]);
    return { id };
  }

  async supersedeCurrentRevisions(documentId: number) {
    const matched = this.revisions.filter((r) => r.documentId === documentId && r.status === "current");
    for (const row of matched) {
      row.status = "superseded";
      row.supersededByRevisionId = null; // backfilled once the new id exists
    }
    return matched.map((r) => ({ id: r.id }));
  }

  async insertRevision(values: Record<string, unknown>) {
    if (values.status === "current") {
      this.assertCanInsertCurrent(Number(values.documentId));
    }
    const id = this.nextRevisionId++;
    this.revisions.push({ id, ...(values as Partial<RevisionRow>) } as RevisionRow);
    return { id };
  }

  async backfillSupersededBy(revisionIds: number[], newRevisionId: number) {
    for (const row of this.revisions) {
      if (revisionIds.includes(row.id)) row.supersededByRevisionId = newRevisionId;
    }
  }

  async updateDocumentMirror(documentId: number, values: Record<string, unknown>) {
    const doc = this.documents.find((d) => d.id === documentId);
    if (doc) Object.assign(doc, values);
  }

  async insertSections(documentId: number, revisionId: number, sections: unknown[]) {
    for (const raw of sections as Array<Record<string, unknown>>) {
      this.sections.push({
        documentId,
        revisionId,
        title: String(raw.title ?? ""),
        body: raw.body != null ? String(raw.body) : "",
      });
      this.nextSectionId++;
    }
  }

  async insertTasks(documentId: number, revisionId: number, tasks: unknown[]) {
    for (const raw of tasks as Array<Record<string, unknown>>) {
      this.tasks.push({
        documentId,
        revisionId,
        category: String(raw.category ?? ""),
        taskText: String(raw.taskText ?? ""),
        applicabilityTags: Array.isArray(raw.applicabilityTags) ? raw.applicabilityTags as string[] : undefined,
      });
      this.nextTaskId++;
    }
  }

  currentRevisions() {
    return this.revisions.filter((r) => r.status === "current");
  }
}

function runFinalize(tx: MemoryTx, target: Record<string, unknown>, documentId?: number) {
  return finalizeSmpRevision(tx, {
    documentId,
    target,
    originalFilename: "MW-ENGG-SP-1.0.pdf",
    mimeType: "application/pdf",
    size: 1024,
    storage: {
      provider: "supabase",
      bucket: "smp-library",
      path: "v1/document-1/x",
      size: 1024,
      mimeType: "application/pdf",
      etag: "e1",
      uploadedAt: new Date("2026-03-16T00:00:00.000Z"),
    },
    now: new Date("2026-03-16T00:00:00.000Z"),
    uploaderName: "Operator",
  });
}

describe("SMP revision finalization state semantics", () => {
  it("first revision becomes current with no supersession pointer", async () => {
    const tx = new MemoryTx();
    const { revisionId } = await runFinalize(tx, { revision: "Rev. 0" }, 1);

    expect(tx.revisions).toHaveLength(1);
    expect(tx.revisions[0]).toMatchObject({
      id: revisionId,
      documentId: 1,
      revision: "Rev. 0",
      status: "current",
      supersededByRevisionId: null,
    });
    expect(tx.currentRevisions()).toHaveLength(1);
  });

  it("Rev. 1 finalize supersedes ONLY the previous current revision and never itself", async () => {
    const tx = new MemoryTx();
    await runFinalize(tx, { revision: "Rev. 0" }, 1); // id 1, current
    const { revisionId } = await runFinalize(tx, { revision: "Rev. 1" }, 1); // id 2

    const rev0 = tx.revisions.find((r) => r.revision === "Rev. 0")!;
    const rev1 = tx.revisions.find((r) => r.revision === "Rev. 1")!;

    // Rev. 0: superseded, pointing at Rev. 1.
    expect(rev0.status).toBe("superseded");
    expect(rev0.supersededByRevisionId).toBe(revisionId);
    // Rev. 0 does not point at itself.
    expect(rev0.supersededByRevisionId).not.toBe(rev0.id);

    // Rev. 1: current with NO supersession pointer — it never superseded itself.
    expect(rev1.status).toBe("current");
    expect(rev1.supersededByRevisionId).toBeNull();

    // Exactly one current revision remains.
    expect(tx.currentRevisions()).toEqual([rev1]);
  });

  it("keeps exactly one current revision across many revisions", async () => {
    const tx = new MemoryTx();
    for (const revision of ["Rev. 0", "Rev. 1", "Rev. 2", "Rev. 3"]) {
      await runFinalize(tx, { revision }, 1);
    }

    const currents = tx.currentRevisions();
    expect(currents).toHaveLength(1);
    expect(currents[0].revision).toBe("Rev. 3");
    expect(currents[0].supersededByRevisionId).toBeNull();

    const rev2 = tx.revisions.find((r) => r.revision === "Rev. 2")!;
    expect(rev2.status).toBe("superseded");
    expect(rev2.supersededByRevisionId).toBe(currents[0].id);
  });

  it("rejects a duplicate revision label (no silent overwrite)", async () => {
    const tx = new MemoryTx();
    await runFinalize(tx, { revision: "Rev. 0" }, 1);

    await expect(runFinalize(tx, { revision: "Rev. 0" }, 1)).rejects.toThrow(/already exists/);

    expect(tx.revisions).toHaveLength(1);
    expect(tx.currentRevisions()[0].revision).toBe("Rev. 0");
  });

  it("rejects a second current revision for the same document (database invariant)", async () => {
    const tx = new MemoryTx();
    await runFinalize(tx, { revision: "Rev. 0" }, 1);

    // A rogue insert of a second current revision must be rejected — the same
    // guarantee migration 0035's partial unique index provides in Postgres.
    await expect(
      tx.insertRevision({
        documentId: 1,
        revision: "Rev. 99",
        revisionNumber: 99,
        status: "current",
        supersededByRevisionId: null,
      }),
    ).rejects.toThrow(/unique violation/);

    expect(tx.currentRevisions()).toHaveLength(1);
  });

  it("new-document finalize creates the series and first revision atomically", async () => {
    const tx = new MemoryTx();
    const { documentId, revisionId } = await runFinalize(tx, {
      code: "MW-ENGG-SP-1.0",
      title: "Centrifugal Pump System",
      revision: "Rev. 0",
    });

    expect(tx.documents).toHaveLength(1);
    expect(tx.documents[0]).toMatchObject({
      id: documentId,
      code: "MW-ENGG-SP-1.0",
      codeKey: "mw-engg-sp-1.0",
      title: "Centrifugal Pump System",
    });
    const rev = tx.revisions.find((r) => r.id === revisionId)!;
    expect(rev).toMatchObject({
      documentId,
      revision: "Rev. 0",
      status: "current",
      supersededByRevisionId: null,
    });
    expect(tx.currentRevisions()).toHaveLength(1);
  });
});

it("persists extracted sections and tasks against the new revision", async () => {
    const tx = new MemoryTx();
    const sections = [
      { sectionKey: "sec_1", title: "Purpose", body: "Define scope.", position: 0 },
      { sectionKey: "sec_2", title: "Safety", body: "LOTO required.", position: 1 },
    ];
    const tasks = [
      { category: "operator_driven", taskText: "Check pressure", displayOrder: 0, applicabilityTags: ["All"] },
      { category: "technician_pm", taskText: "Lubricate bearings", displayOrder: 1 },
    ];
    const { documentId, revisionId } = await runFinalize(tx, {
      code: "MW-ENGG-SP-9.0",
      title: "Test",
      revision: "Rev. 0",
      sections,
      tasks,
    });

    expect(tx.sections).toHaveLength(2);
    expect(tx.sections.every((s) => s.documentId === documentId && s.revisionId === revisionId)).toBe(true);
    expect(tx.sections[0]).toMatchObject({ title: "Purpose", body: "Define scope." });
    expect(tx.tasks).toHaveLength(2);
    expect(tx.tasks.every((t) => t.documentId === documentId && t.revisionId === revisionId)).toBe(true);
    expect(tx.tasks[0]).toMatchObject({ category: "operator_driven", taskText: "Check pressure", applicabilityTags: ["All"] });
  });

describe("SMP finalize source ordering guard", () => {
  const source = readFileSync(join(process.cwd(), "api/smp-finalize.ts"), "utf8");

  it("supersedes the previous current revision BEFORE inserting the new revision", () => {
    const supersedeIndex = source.indexOf("supersedeCurrentRevisions(documentId)");
    const insertIndex = source.indexOf("tx.insertRevision({");
    const backfillIndex = source.indexOf("tx.backfillSupersededBy(previousIds");
    expect(supersedeIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(supersedeIndex);
    expect(backfillIndex).toBeGreaterThan(insertIndex);
  });

  it("inserts the new revision as current with no supersession pointer", () => {
    const insertBlock = source.slice(source.indexOf("tx.insertRevision({"), source.indexOf("});", source.indexOf("tx.insertRevision({")));
    expect(insertBlock).toContain('status: "current"');
    expect(insertBlock).toContain("supersededByRevisionId: null");
  });

  it("never lets the new revision be its own predecessor", () => {
    const logicSource = readFileSync(join(process.cwd(), "api/smp-logic.ts"), "utf8");
    expect(logicSource).toContain("resolveSupersessionBackfill");
    expect(logicSource).toContain("id !== newRevisionId");
  });
});
