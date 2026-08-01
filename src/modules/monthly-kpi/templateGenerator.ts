/**
 * Monthly KPI Scorecard Template-Based Presentation Generator
 *
 * This module is a thin compatibility wrapper around the shared Executive
 * Presentation Framework generator. The shared framework owns all PPTX
 * XML manipulation so it is not duplicated between presentation modules.
 *
 * @deprecated prefer importing from @/modules/executive-presentations/generators/monthlyKpiGenerator
 */

import { generateMonthlyKpiPresentation as frameworkGenerateMonthlyKpiPresentation } from "@/modules/executive-presentations/generators/monthlyKpiGenerator";
import type { MonthlyKpiPresentation } from "./types";

export { generateMonthlyKpiPresentation };

async function generateMonthlyKpiPresentation(
  data: MonthlyKpiPresentation
): Promise<Blob> {
  return frameworkGenerateMonthlyKpiPresentation(data);
}
