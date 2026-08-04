# Lihok Controlled Documents Standard

**Status:** Draft  
**Authority:** Lihok Architecture Governance

---

## 1. Purpose

Define how controlled corporate documents are managed, classified, versioned, approved, and audited.

## 2. Document Classifications

| Classification | Description | Access Rule |
|----------------|-------------|-------------|
| **public** | Safe for public disclosure | No restriction |
| **internal** | Lihok internal use only | Authenticated Lihok users |
| **confidential** | Sensitive business information | Need-to-know basis |
| **restricted** | Highly sensitive; limited circulation | Explicit authorization required |

## 3. Version Statuses

| Status | Meaning |
|--------|---------|
| **draft** | Work in progress |
| **for_review** | Awaiting review / approval |
| **approved** | Authoritative and effective |
| **superseded** | Replaced by a newer approved version |
| **archived** | Retained for historical reference only |

## 4. Approval Rules

- A document uploader may not approve their own document.
- Approval is initially restricted to administrators.
- Approved versions are immutable: new content requires a new version.

## 5. Retention

- Version history and audit records are retained indefinitely.
- Destructive deletion of a document master is prohibited while versions or audit records exist.

## 6. Implementation

The Corporate Library implements this standard through the following database tables:

- `lihok_corporate_documents` — master record
- `lihok_corporate_document_versions` — immutable version rows
- `lihok_corporate_document_audit` — append-only audit trail
- `lihok_corporate_document_categories` — controlled category list
