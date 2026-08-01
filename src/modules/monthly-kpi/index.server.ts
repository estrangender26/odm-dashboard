/**
 * Monthly KPI Scorecard Presentation Module (Server-Only)
 * @server-only
 */

export { fetchMonthlyKpiPresentationData } from "./adapter.server";
export { generateMonthlyKpiPresentation } from "@/modules/executive-presentations/generators/monthlyKpiGenerator";
