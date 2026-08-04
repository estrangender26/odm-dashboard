# Lihok Coding Standards

**Status:** Draft  
**Authority:** Lihok Architecture Governance

---

## 1. Language and Runtime

- TypeScript is the default language for frontend and backend code.
- Node.js LTS is the default server runtime.

## 2. Type Safety

- Enable strict TypeScript checks.
- Prefer `tsc -b` or `npm run check` before opening a PR.
- Avoid `any` except in narrow integration boundaries.

## 3. Code Organization

- Group by module or feature rather than by technical layer.
- Keep module boundaries explicit; do not import from unrelated modules.
- Reuse shared utilities only when they are genuinely domain-agnostic.

## 4. Testing

- New logic must include focused unit or integration tests.
- Tests must run with `npm run test` or `npx vitest run <path>`.
- Do not write tests that only grep source files unless the goal is to enforce a static convention.

## 5. Formatting

- Use Prettier and the project's ESLint configuration.
- Run `npm run format` before finalizing a PR.

## 6. Documentation

- Important technical decisions require an ADR.
- Module READMEs should explain the module's layer, boundaries, and extraction status.
