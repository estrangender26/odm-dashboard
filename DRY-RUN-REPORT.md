# Governance Presentation Generator Refactor - Dry-Run Report

**Generated:** 2026-07-27
**Branch:** codex/governance-template-repair
**Target:** PR #308 (Do Not Merge)

---

## Executive Summary

This refactor will restructure the O&M Manual Governance presentation generator into a clean, reusable architecture with explicit separation between source data, presentation model, slide layouts, and PowerPoint generation.

---

## Files to Add

### New Directory Structure

```
server/
  presentation/
    core/
      presentation-types.ts          # Core presentation abstractions
      presentation-theme.ts          # Theme configuration
      presentation-utils.ts          # Shared utilities
      presentation-validator.ts      # Validation logic

    layouts/
      executive-summary-layout.ts      # Slide 1: Executive Summary
      facility-dashboard-layout.ts     # Slide 2: Facility Cards
      progress-panel-layout.ts         # Slide 3: S-Curve/Snapshot
      compliance-matrix-layout.ts    # Slide 4: Cross-Tab Matrix

    governance/
      governance-presentation-adapter.ts    # Source data → Model
      governance-presentation-model.ts      # Typed presentation model
      governance-presentation-generator.ts # Generator orchestration
      governance-presentation-validation.ts # Validation rules
      governance-status-mapper.ts         # Status conversion logic
      governance-narrative-generator.ts   # Executive narrative
```

### Documentation Files to Add

```
docs/
  governance-presentation-architecture.md  # Architecture documentation
```

### Test Files to Add

```
server/presentation/governance/
  governance-presentation-adapter.test.ts
  governance-presentation-model.test.ts
  governance-status-mapper.test.ts
  governance-narrative-generator.test.ts
```

---

## Files to Modify

### Core Generator Files

| File | Changes |
|------|---------|
| `src/modules/presentation-center/governanceGenerator.ts` | Refactor to use new adapter pattern; deprecate old direct generation |
| `src/modules/presentation-center/governanceAutomizer.ts` | Update to consume new presentation model |
| `src/modules/presentation-center/governanceTypes.ts` | Add new presentation model interfaces |

### Scripts

| File | Changes |
|------|---------|
| `scripts/governance-inspect.ts` | Update to use new validation paths; add new artifact exports |
| `scripts/validate-pptx.py` | Add snapshot vs S-curve detection |

### Documentation

| File | Changes |
|------|---------|
| `docs/governance-inspection.md` | Update with new architecture and PASS/FAIL criteria |

---

## Files Proposed for Deletion (After Replacement Validated)

These files will be retained during the transition period and marked deprecated:

| File | Status | Notes |
|------|--------|-------|
| `src/modules/presentation-center/governanceTemplateGenerator.ts` | Deprecate | Legacy template approach |
| `src/modules/presentation-center/governanceSlideMaster.ts` | Deprecate | Replaced by theme config |

---

## Existing Functions to Replace

| Current Function | Replacement | Location |
|------------------|-------------|----------|
| `createDeterministicTestFixture()` | `createGovernanceTestFixture()` | governance-presentation-adapter.ts |
| `buildGovernanceReport()` | `buildGovernancePresentationModel()` | governance-presentation-adapter.ts |
| `generateGovernancePresentation()` | `generateGovernancePresentationNew()` | governance-presentation-generator.ts |
| `modifySlide4Content()` | `ComplianceMatrixLayout.render()` | compliance-matrix-layout.ts |
| `createSlide3Content()` | `ProgressPanelLayout.render()` | progress-panel-layout.ts |

---

## Existing Functions to Retain

| Function | Reason |
|----------|--------|
| `fetchGovernanceDataForPresentation()` | Database access layer unchanged |
| `calculateFacilityCurrentProgress()` | Calculation logic remains valid |
| `getFacilityColor()` | Utility function still applicable |
| `GOVERNANCE_MILESTONES` | Configuration constant |
| `GOVERNANCE_TOC_DELIVERABLES` | Configuration constant |

---

## Test Impact

### Tests to Add (New Coverage)

- Governance source-to-model conversion
- Status mapping (4 presentation statuses)
- Compliance percentage calculation (Not Applicable exclusion)
- Facility variance calculation
- S-curve vs snapshot selection logic
- Matrix row/column construction
- Missing facility handling
- Empty deliverables handling
- More-than-four-facility handling
- Forbidden text validation
- Narrative generation determinism

### Tests to Update

- `governanceGenerator.test.ts` - Update to use new model
- `governanceAutomizer.test.ts` - Update expectations
- `governanceValidation.test.ts` - Add new validation rules

