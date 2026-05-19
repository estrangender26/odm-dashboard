import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "./queries/connection";
import { smpDocuments } from "@db/schema";
import { createRouter, publicQuery } from "./middleware";

// ── Auto-create smp_documents table if it doesn't exist ──
async function ensureSmpTable() {
  try {
    await db.execute(sql.raw(`SELECT 1 FROM smp_documents LIMIT 1`));
  } catch {
    console.log("[SMP] Creating smp_documents table...");
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS smp_documents (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) NOT NULL,
        title VARCHAR(500) NOT NULL,
        revision VARCHAR(50) DEFAULT 'Rev. 1',
        equipment_type VARCHAR(100),
        system VARCHAR(100),
        date_issued VARCHAR(20),
        next_review VARCHAR(20),
        status VARCHAR(50) DEFAULT 'Active',
        responsible_party VARCHAR(255),
        file_data TEXT,
        file_type VARCHAR(100),
        file_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS smp_equip_idx ON smp_documents(equipment_type)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS smp_system_idx ON smp_documents(system)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS smp_status_idx ON smp_documents(status)`));
    console.log("[SMP] smp_documents table created.");
  }
}

export const smpRouter = createRouter({
  /* ── 1. LIST ALL ── */
  list: publicQuery.query(async () => {
    await ensureSmpTable();
    const rows = await db.select().from(smpDocuments).orderBy(smpDocuments.code);
    return { items: rows, count: rows.length };
  }),

  /* ── 2. GET SINGLE ── */
  get: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      await ensureSmpTable();
      const rows = await db.select().from(smpDocuments).where(eq(smpDocuments.id, input.id)).limit(1);
      return rows[0] || null;
    }),

  /* ── 3. CREATE ── */
  create: publicQuery
    .input(z.object({
      code: z.string().min(1),
      title: z.string().min(1),
      revision: z.string().optional(),
      equipmentType: z.string().optional(),
      system: z.string().optional(),
      dateIssued: z.string().optional(),
      nextReview: z.string().optional(),
      status: z.string().optional(),
      responsibleParty: z.string().optional(),
      fileData: z.string().optional(),
      fileType: z.string().optional(),
      fileName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await ensureSmpTable();
      const result = await db.insert(smpDocuments).values({
        code: input.code,
        title: input.title,
        revision: input.revision || "Rev. 1",
        equipmentType: input.equipmentType || null,
        system: input.system || null,
        dateIssued: input.dateIssued || null,
        nextReview: input.nextReview || null,
        status: input.status || "Active",
        responsibleParty: input.responsibleParty || null,
        fileData: input.fileData || null,
        fileType: input.fileType || null,
        fileName: input.fileName || null,
      }).returning();
      return result[0];
    }),

  /* ── 4. UPDATE ── */
  update: publicQuery
    .input(z.object({
      id: z.number(),
      code: z.string().optional(),
      title: z.string().optional(),
      revision: z.string().optional(),
      equipmentType: z.string().optional(),
      system: z.string().optional(),
      dateIssued: z.string().optional(),
      nextReview: z.string().optional(),
      status: z.string().optional(),
      responsibleParty: z.string().optional(),
      fileData: z.string().optional(),
      fileType: z.string().optional(),
      fileName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await ensureSmpTable();
      const { id, ...data } = input;
      const clean: Record<string, any> = {};
      if (data.code !== undefined) clean.code = data.code;
      if (data.title !== undefined) clean.title = data.title;
      if (data.revision !== undefined) clean.revision = data.revision;
      if (data.equipmentType !== undefined) clean.equipmentType = data.equipmentType || null;
      if (data.system !== undefined) clean.system = data.system || null;
      if (data.dateIssued !== undefined) clean.dateIssued = data.dateIssued || null;
      if (data.nextReview !== undefined) clean.nextReview = data.nextReview || null;
      if (data.status !== undefined) clean.status = data.status;
      if (data.responsibleParty !== undefined) clean.responsibleParty = data.responsibleParty || null;
      if (data.fileData !== undefined) clean.fileData = data.fileData || null;
      if (data.fileType !== undefined) clean.fileType = data.fileType || null;
      if (data.fileName !== undefined) clean.fileName = data.fileName || null;
      clean.updatedAt = new Date();
      const result = await db.update(smpDocuments).set(clean).where(eq(smpDocuments.id, id)).returning();
      return result[0];
    }),

  /* ── 5. DELETE ── */
  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await ensureSmpTable();
      await db.delete(smpDocuments).where(eq(smpDocuments.id, input.id));
      return { deleted: true, id: input.id };
    }),

  /* ── 6. SEED (load 15 demo docs) ── */
  seed: publicQuery.mutation(async () => {
    await ensureSmpTable();
    const existing = await db.select().from(smpDocuments);
    if (existing.length > 0) return { seeded: false, reason: "Documents already exist" };

    const demos = [
      { code: "SMP-EQP-001", title: "Pump Preventive Maintenance - Monthly", revision: "Rev. 2", equipmentType: "Pumps", system: "Water Supply", dateIssued: "2024-01-15", nextReview: "2025-01-15", status: "Active", responsibleParty: "Maintenance" },
      { code: "SMP-EQP-002", title: "Motor Bearing Inspection - Quarterly", revision: "Rev. 1", equipmentType: "Motors", system: "Electrical", dateIssued: "2024-03-20", nextReview: "2025-03-20", status: "Active", responsibleParty: "Maintenance" },
      { code: "SMP-EQP-003", title: "Blower Vibration Check - Weekly", revision: "Rev. 3", equipmentType: "Blowers", system: "Aeration", dateIssued: "2023-06-10", nextReview: "2024-06-10", status: "Under Review", responsibleParty: "Engineering" },
      { code: "SMP-EQP-004", title: "Valve Inspection and Lubrication - Monthly", revision: "Rev. 1", equipmentType: "Valves", system: "Water Supply", dateIssued: "2024-02-01", nextReview: "2025-02-01", status: "Active", responsibleParty: "Operations" },
      { code: "SMP-EQP-005", title: "Generator Load Test - Monthly", revision: "Rev. 2", equipmentType: "Generators", system: "Backup Power", dateIssued: "2024-01-10", nextReview: "2025-01-10", status: "Active", responsibleParty: "Electrical" },
      { code: "SMP-EQP-006", title: "Transformer Oil Analysis - Annual", revision: "Rev. 1", equipmentType: "Transformers", system: "Electrical", dateIssued: "2023-08-15", nextReview: "2024-08-15", status: "Expired", responsibleParty: "Electrical" },
      { code: "SMP-EQP-007", title: "Flow Meter Calibration - Quarterly", revision: "Rev. 2", equipmentType: "Instrumentation", system: "SCADA", dateIssued: "2024-04-01", nextReview: "2025-04-01", status: "Active", responsibleParty: "Instrumentation" },
      { code: "SMP-PLC-001", title: "PLC/SCADA System Backup - Monthly", revision: "Rev. 4", equipmentType: "PLC / SCADA", system: "Automation", dateIssued: "2024-01-01", nextReview: "2025-01-01", status: "Active", responsibleParty: "IT/Automation" },
      { code: "SMP-HVC-001", title: "HVAC Filter Replacement - Monthly", revision: "Rev. 1", equipmentType: "HVAC", system: "Building", dateIssued: "2024-02-15", nextReview: "2025-02-15", status: "Active", responsibleParty: "Facilities" },
      { code: "SMP-EQP-008", title: "Compressor Oil Change - Quarterly", revision: "Rev. 2", equipmentType: "Compressors", system: "Air Supply", dateIssued: "2024-03-01", nextReview: "2025-03-01", status: "Active", responsibleParty: "Maintenance" },
      { code: "SMP-CHM-001", title: "Chemical Dosing Pump Calibration - Monthly", revision: "Rev. 1", equipmentType: "Chemical Dosing", system: "Treatment", dateIssued: "2024-01-20", nextReview: "2025-01-20", status: "Active", responsibleParty: "Chemical" },
      { code: "SMP-FLT-001", title: "Sand Filter Backwash Procedure - Weekly", revision: "Rev. 3", equipmentType: "Filters", system: "Treatment", dateIssued: "2023-09-01", nextReview: "2024-09-01", status: "Under Review", responsibleParty: "Operations" },
      { code: "SMP-EQP-009", title: "UV System Lamp Replacement - Annual", revision: "Rev. 1", equipmentType: "UV / Disinfection", system: "Disinfection", dateIssued: "2024-05-01", nextReview: "2025-05-01", status: "Active", responsibleParty: "Maintenance" },
      { code: "SMP-TNK-001", title: "Tank Internal Inspection - Annual", revision: "Rev. 2", equipmentType: "Tanks", system: "Storage", dateIssued: "2023-11-01", nextReview: "2024-11-01", status: "Under Review", responsibleParty: "Engineering" },
      { code: "SMP-SCR-001", title: "Bar Screen Cleaning - Daily", revision: "Rev. 1", equipmentType: "Screens", system: "Inlet", dateIssued: "2024-06-01", nextReview: "2025-06-01", status: "Active", responsibleParty: "Operations" },
    ];

    await db.insert(smpDocuments).values(demos);
    return { seeded: true, count: demos.length };
  }),
});
