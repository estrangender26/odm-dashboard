import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { governanceFacilities } from "@db/schema";

/*
 * Governance facility reference data.
 *
 * Migration 0015_seed_governance_facilities.sql already inserts the four
 * canonical facilities idempotently; this endpoint remains as the explicit
 * re-seed path for those rows.
 *
 * The Maintenance Planning (Post-PPP) task/equipment seed payload that this
 * router previously carried was decommissioned together with that module
 * (migration 0039_decommission_maintenance_planning.sql), so no task or
 * equipment table is written here anymore.
 */
export const seedRouter = createRouter({
  run: publicQuery.mutation(async () => {
    try {
      const inserted = await db
        .insert(governanceFacilities)
        .values([
          { slug: "aglipay", name: "AGLIPAY Sewage Treatment Plant", shortName: "AGLIPAY STP" },
          { slug: "htt", name: "HTT Sewage Treatment Plant", shortName: "HTT STP" },
          { slug: "eastbay", name: "EASTBAY Phase 2 Treatment Plant", shortName: "EASTBAY PH-2 TP" },
          { slug: "kaysakat", name: "KAYSAKAT Treatment Plant", shortName: "KAYSAKAT TP" },
        ])
        .onConflictDoNothing()
        .returning({ slug: governanceFacilities.slug });

      return {
        success: true,
        governanceFacilities: inserted.length,
        message:
          inserted.length > 0
            ? `Seeded ${inserted.length} governance facilit${inserted.length === 1 ? "y" : "ies"}`
            : "Governance facilities already present",
      };
    } catch (error) {
      console.error("Seed error:", error);
      return { success: false, message: String(error) };
    }
  }),
});