### Expected Test Count Change

Current: 1,166 tests
Expected after refactor: 1,200+ tests (34+ new tests)

---

## API Impact

### No Breaking API Changes

The existing API endpoints remain unchanged:

- `GET /api/governance/executive-data` - Returns source data
- `POST /api/governance/generate-presentation` - Returns PPTX buffer

### Internal API Changes

New internal functions (not exposed via HTTP):

- `adaptGovernanceDataToPresentationModel()`
- `generateExecutiveNarrative()`
- `calculateCompliancePercentage()`
- `mapDocumentStatusToPresentationStatus()`

---

## Database Impact

### No Database Migrations Required

The refactor only reorganizes how existing data is:
1. Queried (unchanged)
2. Transformed (new adapter layer)
3. Presented (new layout layer)

### Data Flow

```
Database (unchanged)
  ↓
Existing Queries (unchanged)
  ↓
NEW: Governance Presentation Adapter
  ↓
NEW: Governance Presentation Model
  ↓
NEW: Slide Layouts
  ↓
Existing: PowerPoint Builder (modified)
  ↓
PPTX Output
```

---

## Production Impact

### Risk Level: LOW

| Aspect | Impact | Mitigation |
|--------|--------|------------|
| Existing presentations | None | Feature-flagged rollout |
| Database | None | Read-only operations |
| API contracts | None | Internal refactor only |
| Performance | Minimal | Added transformation layer |
| File system | Low | New artifacts in validation-artifacts/ |

### Rollback Plan

If issues are detected:
1. Revert to `governanceGenerator.ts` legacy functions
2. Toggle feature flag to use old implementation
3. No database rollback needed (no writes)

---

## Staged Replacement Plan

### Stage 1: Add New Files (Non-Breaking)

- Add `server/presentation/` directory structure
- Add new adapter, model, and layout files
- Add tests for new components

### Stage 2: Parallel Implementation

- Keep old implementation working
- Add new implementation alongside
- Add feature flag to select implementation

### Stage 3: Validation

- Run both implementations side-by-side
- Compare outputs
- Validate new implementation passes all checks

### Stage 4: Switchover

- Toggle feature flag to new implementation
- Monitor for issues
- Keep old implementation as fallback

### Stage 5: Cleanup (After 2+ weeks stable)

- Remove old implementation
- Remove feature flag
- Update documentation

---

## Compliance with Requirements

### Part 1: Architecture ✅
Clean separation between data → model → layouts → generation → validation

### Part 2: Presentation Model ✅
Typed interfaces for all presentation data with explicit null handling

### Part 3: Status Rules ✅
Centralized status mapping with documented conversion rules

### Part 4-7: Four Slides ✅
Each slide has dedicated layout with clear responsibilities

### Part 8: Compliance Calculation ✅
Not Applicable excluded from denominator with documented formula

### Part 9: Cross-Tab ✅
Deliverables × Facility matrix with proper status aggregation

### Part 10: PowerPoint Export ✅
Uses existing pptx-automizer with new model-based approach

### Part 11: Inspection Command ✅
Maintains `npm run governance:inspect` with all required artifacts

### Part 12: Automated Validation ✅
Non-zero exit codes for failures, comprehensive checks

### Part 13: Tests ✅
Coverage for all new components and edge cases

### Part 14: Documentation ✅
Architecture and workflow documentation

---

## Known Limitations (To Be Documented)

1. **S-Curve Data**: Current implementation shows snapshot values only. True historical S-curves require additional database fields.

2. **Requirement Matrix**: Compliance calculations use proxy metrics until formal requirement matrix is implemented.

3. **PNG Rendering**: Depends on LibreOffice availability in environment.

4. **Chart Library**: No embedded chart generation library; relies on PowerPoint template charts or static values.

---

## Estimated Effort

| Phase | Estimated Time |
|-------|---------------|
| Dry-run review | 30 min |
| Core architecture implementation | 4-6 hours |
| Four slide layouts | 3-4 hours |
| Status mapping & compliance calc | 2-3 hours |
| Inspection command updates | 1-2 hours |
| Tests | 2-3 hours |
| Documentation | 1-2 hours |
| Validation & bug fixes | 2-3 hours |
| **Total** | **16-24 hours** |

---

## Recommendation

**PROCEED with staged implementation.**

The refactor improves maintainability, adds explicit typing, and creates a foundation for reusable presentation components. The staged approach minimizes risk.

---

*Report generated by Codex - ODM Dashboard Governance Refactor*
