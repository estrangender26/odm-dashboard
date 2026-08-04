# Lihok Branching Strategy

**Status:** Draft  
**Authority:** Lihok Architecture Governance

---

## 1. Default Prefix

All automated or agent-created branches use the prefix `codex/` unless the task explicitly requests otherwise.

## 2. Branch Naming Examples

- `codex/lihok-corporate-library-schema`
- `codex/monthly-kpi-visual-fidelity`
- `codex/security-rls-phase-2`

## 3. Branch Lifetime

- Feature branches should be short-lived and deleted after merge.
- Hotfix branches may be created from a release tag when needed.

## 4. Rebase Policy

- Rebase is allowed on personal feature branches before merge.
- Do not rebase branches that have been pushed for collaborative review unless all collaborators agree.
