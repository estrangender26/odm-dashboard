import { db } from "../api/queries/connection";
import { governanceFacilities } from "./schema";

/*
 * Governance facility reference data seed.
 *
 * The Maintenance Planning (Post-PPP) equipment/task seed payload that this
 * script previously carried was decommissioned together with that module
 * (migration 0039_decommission_maintenance_planning.sql).
 */
async function seed() {
  await db.insert(governanceFacilities).values([
    { slug: "aglipay", name: "AGLIPAY Sewage Treatment Plant", shortName: "AGLIPAY STP" },
    { slug: "htt", name: "HTT Sewage Treatment Plant", shortName: "HTT STP" },
    { slug: "eastbay", name: "EASTBAY Phase 2 Treatment Plant", shortName: "EASTBAY PH-2 TP" },
    { slug: "kaysakat", name: "KAYSAKAT Treatment Plant", shortName: "KAYSAKAT TP" },
  ]).onConflictDoNothing();
  console.log("Governance facilities seeded");
}

seed().catch(console.error);
