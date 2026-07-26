# Governance Presentation Validation Report

Generated: 2026-07-26T23:49:00Z
Reporting Date: 2026-07-25

## Slide Overview

| Slide | Title | Description |
|-------|-------|-------------|
| 1 | New Facilities Onboarding | Executive title slide with facility list |
| 2 | Governance Overview | Consolidated S-curve with planned vs actual line chart |
| 3 | Facility Progress Overview | Four facility progress charts (2×2 grid) |
| 4 | Deliverables Compliance Matrix | TOC × Facility matrix with per-TOC status |

## Slide 4: TOC × Facility Deliverables Compliance Matrix

The new Slide 4 displays a crosstab matrix showing:
- **Rows**: 14 TOC deliverables (from GOVERNANCE_TOC_DELIVERABLES)
- **Columns**: 4 facilities (AGLIPAY, HTT, EASTBAY, KAYSAKAT)
- **Cell Status**:
  - ✓ Submitted (pale green background)
  - Missing (pale red background)

### Footer Summary

| Facility | Submitted / Required | Compliance |
|----------|---------------------|------------|
| AGLIPAY STP | 3 / 14 | 21.4% |
| HTT STP | 11 / 14 | 78.6% |
| EASTBAY PH-2 TP | 4 / 14 | 28.6% |
| KAYSAKAT TP | 1 / 14 | 7.1% |

### Data Source
- Per-TOC status calculated by `calculateFacilityDeliverableStatuses()`
- Counts derived from `upload.tocItem` (authoritative source)
- Summary figures from `calculateDeliverableSubmissionSummary()`

## Production Alignment

| Facility | Required | Submitted | Approved | Missing | Compliance | Status |
|----------|----------|-----------|----------|---------|------------|--------|
| AGLIPAY STP | 14 | 3 | 3 | 11 | 21.4% | At Risk |
| HTT STP | 14 | 11 | 11 | 3 | 78.6% | In Progress |
| EASTBAY PH-2 TP | 14 | 4 | 4 | 10 | 28.6% | At Risk |
| KAYSAKAT TP | 14 | 1 | 1 | 13 | 7.1% | At Risk |

## Implementation Notes

- `FacilityDeliverableStatus` interface added for per-TOC tracking
- `deliverableStatuses` field added to `FacilityPresentationSummary`
- Slide 4 uses `GOVERNANCE_TOC_DELIVERABLES` for canonical TOC list
- Cell status determined by presence of uploads with matching `tocItem`
- Multiple files under same TOC count as single "Submitted" status

## Validation Results

- **npm run check**: PASSED
- **npm test**: 1,147 tests PASSED
- **npm run build**: PASSED
