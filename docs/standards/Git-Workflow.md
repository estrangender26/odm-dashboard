# Lihok Git Workflow

**Status:** Draft  
**Authority:** Lihok Architecture Governance

---

## 1. Branching Model

- `main` is the production branch.
- Feature branches use the `codex/<short-description>` prefix by default.
- Long-lived release branches are created only when needed.

## 2. Pull Request Process

1. Create a feature branch from the latest `main`.
2. Make focused, reviewable commits.
3. Run `npm run check`, `npm run test`, and `npm run build` before requesting review.
4. Open a PR with a clear title and description.
5. Obtain explicit approval before merging.
6. Merge using squash or merge commit according to team convention.

## 3. Commit Messages

- Use Conventional Commits style: `feat(module): description`.
- Keep the first line under 72 characters.
- Explain *why* in the body when the reason is not obvious.

## 4. Protected Branches

- Direct pushes to `main` are prohibited.
- Destructive operations (force push, deploy, production migration) require explicit approval.
