# Lihok Technologies Domain Model

**Status:** Draft  
**Authority:** Lihok Architecture Governance

---

## 1. Purpose

Define the canonical domain entities and their relationships across Lihok products.

## 2. Domains

| Domain | Description | Primary Layer |
|--------|-------------|---------------|
| Corporate Documents | Controlled documents, versions, approvals, audit | Corporate Governance |
| Customers | Customer accounts, contacts, contracts | Business Platform |
| Products | Product families, features, entitlements | Product Platform |
| Maintenance | Equipment, facilities, tasks, inspections | Product Platform |
| AI Operations | Agents, missions, prompts, completions | AI Orchestration |
| Identity | Users, principals, roles, permissions | Infrastructure |

## 3. Cross-Domain Rules

- Corporate Governance domains do not depend on Product Platform domains.
- Customer data must not leak into Corporate Governance audit records.
- Identity is a shared infrastructure concern.

## 4. Entity Relationship Diagram

*TBD — add when the domain model stabilizes.*
