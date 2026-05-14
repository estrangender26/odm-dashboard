import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { existingFacilitiesMaintenance } from "@db/schema";
import { eq, and, like, sql, count } from "drizzle-orm";

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
      const [result] = await db.insert(existingFacilitiesMaintenance).values({
        plant: input.plant,
        equipmentType: input.equipmentType || "",
        task: input.task,
        frequency: input.frequency,
        implementor: input.implementor || null,
        status: input.status || "Active",
        lastCompleted: input.lastCompleted || null,
        nextDue: input.nextDue || null,
        remarks: input.remarks || null,
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
      await db.delete(existingFacilitiesMaintenance)
        .where(eq(existingFacilitiesMaintenance.id, input.id));
      return { success: true };
    }),

  // ── Bulk import ──
  importExcel: publicQuery
    .input(z.object({
      rows: z.array(z.object({
        plant: z.string().min(1),
        equipmentType: z.string().optional(),
        task: z.string().min(1),
        frequency: z.string().min(1),
        implementor: z.string().optional(),
        status: z.string().optional(),
        lastCompleted: z.string().optional(),
        nextDue: z.string().optional(),
        remarks: z.string().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const inserted = [];
      for (const row of input.rows) {
        const [result] = await db.insert(existingFacilitiesMaintenance).values({
          plant: row.plant,
          equipmentType: row.equipmentType || "",
          task: row.task,
          frequency: row.frequency,
          implementor: row.implementor || null,
          status: row.status || "Active",
          lastCompleted: row.lastCompleted || null,
          nextDue: row.nextDue || null,
          remarks: row.remarks || null,
        }).returning();
        inserted.push(result);
      }
      return { success: true, count: inserted.length };
    }),

  // ── Seed from complete Excel data ──
  seed: publicQuery.mutation(async () => {
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

    let inserted = 0;
    for (const t of allTasks) {
      await db.insert(existingFacilitiesMaintenance).values({
        plant: t.plant,
        equipmentType: t.equipmentType,
        task: t.task,
        frequency: t.frequency,
        implementor: t.implementor,
        status: "Active",
      });
      inserted++;
    }
    return { seeded: true, count: inserted };
  }),

  // ── Reset all data ──
  reset: publicQuery.mutation(async () => {
    await db.delete(existingFacilitiesMaintenance);
    return { success: true };
  }),
});
