# Lihok Technologies Technology Standards

**Status:** Draft  
**Authority:** Lihok Architecture Governance

---

## 1. Purpose

Define approved technology choices and evaluation criteria for Lihok engineering.

## 2. Current Approved Stack

| Layer | Approved Technology | Rationale |
|-------|---------------------|-----------|
| Frontend | React + TypeScript + Vite | Type safety, performance, team familiarity |
| Backend runtime | Node.js + Hono | Lightweight, TypeScript-native |
| Database | PostgreSQL (managed via Supabase) | Reliability, RLS support, portability |
| ORM | Drizzle ORM | Type-safe, migration-friendly |
| Object storage | Supabase Storage | TUS resumable uploads, signed URLs |
| RPC | tRPC | End-to-end type safety |
| UI components | Radix + Tailwind CSS | Accessible, customizable |
| AI orchestration | OpenAI / Kimi APIs | Proven model providers |

## 3. Selection Criteria

1. Must support extraction to a separate project or tenant.
2. Must have first-class TypeScript support.
3. Must be operable by a small engineering team.
4. Must allow additive migration paths.

## 4. Provisional Technologies

Technologies not listed here require an ADR before adoption.
