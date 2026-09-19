# @lihok/project-controls

The **authoritative** Lihok project-controls domain: CPM scheduling, calendars,
dependency/lag semantics, progress and Data Date rules, statusing, baseline
variance and schedule staleness.

It is an **internal, unpublished** package that lives inside the ODM Dashboard
repository and is consumed by ODM through source imports. ODM Dashboard is its
first consumer; other Lihok products are expected to consume the same package
rather than re-implementing any of this.

## Boundary rules

- Pure TypeScript. **No** React, tRPC, Drizzle, database, Node-only or ODM
  (`src/`, `api/`, `db/`, `@/…`) imports. Zero runtime dependencies.
- One declaration of every algorithm. The extraction was a **move**
  (`git mv`), not a copy: the moved files are byte-identical to their
  pre-extraction blobs.
- Consumers import from the public entry point (`@lihok/project-controls`), not
  from deep paths. Test fixtures use the `@lihok/project-controls/testing`
  subpath.
- The dependency direction is one-way: **ODM → @lihok/project-controls**.

Two repository guards enforce this: `src/lib/project-controls-boundary.test.ts`
(no redeclaration of package-owned symbols, no package→ODM import, no
re-export shim that gained logic) and the ESLint `no-restricted-imports` rule
(no deep imports).

## Layout

```
src/
  index.ts              curated public API
  types.ts              public type surface (re-exported, never re-declared)
  testing.ts            test-only entry point
  schedulingEngine.ts   CPM forward/backward pass, working-day arithmetic
  calendarModel.ts      working-day validation, schedule-affecting rules
  progressModel.ts      progress + Data Date rules (#440 contract)
  statusingModel.ts     derived lifecycle and project roll-up
  baselineVariance.ts   baseline comparison + variance semantics (#441 contract)
  scheduleStaleness.ts  which audited changes invalidate a schedule
  __fixtures__/         frozen pre-extraction parity oracle
```

## Parity

`src/__fixtures__/parityGolden.json` was generated from the authoritative
pre-extraction implementation at ODM `5d189f0`. `parity.test.ts` replays the
same scenarios and requires a **byte-identical** reproduction, so any semantic
drift introduced by moving the code fails CI.

## Not in M1

- Database schema and migration ownership (schema stays with ODM; forward
  migration ownership is an M2 decision — applied migration history must never
  be moved, renamed, squashed or rewritten).
- Baseline **capture** persistence, authorization, audit, rate limiting and
  project tokens (they remain in ODM; M1 extracts comparison semantics only).
- React panels, pages, design system, tRPC transport.
- `LIFECYCLE_CHIP_CLASS` is a presentation constant that currently ships from
  `statusingModel.ts`; relocating it to the UI layer is a follow-up cleanup.
