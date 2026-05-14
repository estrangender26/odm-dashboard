import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { existingFacilitiesMaintenance } from "@db/schema";
import { eq, and, like, sql, count } from "drizzle-orm";

// Ensure the table exists (auto-create on first access)
async function ensureTable() {
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS existing_facilities_maintenance (
        id SERIAL PRIMARY KEY,
        plant VARCHAR(255) NOT NULL,
        equipment_type VARCHAR(255) DEFAULT '',
        task TEXT NOT NULL,
        frequency VARCHAR(100) NOT NULL,
        implementor VARCHAR(255),
        status VARCHAR(50) DEFAULT 'Active',
        last_completed VARCHAR(20),
        next_due VARCHAR(20),
        remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `));
    // Create indexes
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS efm_plant_idx ON existing_facilities_maintenance(plant)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS efm_equip_idx ON existing_facilities_maintenance(equipment_type)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS efm_freq_idx ON existing_facilities_maintenance(frequency)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS efm_impl_idx ON existing_facilities_maintenance(implementor)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS efm_status_idx ON existing_facilities_maintenance(status)`));
  } catch (e) {
    // Table may already exist, that's fine
  }
}

export const efmRouter = createRouter({
  // ── List all records with search/filter/pagination ──
  list: publicQuery
    .input(z.object({
      search: z.string().optional(),
      plantFilter: z.string().optional(),
      equipFilter: z.string().optional(),
      freqFilter: z.string().optional(),
      implFilter: z.string().optional(),
      statusFilter: z.string().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(50),
    }).optional())
    .query(async ({ input }) => {
      await ensureTable();
      const opts = input || {};
      const { search, plantFilter, equipFilter, freqFilter, implFilter, statusFilter, page, pageSize } = opts;
      const offset = ((page || 1) - 1) * (pageSize || 50);

      const conditions = [];
      if (search) {
        conditions.push(
          sql`(${existingFacilitiesMaintenance.plant} ILIKE ${'%' + search + '%'} OR ${existingFacilitiesMaintenance.task} ILIKE ${'%' + search + '%'} OR ${existingFacilitiesMaintenance.equipmentType} ILIKE ${'%' + search + '%'})`
        );
      }
      if (plantFilter) {
        conditions.push(like(existingFacilitiesMaintenance.plant, '%' + plantFilter + '%'));
      }
      if (equipFilter) {
        conditions.push(like(existingFacilitiesMaintenance.equipmentType, '%' + equipFilter + '%'));
      }
      if (freqFilter) {
        conditions.push(like(existingFacilitiesMaintenance.frequency, '%' + freqFilter + '%'));
      }
      if (implFilter) {
        conditions.push(like(existingFacilitiesMaintenance.implementor, '%' + implFilter + '%'));
      }
      if (statusFilter) {
        conditions.push(eq(existingFacilitiesMaintenance.status, statusFilter));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const items = await db.select().from(existingFacilitiesMaintenance)
        .where(where)
        .orderBy(existingFacilitiesMaintenance.plant, existingFacilitiesMaintenance.equipmentType)
        .limit(pageSize || 50)
        .offset(offset);

      const [{ value: totalCount }] = await db.select({ value: count() })
        .from(existingFacilitiesMaintenance).where(where);

      // Group by plant then equipment type
      const groups: Record<string, Record<string, any[]>> = {};
      for (const item of items) {
        const p = item.plant;
        const e = item.equipmentType || "General";
        if (!groups[p]) groups[p] = {};
        if (!groups[p][e]) groups[p][e] = [];
        groups[p][e].push(item);
      }

      return {
        items,
        groups,
        total: totalCount,
        page: page || 1,
        pageSize: pageSize || 50,
        totalPages: Math.ceil(totalCount / (pageSize || 50)),
      };
    }),

  // ── Get unique filter values ──
  filters: publicQuery.query(async () => {
    await ensureTable();
    const plants = await db.selectDistinct({ plant: existingFacilitiesMaintenance.plant })
      .from(existingFacilitiesMaintenance).orderBy(existingFacilitiesMaintenance.plant);
    const equipTypes = await db.selectDistinct({ equipmentType: existingFacilitiesMaintenance.equipmentType })
      .from(existingFacilitiesMaintenance).orderBy(existingFacilitiesMaintenance.equipmentType);
    const frequencies = await db.selectDistinct({ frequency: existingFacilitiesMaintenance.frequency })
      .from(existingFacilitiesMaintenance).orderBy(existingFacilitiesMaintenance.frequency);
    const implementors = await db.selectDistinct({ implementor: existingFacilitiesMaintenance.implementor })
      .from(existingFacilitiesMaintenance).orderBy(existingFacilitiesMaintenance.implementor);
    const statuses = await db.selectDistinct({ status: existingFacilitiesMaintenance.status })
      .from(existingFacilitiesMaintenance).orderBy(existingFacilitiesMaintenance.status);

    return {
      plants: plants.map((r) => r.plant).filter(Boolean),
      equipmentTypes: equipTypes.map((r) => r.equipmentType).filter(Boolean),
      frequencies: frequencies.map((r) => r.frequency).filter(Boolean),
      implementors: implementors.map((r) => r.implementor).filter(Boolean),
      statuses: statuses.map((r) => r.status).filter(Boolean),
    };
  }),

  // ── Create new record ──
  create: publicQuery
    .input(z.object({
      plant: z.string().min(1),
      equipmentType: z.string().optional(),
      task: z.string().min(1),
      frequency: z.string().min(1),
      implementor: z.string().optional(),
      status: z.string().optional(),
      lastCompleted: z.string().optional(),
      nextDue: z.string().optional(),
      remarks: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await ensureTable();
      const [result] = await db.insert(existingFacilitiesMaintenance).values({
        plant: input.plant.trim(),
        equipmentType: (input.equipmentType || "").trim(),
        task: input.task.trim(),
        frequency: (input.frequency || "As needed").trim(),
        implementor: (input.implementor || "").trim() || null,
        status: (input.status || "Active").trim(),
        lastCompleted: (input.lastCompleted || "").trim() || null,
        nextDue: (input.nextDue || "").trim() || null,
        remarks: (input.remarks || "").trim() || null,
      }).returning();
      return result;
    }),

  // ── Update record ──
  update: publicQuery
    .input(z.object({
      id: z.number(),
      plant: z.string().optional(),
      equipmentType: z.string().optional(),
      task: z.string().optional(),
      frequency: z.string().optional(),
      implementor: z.string().optional(),
      status: z.string().optional(),
      lastCompleted: z.string().optional(),
      nextDue: z.string().optional(),
      remarks: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await ensureTable();
      const { id, ...fields } = input;
      const updates: Record<string, any> = {};
      Object.entries(fields).forEach(([key, val]) => {
        if (val !== undefined) updates[key] = val;
      });
      if (Object.keys(updates).length === 0) return null;
      updates.updatedAt = new Date();

      const [result] = await db.update(existingFacilitiesMaintenance)
        .set(updates)
        .where(eq(existingFacilitiesMaintenance.id, id))
        .returning();
      return result;
    }),

  // ── Delete record ──
  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await ensureTable();
      await db.delete(existingFacilitiesMaintenance)
        .where(eq(existingFacilitiesMaintenance.id, input.id));
      return { success: true };
    }),

  // ── Bulk import with batch insert, duplicate detection, per-row error handling ──
  importExcel: publicQuery
    .input(z.object({
      rows: z.array(z.object({
        plant: z.string().min(1),
        equipmentType: z.string().optional(),
        task: z.string().min(1),
        frequency: z.string().optional(),
        implementor: z.string().optional(),
        status: z.string().optional(),
        lastCompleted: z.string().optional(),
        nextDue: z.string().optional(),
        remarks: z.string().optional(),
        _sourceSheet: z.string().optional(),
        _sourceRow: z.number().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      await ensureTable();

      const inserted: any[] = [];
      const skipped: { row: number; sheet: string; reason: string }[] = [];
      const failed: { row: number; sheet: string; reason: string }[] = [];
      const duplicates: { row: number; sheet: string; key: string }[] = [];

      // Build a set of existing composite keys for duplicate detection
      const existingKeys = new Set<string>();
      try {
        const allRecords = await db.select().from(existingFacilitiesMaintenance);
        for (const rec of allRecords) {
          const key = `${rec.plant}::${rec.equipmentType || ""}::${rec.task}::${rec.frequency || ""}::${rec.implementor || ""}`;
          existingKeys.add(key);
        }
      } catch {
        // If select fails, proceed without duplicate detection
      }

      // Normalize and deduplicate incoming rows
      const normalizedRows = input.rows.map((row, idx) => {
        const plant = (row.plant || "").trim();
        const task = (row.task || "").trim();
        const equipmentType = (row.equipmentType || "").trim();
        const frequency = (row.frequency || "").trim() || "As needed";
        const implementor = (row.implementor || "").trim() || null;
        const status = (row.status || "").trim() || "Active";
        const lastCompleted = (row.lastCompleted || "").trim() || null;
        const nextDue = (row.nextDue || "").trim() || null;
        const remarks = (row.remarks || "").trim() || null;
        const dupKey = `${plant}::${equipmentType}::${task}::${frequency}::${implementor || ""}`;
        return {
          plant, task, equipmentType, frequency, implementor, status,
          lastCompleted, nextDue, remarks,
          _sourceSheet: row._sourceSheet || "Sheet1",
          _sourceRow: row._sourceRow || idx + 1,
          _dupKey: dupKey,
          _incomingIdx: idx,
        };
      });

      // Separate valid rows from skipped (missing required fields)
      const validRows: typeof normalizedRows = [];
      for (const row of normalizedRows) {
        if (!row.plant || !row.task) {
          skipped.push({ row: row._sourceRow, sheet: row._sourceSheet, reason: "Missing Plant or Task" });
          continue;
        }
        // Check for duplicates against existing database
        if (existingKeys.has(row._dupKey)) {
          duplicates.push({ row: row._sourceRow, sheet: row._sourceSheet, key: row._dupKey });
          continue;
        }
        // Check for duplicates within this same import batch
        const firstIdx = validRows.findIndex((r) => r._dupKey === row._dupKey);
        if (firstIdx >= 0) {
          duplicates.push({ row: row._sourceRow, sheet: row._sourceSheet, key: row._dupKey });
          continue;
        }
        validRows.push(row);
      }

      // Insert in batches of 50 — per-row error recovery
      const BATCH_SIZE = 50;
      for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
        const batch = validRows.slice(i, i + BATCH_SIZE);
        try {
          // Try batch insert first
          await db.insert(existingFacilitiesMaintenance).values(
            batch.map((r) => ({
              plant: r.plant,
              equipmentType: r.equipmentType,
              task: r.task,
              frequency: r.frequency,
              implementor: r.implementor,
              status: r.status,
              lastCompleted: r.lastCompleted,
              nextDue: r.nextDue,
              remarks: r.remarks,
            }))
          );
          inserted.push(...batch);
        } catch (batchErr: any) {
          // Batch failed — try row-by-row for this chunk
          console.error(`[IMPORT] Batch ${i}-${i + batch.length} failed, trying per-row:`, batchErr.message);
          for (const row of batch) {
            try {
              await db.insert(existingFacilitiesMaintenance).values({
                plant: row.plant,
                equipmentType: row.equipmentType,
                task: row.task,
                frequency: row.frequency,
                implementor: row.implementor,
                status: row.status,
                lastCompleted: row.lastCompleted,
                nextDue: row.nextDue,
                remarks: row.remarks,
              });
              inserted.push(row);
            } catch (rowErr: any) {
              failed.push({ row: row._sourceRow, sheet: row._sourceSheet, reason: rowErr.message || "Database insert failed" });
            }
          }
        }
      }

      return {
        success: true,
        count: inserted.length,
        skipped: skipped.length,
        failed: failed.length,
        duplicates: duplicates.length,
        totalReceived: input.rows.length,
        details: { skipped, failed, duplicates: duplicates.slice(0, 20) },
      };
    }),

  // ── Seed from complete Excel data ──
  seed: publicQuery.mutation(async () => {
    await ensureTable();
    const count = await db.select({ count: sql<number>`count(*)` })
      .from(existingFacilitiesMaintenance);
    if ((count[0]?.count || 0) > 0) {
      return { seeded: false, reason: "Data already exists", count: count[0]?.count };
    }

    // Ensure equipment_type column exists
    await db.execute(sql.raw(`
      ALTER TABLE existing_facilities_maintenance 
      ADD COLUMN IF NOT EXISTS equipment_type VARCHAR(255) DEFAULT ''
    `));

    // Complete data from Consolidated_Maintenance_Plans_with_Equipment.xlsx
    const allTasks = [
      // DELOS SANTOS PUMPING STATION
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Inspect for leaks (Oil lines and Fuel Lines)", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Check for leakage in mechanical seals and pump drive end", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Check for corrosion of contact parts", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Regular cleaning (wiping out dust and other particles)", frequency: "Weekly", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Pumps and Motors Preventive Maintenance (Electromech PM)", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "External visual inspection for corrosion and physical damage", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Verify bolt tightening", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Preventive Maintenance and Repairs", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Visual inspection of wirings and connections", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Regular monitoring of voltage and current at MCC panel", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Regular observation of surroundings for safety", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Preventive Maintenance (High Voltage / HV PM)", frequency: "Annually", implementor: "Maintenance/Contractor" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Visual inspection of HV/LV bushing, surge arrester, tank", frequency: "Monthly", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Oil tightness check", frequency: "Monthly", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Oil level check", frequency: "Monthly", implementor: "SLA" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Surface cleaning", frequency: "Quarterly", implementor: "SLA" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Connections tightness", frequency: "Semi-annual", implementor: "SLA" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Painting state inspection", frequency: "Annually", implementor: "SLA" },
      { plant: "Delos Santos PS", equipmentType: "1. Generator Set", task: "Earth resistance check", frequency: "As needed", implementor: "SLA" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Inspect for leaks (Oil lines and Fuel Lines)", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Check for leakage in mechanical seals and pump drive end", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Check for corrosion of contact parts", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Regular cleaning (wiping out dust and other particles)", frequency: "Weekly", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Pumps and Motors Preventive Maintenance (Electromech PM)", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "External visual inspection for corrosion and physical damage", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Verify bolt tightening", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Preventive Maintenance and Repairs", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Visual inspection of wirings and connections", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Regular monitoring of voltage and current at MCC panel", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Regular observation of surroundings for safety", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Preventive Maintenance (High Voltage / HV PM)", frequency: "Annually", implementor: "Maintenance/Contractor" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Visual inspection of HV/LV bushing, surge arrester, tank", frequency: "Monthly", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Oil tightness check", frequency: "Monthly", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Oil level check", frequency: "Monthly", implementor: "SLA" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Surface cleaning", frequency: "Quarterly", implementor: "SLA" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Connections tightness", frequency: "Semi-annual", implementor: "SLA" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Painting state inspection", frequency: "Annually", implementor: "SLA" },
      { plant: "Delos Santos PS", equipmentType: "2. Pumps and Motors", task: "Earth resistance check", frequency: "As needed", implementor: "SLA" },
      { plant: "Delos Santos PS", equipmentType: "3. Air Valves", task: "Inspect for leaks (Oil lines and Fuel Lines)", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "3. Air Valves", task: "Check for leakage in mechanical seals and pump drive end", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "3. Air Valves", task: "Check for corrosion of contact parts", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "3. Air Valves", task: "Regular cleaning (wiping out dust and other particles)", frequency: "Weekly", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "3. Air Valves", task: "Pumps and Motors Preventive Maintenance (Electromech PM)", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      { plant: "Delos Santos PS", equipmentType: "3. Air Valves", task: "External visual inspection for corrosion and physical damage", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "3. Air Valves", task: "Verify bolt tightening", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "3. Air Valves", task: "Preventive Maintenance and Repairs", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      { plant: "Delos Santos PS", equipmentType: "3. Air Valves", task: "Visual inspection of wirings and connections", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "3. Air Valves", task: "Regular monitoring of voltage and current at MCC panel", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "3. Air Valves", task: "Regular observation of surroundings for safety", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "4. Motorized Valves (MOV)", task: "Preventive Maintenance (High Voltage / HV PM)", frequency: "Annually", implementor: "Maintenance/Contractor" },
      { plant: "Delos Santos PS", equipmentType: "4. Motorized Valves (MOV)", task: "Visual inspection of HV/LV bushing, surge arrester, tank", frequency: "Monthly", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "4. Motorized Valves (MOV)", task: "Oil tightness check", frequency: "Monthly", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "4. Motorized Valves (MOV)", task: "Oil level check", frequency: "Monthly", implementor: "SLA" },
      { plant: "Delos Santos PS", equipmentType: "4. Motorized Valves (MOV)", task: "Surface cleaning", frequency: "Quarterly", implementor: "SLA" },
      { plant: "Delos Santos PS", equipmentType: "4. Motorized Valves (MOV)", task: "Connections tightness", frequency: "Semi-annual", implementor: "SLA" },
      { plant: "Delos Santos PS", equipmentType: "4. Motorized Valves (MOV)", task: "Painting state inspection", frequency: "Annually", implementor: "SLA" },
      { plant: "Delos Santos PS", equipmentType: "4. Motorized Valves (MOV)", task: "Earth resistance check", frequency: "As needed", implementor: "SLA" },
      { plant: "Delos Santos PS", equipmentType: "5. Air Conditioning Units", task: "Inspect for leaks (Oil lines and Fuel Lines)", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "5. Air Conditioning Units", task: "Check for leakage in mechanical seals and pump drive end", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "5. Air Conditioning Units", task: "Check for corrosion of contact parts", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "5. Air Conditioning Units", task: "Regular cleaning (wiping out dust and other particles)", frequency: "Weekly", implementor: "Operator/Shifthead" },
      { plant: "Delos Santos PS", equipmentType: "5. Air Conditioning Units", task: "Pumps and Motors Preventive Maintenance (Electromech PM)", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      // EAST LAMESA PUMPING
      { plant: "East lamesa Pumping", equipmentType: "1. High Voltage (Transformer)", task: "Inspect for leaks (Oil lines and Fuel Lines)", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "1. High Voltage (Transformer)", task: "Check for leakage in mechanical seals and pump drive end", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "1. High Voltage (Transformer)", task: "Check for corrosion of contact parts", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "1. High Voltage (Transformer)", task: "Regular cleaning (wiping out dust and other particles)", frequency: "Weekly", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "1. High Voltage (Transformer)", task: "Pumps and Motors Preventive Maintenance (Electromech PM)", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      { plant: "East lamesa Pumping", equipmentType: "1. High Voltage (Transformer)", task: "External visual inspection for corrosion and physical damage", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "1. High Voltage (Transformer)", task: "Verify bolt tightening", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "1. High Voltage (Transformer)", task: "Preventive Maintenance and Repairs", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      { plant: "East lamesa Pumping", equipmentType: "2. Low Voltage (Motor Control Center (MCC) | Switchgear | Panelboard | Low voltage distribution board)", task: "Visual inspection of wirings and connections", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "2. Low Voltage (Motor Control Center (MCC) | Switchgear | Panelboard | Low voltage distribution board)", task: "Regular monitoring of voltage and current at MCC panel", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "2. Low Voltage (Motor Control Center (MCC) | Switchgear | Panelboard | Low voltage distribution board)", task: "Regular observation of surroundings for safety", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "4. PAD MOUNTED TRANSFORMER", task: "Preventive Maintenance (High Voltage / HV PM)", frequency: "Annually", implementor: "Maintenance/Contractor" },
      { plant: "East lamesa Pumping", equipmentType: "4. PAD MOUNTED TRANSFORMER", task: "Visual inspection of HV/LV bushing, surge arrester, tank", frequency: "Monthly", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "4. PAD MOUNTED TRANSFORMER", task: "Oil tightness check", frequency: "Monthly", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "5. Solar Inverter House and Panels", task: "Oil level check", frequency: "Monthly", implementor: "SLA" },
      { plant: "East lamesa Pumping", equipmentType: "5. Solar Inverter House and Panels", task: "Surface cleaning", frequency: "Quarterly", implementor: "SLA" },
      { plant: "East lamesa Pumping", equipmentType: "5. Solar Inverter House and Panels", task: "Connections tightness", frequency: "Semi-annual", implementor: "SLA" },
      { plant: "East lamesa Pumping", equipmentType: "1. Flowmeters", task: "Inspect for leaks (Oil lines and Fuel Lines)", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "1. Flowmeters", task: "Check for leakage in mechanical seals and pump drive end", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "1. Flowmeters", task: "Check for corrosion of contact parts", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "1. Flowmeters", task: "Regular cleaning (wiping out dust and other particles)", frequency: "Weekly", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "2. Flow Transmitter", task: "Pumps and Motors Preventive Maintenance (Electromech PM)", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      { plant: "East lamesa Pumping", equipmentType: "2. Flow Transmitter", task: "External visual inspection for corrosion and physical damage", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "2. Flow Transmitter", task: "Verify bolt tightening", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "3. Level Switch", task: "Preventive Maintenance and Repairs", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      { plant: "East lamesa Pumping", equipmentType: "3. Level Switch", task: "Visual inspection of wirings and connections", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "4. Pressure Switch", task: "Regular monitoring of voltage and current at MCC panel", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "4. Pressure Switch", task: "Regular observation of surroundings for safety", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "5. Level Transmitter", task: "Preventive Maintenance (High Voltage / HV PM)", frequency: "Annually", implementor: "Maintenance/Contractor" },
      { plant: "East lamesa Pumping", equipmentType: "5. Level Transmitter", task: "Visual inspection of HV/LV bushing, surge arrester, tank", frequency: "Monthly", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "6. Pressure Transmitter", task: "Oil tightness check", frequency: "Monthly", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "6. Pressure Transmitter", task: "Oil level check", frequency: "Monthly", implementor: "SLA" },
      { plant: "East lamesa Pumping", equipmentType: "7. Pressure Gauge", task: "Surface cleaning", frequency: "Quarterly", implementor: "SLA" },
      { plant: "East lamesa Pumping", equipmentType: "7. Pressure Gauge", task: "Connections tightness", frequency: "Semi-annual", implementor: "SLA" },
      { plant: "East lamesa Pumping", equipmentType: "8. SCADA/PLC Panel", task: "Painting state inspection", frequency: "Annually", implementor: "SLA" },
      { plant: "East lamesa Pumping", equipmentType: "8. SCADA/PLC Panel", task: "Earth resistance check", frequency: "As needed", implementor: "SLA" },
      { plant: "East lamesa Pumping", equipmentType: "1. Automation", task: "Inspect for leaks (Oil lines and Fuel Lines)", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "1. Automation", task: "Check for leakage in mechanical seals and pump drive end", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "1. Automation", task: "Check for corrosion of contact parts", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "East lamesa Pumping", equipmentType: "1. Automation", task: "Regular cleaning (wiping out dust and other particles)", frequency: "Weekly", implementor: "Operator/Shifthead" },
      // MODESTA PUMPING STATION
      { plant: "Modesta PS", equipmentType: "1. Generator Set", task: "Inspect for leaks (Oil lines and Fuel Lines)", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "1. Generator Set", task: "Check for leakage in mechanical seals and pump drive end", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "1. Generator Set", task: "Check for corrosion of contact parts", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "1. Generator Set", task: "Regular cleaning (wiping out dust and other particles)", frequency: "Weekly", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "2. Pumps and Motors", task: "Pumps and Motors Preventive Maintenance (Electromech PM)", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      { plant: "Modesta PS", equipmentType: "2. Pumps and Motors", task: "External visual inspection for corrosion and physical damage", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "2. Pumps and Motors", task: "Verify bolt tightening", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "2. Pumps and Motors", task: "Preventive Maintenance and Repairs", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      { plant: "Modesta PS", equipmentType: "3. Air Valves", task: "Visual inspection of wirings and connections", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "3. Air Valves", task: "Regular monitoring of voltage and current at MCC panel", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "3. Air Valves", task: "Regular observation of surroundings for safety", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "4. Motorized Valves (MOV)", task: "Preventive Maintenance (High Voltage / HV PM)", frequency: "Annually", implementor: "Maintenance/Contractor" },
      { plant: "Modesta PS", equipmentType: "4. Motorized Valves (MOV)", task: "Visual inspection of HV/LV bushing, surge arrester, tank", frequency: "Monthly", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "4. Motorized Valves (MOV)", task: "Oil tightness check", frequency: "Monthly", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "4. Motorized Valves (MOV)", task: "Oil level check", frequency: "Monthly", implementor: "SLA" },
      { plant: "Modesta PS", equipmentType: "5. Air Conditioning Units", task: "Surface cleaning", frequency: "Quarterly", implementor: "SLA" },
      { plant: "Modesta PS", equipmentType: "5. Air Conditioning Units", task: "Connections tightness", frequency: "Semi-annual", implementor: "SLA" },
      { plant: "Modesta PS", equipmentType: "1. High Voltage (Transformer)", task: "Painting state inspection", frequency: "Annually", implementor: "SLA" },
      { plant: "Modesta PS", equipmentType: "1. High Voltage (Transformer)", task: "Earth resistance check", frequency: "As needed", implementor: "SLA" },
      { plant: "Modesta PS", equipmentType: "2. Low Voltage (Motor Control Center (MCC) | Switchgear | Panelboard | Low voltage distribution board)", task: "Inspect for leaks (Oil lines and Fuel Lines)", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "2. Low Voltage (Motor Control Center (MCC) | Switchgear | Panelboard | Low voltage distribution board)", task: "Check for leakage in mechanical seals and pump drive end", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "4. PAD MOUNTED TRANSFORMER", task: "Check for corrosion of contact parts", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "4. PAD MOUNTED TRANSFORMER", task: "Regular cleaning (wiping out dust and other particles)", frequency: "Weekly", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "5. Solar Inverter House and Panels", task: "Pumps and Motors Preventive Maintenance (Electromech PM)", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      { plant: "Modesta PS", equipmentType: "1. Flowmeters", task: "External visual inspection for corrosion and physical damage", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "1. Flowmeters", task: "Verify bolt tightening", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "2. Flow Transmitter", task: "Preventive Maintenance and Repairs", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      { plant: "Modesta PS", equipmentType: "2. Flow Transmitter", task: "Visual inspection of wirings and connections", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "3. Level Switch", task: "Regular monitoring of voltage and current at MCC panel", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "3. Level Switch", task: "Regular observation of surroundings for safety", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "4. Pressure Switch", task: "Preventive Maintenance (High Voltage / HV PM)", frequency: "Annually", implementor: "Maintenance/Contractor" },
      { plant: "Modesta PS", equipmentType: "4. Pressure Switch", task: "Visual inspection of HV/LV bushing, surge arrester, tank", frequency: "Monthly", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "5. Level Transmitter", task: "Oil tightness check", frequency: "Monthly", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "5. Level Transmitter", task: "Oil level check", frequency: "Monthly", implementor: "SLA" },
      { plant: "Modesta PS", equipmentType: "6. Pressure Transmitter", task: "Surface cleaning", frequency: "Quarterly", implementor: "SLA" },
      { plant: "Modesta PS", equipmentType: "6. Pressure Transmitter", task: "Connections tightness", frequency: "Semi-annual", implementor: "SLA" },
      { plant: "Modesta PS", equipmentType: "7. Pressure Gauge", task: "Painting state inspection", frequency: "Annually", implementor: "SLA" },
      { plant: "Modesta PS", equipmentType: "7. Pressure Gauge", task: "Earth resistance check", frequency: "As needed", implementor: "SLA" },
      { plant: "Modesta PS", equipmentType: "8. SCADA/PLC Panel", task: "Inspect for leaks (Oil lines and Fuel Lines)", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "8. SCADA/PLC Panel", task: "Check for leakage in mechanical seals and pump drive end", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "8. SCADA/PLC Panel", task: "Check for corrosion of contact parts", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "8. SCADA/PLC Panel", task: "Regular cleaning (wiping out dust and other particles)", frequency: "Weekly", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "1. Automation", task: "Pumps and Motors Preventive Maintenance (Electromech PM)", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
      { plant: "Modesta PS", equipmentType: "1. Automation", task: "External visual inspection for corrosion and physical damage", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "1. Automation", task: "Verify bolt tightening", frequency: "Daily", implementor: "Operator/Shifthead" },
      { plant: "Modesta PS", equipmentType: "1. Automation", task: "Preventive Maintenance and Repairs", frequency: "Quarterly", implementor: "Maintenance/Contractor" },
    ];

    // Batch insert in chunks of 50 for reliability
    const chunkSize = 50;
    let inserted = 0;
    let failed = 0;
    for (let i = 0; i < allTasks.length; i += chunkSize) {
      const chunk = allTasks.slice(i, i + chunkSize).map((t) => ({
        plant: t.plant,
        equipmentType: t.equipmentType,
        task: t.task,
        frequency: t.frequency,
        implementor: t.implementor,
        status: "Active" as const,
      }));
      try {
        await db.insert(existingFacilitiesMaintenance).values(chunk);
        inserted += chunk.length;
      } catch (e: any) {
        console.error(`[SEED] Batch ${i}-${i + chunkSize} failed:`, e.message);
        failed += chunk.length;
        // Try one-by-one for this batch to salvage what we can
        for (const t of chunk) {
          try {
            await db.insert(existingFacilitiesMaintenance).values(t);
            inserted++;
            failed--;
          } catch (e2: any) {
            console.error(`[SEED] Row failed:`, t.plant, t.task, e2.message);
          }
        }
      }
    }
    return { seeded: true, count: inserted, failed, total: allTasks.length };
  }),

  // ── Reset all data ──
  reset: publicQuery.mutation(async () => {
    await ensureTable();
    await db.delete(existingFacilitiesMaintenance);
    return { success: true };
  }),
});