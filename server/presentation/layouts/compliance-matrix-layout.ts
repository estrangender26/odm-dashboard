/**
 * Compliance Matrix Layout
 * 
 * Slide 4: Deliverables × Facility cross-tab with status indicators.
 */

import type { GovernancePresentationModel } from "../governance/governance-presentation-model";

/**
 * Renders Slide 4: Compliance Matrix.
 * 
 * @param model - The complete presentation model
 * @returns Slide content structure
 */
export function renderComplianceMatrixSlide(
  model: GovernancePresentationModel
): {
  slideNumber: number;
  title: string;
  subtitle: string;
  content: {
    mode: "Mode A" | "Mode B";
    modeDisclosure: string;
    columns: {
      facilityId: string;
      facilityName: string;
      color: string;
      totals: {
        applicable: number;
        approved: number;
        submitted: number;
        outstanding: number;
        compliancePercent: number | null;
      };
    }[];
    grandTotal: {
      applicable: number;
      approved: number;
      submitted: number;
      outstanding: number;
      compliancePercent: number | null;
    };
    legend: {
      approved: string;
      submitted: string;
      outstanding: string;
      notApplicable: string;
    };
  };
} {
  const { complianceMatrix, mode } = model;
  
  return {
    slideNumber: 4,
    title: "Deliverables Compliance Matrix",
    subtitle: mode === "Mode B" 
      ? "Compliance: N/A — Mode B (Requirement matrix not yet available)"
      : "Deliverables by Facility",
    content: {
      mode,
      modeDisclosure: mode === "Mode B"
        ? "Mode B: No requirement matrix. Displaying submitted document counts only."
        : "",
      columns: complianceMatrix.columns.map((col, index) => ({
        facilityId: col.facilityId,
        facilityName: col.facilityName,
        color: col.color,
        totals: complianceMatrix.columnTotals[index] ?? {
          applicable: 0,
          approved: 0,
          submitted: 0,
          outstanding: 0,
          compliancePercent: null,
        },
      })),
      grandTotal: complianceMatrix.grandTotal,
      legend: {
        approved: "Approved",
        submitted: "Submitted / Under Review",
        outstanding: "Outstanding",
        notApplicable: "Not Applicable",
      },
    },
  };
}

/**
 * Validates compliance matrix slide requirements.
 * 
 * @param model - The presentation model
 * @returns Validation result
 */
export function validateComplianceMatrixSlide(
  model: GovernancePresentationModel
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Must have all 4 facilities as columns
  if (model.complianceMatrix.columns.length !== 4) {
    errors.push(
      `Expected 4 facility columns, got ${model.complianceMatrix.columns.length}`
    );
  }
  
  // Check all required facilities
  const requiredFacilities = ["aglipay", "htt", "eastbay", "kaysakat"];
  const columnIds = model.complianceMatrix.columns.map(c => c.facilityId);
  
  for (const required of requiredFacilities) {
    if (!columnIds.includes(required)) {
      errors.push(`Missing required facility column: ${required}`);
    }
  }
  
  // Validate Mode B disclosure when in Mode B
  if (model.mode === "Mode B") {
    const hasModeBDisclosure = model.disclosures.some(
      d => d.type === "mode" && d.text.includes("Mode B")
    );
    
    if (!hasModeBDisclosure) {
      errors.push("Mode B: Missing Mode B disclosure");
    }
  }
  
  // Validate totals
  const { grandTotal } = model.complianceMatrix;
  
  if (grandTotal.applicable < 0) {
    errors.push("Grand total: Negative applicable count");
  }
  
  if (grandTotal.approved < 0) {
    errors.push("Grand total: Negative approved count");
  }
  
  if (grandTotal.outstanding < 0) {
    errors.push("Grand total: Negative outstanding count");
  }
  
  // Validate compliance percentage calculation
  if (grandTotal.compliancePercent !== null) {
    if (grandTotal.compliancePercent < 0 || grandTotal.compliancePercent > 100) {
      errors.push(`Grand total: Invalid compliance ${grandTotal.compliancePercent}%`);
    }
    
    // Verify calculation: Approved / (Approved + Submitted + Outstanding)
    const denominator = grandTotal.approved + grandTotal.submitted + grandTotal.outstanding;
    
    if (denominator > 0) {
      const expectedPercent = Math.round((grandTotal.approved / denominator) * 100);
      
      if (Math.abs(grandTotal.compliancePercent - expectedPercent) > 1) {
        errors.push(
          `Grand total: Compliance calc mismatch. ` +
          `Reported ${grandTotal.compliancePercent}%, expected ${expectedPercent}%`
        );
      }
    }
  }
  
  // Check for forbidden KPI content
  const forbiddenTerms = [
    "PM:CM Ratio",
    "MTTR",
    "Notifications",
    "Reliability KPI",
    "KPI Scorecard",
    "TARGET",
  ];
  
  const slideContent = JSON.stringify(model.complianceMatrix).toUpperCase();
  
  for (const term of forbiddenTerms) {
    if (slideContent.includes(term.toUpperCase())) {
      errors.push(`Forbidden content detected: ${term}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Calculates compliance matrix totals from facility data.
 * 
 * @param model - The presentation model
 * @returns Recalculated totals for verification
 */
export function calculateMatrixTotals(
  model: GovernancePresentationModel
): {
  columnTotals: {
    facilityId: string;
    applicable: number;
    approved: number;
    submitted: number;
    outstanding: number;
    compliancePercent: number | null;
  }[];
  grandTotal: {
    applicable: number;
    approved: number;
    submitted: number;
    outstanding: number;
    compliancePercent: number | null;
  };
} {
  const columnTotals = model.facilities.map(f => ({
    facilityId: f.facilityId,
    applicable: f.totalApplicableDeliverables,
    approved: f.approvedDeliverables,
    submitted: f.submittedDeliverables,
    outstanding: f.outstandingDeliverables,
    compliancePercent: f.compliancePercent,
  }));
  
  const grandTotal = {
    applicable: columnTotals.reduce((sum, t) => sum + t.applicable, 0),
    approved: columnTotals.reduce((sum, t) => sum + t.approved, 0),
    submitted: columnTotals.reduce((sum, t) => sum + t.submitted, 0),
    outstanding: columnTotals.reduce((sum, t) => sum + t.outstanding, 0),
    compliancePercent: null as number | null,
  };
  
  // Calculate grand compliance
  const denominator = grandTotal.approved + grandTotal.submitted + grandTotal.outstanding;
  if (denominator > 0) {
    grandTotal.compliancePercent = Math.round((grandTotal.approved / denominator) * 100);
  }
  
  return {
    columnTotals,
    grandTotal,
  };
}
