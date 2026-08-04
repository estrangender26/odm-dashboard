# Lihok Technologies System Context

**Status:** Draft  
**Authority:** Lihok Architecture Governance

---

## 1. Purpose

Describe the external systems and integrations that interact with Lihok's technology estate.

## 2. External Systems

| System | Type | Owner | Integration Notes |
|--------|------|-------|-----------------|
| GitHub | Source control / CI/CD | Engineering | All repositories and workflows |
| Microsoft 365 / Entra ID | Identity / Collaboration | Corporate IT | Future identity provider |
| Supabase | Managed PostgreSQL / Storage | Engineering | Current database and object storage |
| Kimi / OpenAI | AI model providers | Engineering | AI Orchestration layer |
| Render / Netlify | Hosting | Engineering | Application deployment |

## 3. Context Diagram

*TBD — add a C4 context diagram when the architecture stabilizes.*

## 4. Integration Principles

- Prefer APIs over direct database sharing.
- Store corporate secrets in infrastructure-managed vaults, never in application repositories.
- Use service accounts with least privilege.
