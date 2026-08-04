# Lihok Corporate Library Roadmap

This roadmap tracks the Foundation Releases for the Lihok Corporate Library module.
The module is temporarily hosted inside the ODM Dashboard repository, as described in
[ADR-0001 — Temporary Hosting Strategy for the Lihok Corporate Library](./adr/ADR-0001.md).

## Corporate Library

| Release | Name | Status | Tag | PR |
|---|---|---|---|---|
| FR-001 | Database Foundation | ✅ Complete | — | #321 |
| FR-002 | Storage Foundation | ✅ Complete | — | #322 |
| FR-003 | Backend Services | ✅ Complete | `lihok-fr003-backend` | #323 |
| FR-004 | React UI | ⬜ Not Started | — | — |
| FR-005 | Security & RLS | ⬜ Not Started | — | — |
| FR-006 | Production Readiness | ⬜ Not Started | — | — |

## Design System

FR-004 also begins the definition of the **Lihok Design System** — a coherent visual
and interaction language for all future Lihok products, separate from ODM and
Manila Water styling.

## Notes

- Each Foundation Release follows the lifecycle: Architecture → Implementation →
  Independent Acceptance Review → Focused Corrections → Regression Validation →
  Human Review → Merge → Tag → Roadmap Update → Next Release.
- No release is merged until it is clean, maintainable, and regression-safe.
