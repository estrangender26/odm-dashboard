# PR #307 Visual Validation Report

## Production Alignment - Deliverables Summary

| Facility | Required | Submitted | Approved | Missing | Compliance | Status |
|---|---:|---:|---:|---:|---:|---|
| AGLIPAY STP | 14 | 3 | 3 | 11 | 21.4% | At Risk |
| HTT STP | 14 | 11 | 11 | 3 | 78.6% | In Progress |
| EASTBAY PH-2 TP | 14 | 4 | 4 | 10 | 28.6% | At Risk |
| KAYSAKAT TP | 14 | 1 | 1 | 13 | 7.1% | At Risk |

## Shared Deliverables Calculation

The presentation uses production-aligned deliverable counts that match the Governance Deliverables tab.

Counting rules:
- Count TOC deliverable rows with at least one upload
- Do not count raw files
- Multiple files under one TOC row count as one submitted deliverable
- General-source uploads count
- Milestone-linked uploads count

Status thresholds:
- Complete: 100%
- In Progress: ≥70% and <100%
- At Risk: <70%

## Alias Mapping

| Database Slug | Production Label |
|--------------|------------------|
| aglipay | AGLIPAY STP |
| htt | HTT STP |
| eastbay | EASTBAY PH-2 TP |
| kaysakat | KAYSAKAT TP |

## Validation

- npm run check: ✅ Passed
- npm test: ✅ 1,139 tests passed
- npm run build: ✅ Passed
