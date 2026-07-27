# Governance Presentation Architecture

**Version:** 2.0.0  
**Date:** 2026-07-27  
**Branch:** codex/governance-template-repair

---

## Overview

This document describes the refactored O&M Manual Governance presentation generator architecture. The architecture implements a clean separation between source data, presentation model, slide layouts, and PowerPoint generation.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        SOURCE DATA                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Facilities  │  │  Milestones  │  │  Document Uploads    │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GOVERNANCE ADAPTER                            │
│         (governance-presentation-adapter.ts)                     │
│                                                                  │
│  • Maps source data to presentation model                       │
│  • Calculates progress and compliance                           │
│  • Generates executive narrative                                │
│  • Centralizes status mapping                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 PRESENTATION MODEL                               │
│         (governance-presentation-model.ts)                       │
│                                                                  │
│  • Typed data structure for all 4 slides                        │
│  • Single source of truth for presentation content                │
│  • Immutable after construction                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SLIDE LAYOUTS                                 │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ Slide 1: Executive Summary                                  ││
│  │ (executive-summary-layout.ts)                              ││
│  └────────────────────────────────────────────────────────────┘│
│  ┌────────────────────────────────────────────────────────────┐│
│  │ Slide 2: Facility Dashboard                               ││
│  │ (facility-dashboard-layout.ts)                           ││
│  └────────────────────────────────────────────────────────────┘│
│  ┌────────────────────────────────────────────────────────────┐│
│  │ Slide 3: Progress Panel (S-Curve / Snapshot)             ││
│  │ (progress-panel-layout.ts)                               ││
│  └────────────────────────────────────────────────────────────┘│
│  ┌────────────────────────────────────────────────────────────┐│
│  │ Slide 4: Compliance Matrix (Cross-Tab)                    ││
│  │ (compliance-matrix-layout.ts)                            ││
│  └────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              GOVERNANCE PRESENTATION GENERATOR                   │
│         (governance-presentation-generator.ts)                     │
│                                                                  │
│  • Orchestrates the generation pipeline                         │
│  • Validates before generation                                  │
│  • Delegates to PowerPoint exporter                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    POWERPOINT EXPORT                             │
│         (governanceAutomizer.ts - existing)                      │
│                                                                  │
│  • Uses pptx-automizer with templates                           │
│  • Maintains existing template compatibility                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      VALIDATION                                  │
│         (governance-presentation-validation.ts)                  │
│                                                                  │
│  • 22 automated checks                                          │
│  • Slide-by-slide validation                                    │
│  • Forbidden content detection                                  │
│  • July 2026 fixture validation                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
server/
└── presentation/
    ├── core/
    │   ├── presentation-types.ts       # Core abstractions
    │   └── (theme, utils, validator TBD)
    │
    ├── layouts/
    │   ├── executive-summary-layout.ts    # Slide 1
    │   ├── facility-dashboard-layout.ts # Slide 2
    │   ├── progress-panel-layout.ts       # Slide 3
    │   └── compliance-matrix-layout.ts    # Slide 4
    │
    └── governance/
        ├── governance-presentation-adapter.ts     # Data transformation
        ├── governance-presentation-model.ts       # Typed model
        ├── governance-presentation-generator.ts   # Orchestration
        ├── governance-presentation-validation.ts    # Validation rules
        ├── governance-status-mapper.ts              # Status conversion
        └── governance-narrative-generator.ts        # Executive narrative
```

---

## Presentation Model

### Core Interface

```typescript
interface GovernancePresentationModel {
  presentationId: string;
  presentationType: "governance-onboarding";
  reportTitle: string;
  reportSubtitle: string;
  reportingPeriod: string;
  generatedAt: string;
  generatorVersion: string;
  hasRequirementMatrix: boolean;
  mode: "Mode A" | "Mode B";
  
  executiveSummary: GovernanceExecutiveSummary;
  facilities: GovernanceFacilityPresentationData[];
  complianceMatrix: GovernanceComplianceMatrix;
  disclosures: GovernancePresentationDisclosure[];
}
```

### Facility Data

```typescript
interface GovernanceFacilityPresentationData {
  facilityId: string;
  facilityName: string;
  facilityShortName: string;
  color: string;
  status: "on-track" | "attention" | "delayed" | "not-started" | "complete";
  
  plannedProgress: number | null;
  actualProgress: number | null;
  variance: number | null;
  hasBaselineSchedule: boolean;
  
  approvedDeliverables: number;
  submittedDeliverables: number;
  outstandingDeliverables: number;
  notApplicableDeliverables: number;
  totalApplicableDeliverables: number;
  compliancePercent: number | null;
  
