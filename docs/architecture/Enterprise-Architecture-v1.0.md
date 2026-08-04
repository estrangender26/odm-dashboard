# Lihok Technologies Enterprise Architecture v1.0

**Version:** 1.0  
**Status:** Approved  
**Authority:** Office of the President / Lihok Architecture Governance  
**Date:** 2026-08-04

---

## 1. Purpose

This document defines the highest-level architecture for Lihok Technologies OPC. It establishes the target state for technology decisions, the hierarchy of governing documents, and the architectural layers that every module must map to.

All architecture work at Lihok derives from this document.

---

## 2. Governing Document Hierarchy

```
Enterprise Architecture v1.0
        │
        ├── Architecture Decision Records (ADRs)
        │
        ├── Corporate Standards Manual
        │
        ├── Technology Standards
        │
        ├── Security Standards
        │
        ├── Development Standards
        │
        └── Product Architectures
```

### 2.1 Chain of authority

- **Enterprise Architecture** defines the target state.
- **Architecture Decision Records (ADRs)** explain why major architectural decisions were made.
- **Standards** define how work is performed.
- **Projects** implement those standards.

---

## 3. Architectural Layers

Every Lihok module must clearly identify which layer it belongs to. The layers are ordered from business governance down to infrastructure.

| Layer | Name | Responsibility |
|-------|------|--------------|
| 1 | **Corporate Governance** | Company-wide policies, controlled documents, legal, compliance, HR, finance |
| 2 | **Business Platform** | Cross-product operations: CRM, contracts, vendor management, billing |
| 3 | **Product Platform** | Individual product families and customer-facing capabilities |
| 4 | **AI Orchestration** | AI agents, copilots, model orchestration, prompt management |
| 5 | **Infrastructure** | Compute, storage, identity, networking, observability, SaaS foundations |

### 3.1 Dependency rule

A higher layer may depend on lower layers, but a lower layer must not depend on a higher layer.

For example, a Product Platform module may call Infrastructure services, but Infrastructure must not call Product Platform business logic.

### 3.2 Module-to-layer mapping (current)

| Module | Layer | Rationale |
|--------|-------|-----------|
| **Corporate Library** | Corporate Governance | Controlled corporate documents, policies, and legal/compliance records |
| **CRM** | Business Platform | Customer and commercial relationship management |
| **ATIMAN** | Product Platform | Customer-facing product offering |
| **ODM Dashboard** | Product Platform | Operator-driven maintenance product for Manila Water |
| **Jarvis Mission Control** | AI Orchestration | AI agent orchestration and mission control |
| **PostgreSQL** | Infrastructure | Persistent data store |
| **Microsoft 365 / Entra ID** | Infrastructure | Identity, productivity, and corporate collaboration |
| **GitHub** | Infrastructure | Source control, CI/CD, and artifact management |

---

## 4. Key Architectural Principles

1. **Lihok-controlled data must remain separate from customer data.**
2. **The Lihok corporate environment is treated as an internal tenant.**
3. **Modules must be portable across hosts and databases.**
4. **Corporate, product, and customer data must have explicit boundaries.**
5. **Approved controlled documents are immutable.**
6. **Audit records are append-oriented and non-destructive.**
7. **Confidential and Restricted classifications control access.**
8. **The uploader of a controlled document may not approve it.**
9. **No ODM-, Manila Water-, facility-, equipment-, milestone-, TOC-, or SMP-specific dependencies are allowed in Corporate Governance modules.**
10. **User identity must be replaceable without redesigning the module schema.**
11. **The schema must support future API and service extraction without destructive migrations.**
12. **Important technical decisions are captured through ADRs.**

---

## 5. Relationship to Other Documents

- [System Context](./System-Context.md) — external systems and integrations
- [Domain Model](./Domain-Model.md) — canonical domain entities and relationships
- [Technology Standards](./Technology-Standards.md) — approved technology choices
- [ADR-0001 — Temporary Hosting Strategy for the Lihok Corporate Library](../adr/ADR-0001.md)

---

## 6. Review Cycle

This document is reviewed at least annually or whenever a proposed ADR contradicts a principle recorded here.
