# Governance Presentation Validation Report

Generated: 2026-07-26T23:55:00Z
Reporting Date: 2026-07-25
Source: Production pipeline via createPresentation()

## Validation Results

- **npm run check**: PASSED
- **npm test**: 1,147 tests PASSED (89 test files)
- **npm run build**: PASSED

## Slide Overview

| Slide | Title | Description |
|-------|-------|-------------|
| 1 | New Facilities Onboarding | Executive title slide with facility list |
| 2 | Governance Overview | Consolidated S-curve with planned vs actual line chart |
| 3 | Facility Progress Overview | Four facility progress charts (2×2 grid) |
| 4 | Deliverables Compliance Matrix | TOC × Facility crosstab with per-TOC status |

## Slide 4: TOC × Facility Deliverables Compliance Matrix

The new Slide 4 displays a crosstab matrix showing:
- **Rows**: 14 TOC deliverables from GOVERNANCE_TOC_DELIVERABLES
- **Columns**: 4 facilities (AGLIPAY, HTT, EASTBAY, KAYSAKAT)
- **Cell Status**:
  - ✓ Submitted (pale green background)
  - Missing (pale red background)

### Layout (Fixed)
- Matrix starts at y=1.10, height=4.65
- Summary table at y=5.85, height=0.78
- Disclosure at y=6.68
- No overlap between matrix, summary, disclosure, or footer

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

- `FacilityDeliverableStatus` interface for per-TOC tracking
- `deliverableStatuses` field in `FacilityPresentationSummary`
- Canonical TOC list from `GOVERNANCE_TOC_DELIVERABLES`
- Cell status determined by `upload.tocItem` presence
- Multiple files under same TOC count as single "Submitted"