  progressVisualizationType: "s-curve" | "snapshot";
  progressSeries: ProgressPoint[];
}
```

---

## Status Mapping

### Document Status Flow

| Source Status | Presentation Status | Notes |
|---------------|---------------------|-------|
| `isApproved = true` | **approved** | Fully approved |
| `isSubmitted = true` | **submitted-review** | Under review |
| `isRequired = true, not submitted` | **outstanding** | Required, missing |
| `isApplicable = false` | **not-applicable** | Not required |

### Facility Status Rules

| Condition | Status |
|-----------|--------|
| No baseline schedule | not-started |
| Actual progress >= 100% | complete |
| Variance within ±5% | on-track |
| Variance -15% to -5% | attention |
| Variance < -15% | delayed |

---

## Compliance Calculation

### Formula

```
Compliance % = Approved / (Approved + Submitted + Outstanding) × 100
```

**Important:** Not Applicable documents are **EXCLUDED** from the denominator.

### Mode A vs Mode B

| Mode | Requirement Matrix | Compliance Calculation |
|------|-------------------|------------------------|
| **Mode A** | Available | Authoritative, based on formal requirements |
| **Mode B** | Not available | Proxy metrics based on milestone submissions |

---

## Slide Layouts

### Slide 1: Executive Summary

**Purpose:** Portfolio-level overview with KPIs and narrative  
**Content:**
- Report title and subtitle
- Reporting period
- Overall KPIs (actual, planned, variance)
- Facility count
- Total deliverables
- Overall compliance %
- Status distribution
- Executive narrative (auto-generated)
- Mode disclosure

**Narrative Logic:**
1. Portfolio status summary
2. On-track facilities listed
3. Behind-plan facilities listed
4. Not-started facilities listed
5. Largest documentation gap
6. Mode B disclosure (if applicable)

### Slide 2: Facility Dashboard

**Purpose:** Four facility cards with progress and document status  
**Content per facility:**
- Facility name
- Color-coded status indicator
- Planned vs Actual progress
- Variance
- Document counts (approved, submitted, outstanding)
- Compliance percentage

### Slide 3: Progress Panel

**Purpose:** Facility progress visualization  
**Two modes:**

**S-Curve Mode:** (when historical data available)
- Time-series chart
- Planned line
- Actual line
- Forecast line (if available)

**Snapshot Mode:** (default)
- Current values only
- Disclosure: "Progress shown as snapshot values. Historical S-curve data requires additional milestone tracking."

### Slide 4: Compliance Matrix

**Purpose:** Cross-tabulation of deliverables × facilities  
**Structure:**
- Columns: Facilities (4)
- Rows: TOC deliverables
- Cells: Status indicators
- Totals row: Grand totals across all facilities
- Legend: Status definitions

**July 2026 Fixture Values:**
| Facility | Planned | Actual |
|----------|---------|--------|
| Aglipay STP | 44% | 44% |
| HTT STP | 44% | 44% |
| Eastbay PH-2 TP | 22% | 11% |
| Kaysakat TP | 33% | 0% |

---

## Validation Rules

### Automated Checks (22 total)

#### Structural
- PPTX file created and > 1 MB
- PPTX opens without errors (python-pptx)
- Exactly 4 slides

#### Slide 1
- Title "New Facilities Onboarding" present
- Reporting period exists
- Executive narrative generated

#### Slide 2
- All 4 facilities present
- No duplicates
- Required facilities: aglipay, htt, eastbay, kaysakat

#### Slide 3
- Title "Facility Progress" present
- All 4 facilities with progress values
- July 2026 fixture values validated
- No historical data fabricated

#### Slide 4
- Title "Deliverables Documents Summary" present
- Mode B disclosure (when applicable)
- Compliance calculation verified
- Not Applicable excluded from denominator

#### Forbidden Content
- No "PM:CM Ratio"
- No "MTTR"
- No "Notifications" (KPI context)
- No "Reliability KPI"
- No "KPI Scorecard"
- No "TARGET" labels

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All validations passed |
| 1 | One or more validations failed |

---

## Usage

### Generate Presentation

```typescript
import { generateGovernancePresentationNew } from "./server/presentation/governance/governance-presentation-generator";

const buffer = await generateGovernancePresentationNew(
  facilitiesData,
  {
    reportingDate: new Date("2026-07-25"),
    hasRequirementMatrix: false,
    validate: true,
  }
);
```

### Run Inspection

```bash
npm run governance:inspect
```

### Validate Only

```typescript
import { validateGovernancePresentation } from "./server/presentation/governance/governance-presentation-validation";

const result = validateGovernancePresentation(model);
// result.valid: boolean
// result.errors: string[]
// result.warnings: string[]
```

---

## Known Limitations

1. **S-Curve Data:** Current implementation shows snapshot values only. True historical S-curves require additional database fields for milestone progression tracking.

2. **Requirement Matrix:** Compliance calculations use proxy metrics until formal requirement matrix is implemented.

3. **PNG Rendering:** Depends on LibreOffice availability in the environment.

4. **Chart Library:** No embedded chart generation; relies on PowerPoint template charts or static values.

5. **Four Facility Limit:** Current layout optimized for exactly 4 facilities. Additional facilities would require layout adjustments.

---

## Future Extraction Path

This architecture is designed for eventual extraction into a shared ODM presentation framework:

### Core Components (Reusable)
- `presentation-types.ts` - Core abstractions
- `presentation-validator.ts` - Validation framework

### Governance-Specific (Domain Layer)
- `governance-presentation-model.ts`
- `governance-presentation-adapter.ts`
- `governance-status-mapper.ts`

### Layout Templates (Reusable with Configuration)
- Executive summary layout
- Facility dashboard layout
- Progress panel layout
- Compliance matrix layout

### Future Domains
- Monthly KPI Scorecard
- Maintenance Planning
- SMP (Safety Management Plan)
- Custom executive presentations

---

## Testing

### Test Coverage

| Component | Tests |
|-----------|-------|
| Status Mapper | Status conversion, compliance calc |
| Narrative Generator | Determinism, content rules |
| Adapter | Data transformation |
| Layouts | Validation rules |
| Generator | End-to-end generation |

### Run Tests

```bash
npm run check    # TypeScript compilation
npm test         # Unit tests
npm run governance:inspect  # Integration test
```

---

## Documentation

- `docs/governance-inspection.md` - Developer workflow
- `docs/governance-presentation-architecture.md` - This document
- `DRY-RUN-REPORT.md` - Implementation dry-run analysis

---

## Git Information

- **Branch:** codex/governance-template-repair
- **PR:** #308
- **Status:** Ready for manual PowerPoint review

---

*Generated by Codex - ODM Dashboard Governance Refactor v2.0*
