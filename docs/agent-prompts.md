# Agent Prompts — ODM Dashboard

Reusable prompts for Gerald's Telegram + OpenClaw phone-first workflow.

## 1. Safe Repo Health Check

Follow AGENTS.md.

No edits.

In /Users/gcb/Projects/odm-dashboard, run:

pwd
git branch --show-current
git status --short
npm run check

Report:
- Repo path
- Branch
- Git status
- Checks run
- Result
- Files changed
- Recommended next step

Do not edit, stage, commit, push, deploy, delete, reset, or migrate.

## 2. Safe Issue Analysis

Follow AGENTS.md.

Task: analyze this issue only.

Issue:
[PASTE ISSUE HERE]

No edits.

In /Users/gcb/Projects/odm-dashboard:

1. Run:
pwd
git branch --show-current
git status --short
npm run check

2. Search for relevant files.

3. Inspect only the most relevant files.

4. Check docs/agent-decisions.md for product intent before recommending UI/data changes.

Report:
- Repo path
- Branch
- Git status
- Check result
- Relevant files found
- Likely cause
- Whether this may be intentional design
- Smallest safe fix recommended
- Confirm no files changed

Do not edit, stage, commit, push, deploy, delete, reset, or migrate.

## 3. Approved Small Edit

Follow AGENTS.md.

Approved small edit.

Issue:
[PASTE APPROVED ISSUE HERE]

Edit only:
[PASTE FILE PATHS HERE]

Do not edit any other file.
Do not stage, commit, push, deploy, delete, reset, or migrate.

After editing, run:
git status --short
npm run check
git diff --stat

Report:
- Repo path
- Branch
- Files changed
- Exact sections changed
- Check result
- Whether issue is fixed
- Recommended next step

Do not commit yet.

## 4. Commit Approved Files Only

Follow AGENTS.md.

Approved small git action: commit only the approved files.

Approved files:
[PASTE FILE PATHS HERE]

Commit message:
[PASTE COMMIT MESSAGE HERE]

Run:
git status --short
git add [PASTE FILE PATHS HERE]
git commit -m "[PASTE COMMIT MESSAGE HERE]"
git status --short
npm run check

Do not push.
Do not edit files.
Do not deploy.
Do not run migrations.

Report:
- Repo path
- Branch
- Commit hash
- Git status after commit
- Check result
- Files changed
- Recommended next step

## 5. Stop / No Edits

Follow AGENTS.md.

Correction: stop the previous fix plan.

No edits.

Do not modify files.
Do not stage, commit, push, deploy, delete, reset, or migrate.

Run only:
cd /Users/gcb/Projects/odm-dashboard
git status --short

Report:
- Current git status
- Confirm no files changed
- Confirm no action was taken
---

# Agent v2 — GitHub Issue / PR Assistant Prompts

## 6. Create Feature Branch

Follow AGENTS.md.

Approved git action: create a new feature branch from main.

Branch name:
[PASTE BRANCH NAME HERE]

In /Users/gcb/Projects/odm-dashboard:

1. Run:
git status -sb
git branch --show-current
git fetch origin
git checkout main
git pull origin main
npm run check

2. Create and switch to the new branch:
git checkout -b [PASTE BRANCH NAME HERE]

3. Verify:
git branch --show-current
git status -sb

Do not edit files.
Do not commit.
Do not push.
Do not deploy.
Do not run migrations.

Report:
- Repo path
- Starting branch
- New branch
- Git status
- Check result
- Confirm no files changed
- Recommended next step

## 7. GitHub Issue Analysis

Follow AGENTS.md.

Task: analyze this GitHub issue or requested change only.

Issue / request:
[PASTE ISSUE OR REQUEST HERE]

No edits.

In /Users/gcb/Projects/odm-dashboard:

1. Run:
pwd
git branch --show-current
git status --short
npm run check

2. Search for relevant files.

3. Inspect only the most relevant files.

4. Check docs/agent-decisions.md before recommending UI/data behavior changes.

Report:
- Repo path
- Branch
- Git status
- Check result
- Relevant files found
- Likely cause or implementation area
- Whether this may be intentional design
- Smallest safe fix recommended
- Files that would need editing
- Confirm no files changed

Do not edit, stage, commit, push, deploy, delete, reset, merge, or migrate.

## 8. Approved Issue Fix

Follow AGENTS.md.

Approved small edit for this issue.

Issue:
[PASTE APPROVED ISSUE HERE]

Edit only:
[PASTE APPROVED FILE PATHS HERE]

Do not edit any other file.
Do not stage, commit, push, deploy, delete, reset, merge, or migrate.

After editing, run:
git status --short
npm run check
git diff --stat

Report:
- Repo path
- Branch
- Files changed
- Exact sections changed
- Check result
- Whether the issue is fixed
- Recommended next step

Do not commit yet.

## 9. Commit And Push Feature Branch

Follow AGENTS.md.

Approved git action: commit approved files and push the current feature branch.

Approved files:
[PASTE APPROVED FILE PATHS HERE]

Commit message:
[PASTE COMMIT MESSAGE HERE]

In /Users/gcb/Projects/odm-dashboard:

1. Run:
git status --short
git branch --show-current

2. Stage only the approved files:
git add [PASTE APPROVED FILE PATHS HERE]

3. Commit:
git commit -m "[PASTE COMMIT MESSAGE HERE]"

4. Push current branch:
git push -u origin HEAD

5. Verify:
git status -sb
git log --oneline --decorate -5

Do not merge.
Do not deploy.
Do not run migrations.

Report:
- Repo path
- Branch pushed
- Commit hash
- Push result
- Git status
- Check result if run
- Files committed
- Recommended next step

## 10. Open Pull Request Only

Follow AGENTS.md.

Approved GitHub action: open a PR only.

PR title:
[PASTE PR TITLE HERE]

PR body:
[PASTE PR BODY HERE]

In /Users/gcb/Projects/odm-dashboard:

1. Run:
git status -sb
git branch --show-current

2. Check for an existing open PR for this branch:
gh pr list --head $(git branch --show-current) --state open

3. If no open PR exists, create one:
gh pr create --base main --head $(git branch --show-current) --title "[PASTE PR TITLE HERE]" --body "[PASTE PR BODY HERE]"

4. View PR:
gh pr view --web

Do not merge.
Do not deploy.
Do not run migrations.
Do not edit files.

Report:
- PR title
- PR URL
- Base branch
- Head branch
- Whether PR was created or already existed
- Confirm no merge/deploy was done
- Recommended next step

## 11. Post-Merge Sync And Cleanup

Follow AGENTS.md.

Task: post-merge sync and cleanup check.

Only proceed with branch deletion if Gerald explicitly approves.

In /Users/gcb/Projects/odm-dashboard:

1. Run:
git status -sb
git branch --show-current
git fetch origin
git checkout main
git pull origin main
npm run check

2. Verify PR merge status:
gh pr view [PASTE PR NUMBER HERE] --json state,mergedAt,baseRefName,headRefName,url,title

3. Report:
- Current branch
- PR merge status
- Whether main is synced
- Check result
- Whether feature branch can be safely deleted
- Recommended cleanup command

Do not delete branches unless explicitly approved.
Do not deploy.
Do not run migrations.

## 12. Briefing-Style Telegram Aliases

These aliases map Gerald's natural Telegram briefing commands to the safe ODM repo agent workflow.

### A. `brief me ODM repo`

Equivalent to:

Follow AGENTS.md. Use docs/agent-prompts.md. Run prompt #1.

Also summarize open PRs and latest 5 commits.

This is a read-only briefing. It must never edit, commit, push, merge, deploy, delete, reset, or run migrations.

Run:
pwd
git branch --show-current
git status --short
npm run check
gh pr list --state open --limit 10 || true
git log --oneline --decorate -5

Report:
- Repo path
- Current branch
- Git status
- Check result
- Open PRs (if available)
- Latest 5 commits
- Recommended next step

### B. `coding plan ODM: [issue/request]`

Equivalent to:

Follow AGENTS.md. Use docs/agent-prompts.md. Run prompt #7.

Issue / request:
[PASTE ISSUE OR REQUEST HERE]

No edits.

### C. `approved ODM fix: [issue + approved files]`

Equivalent to:

Follow AGENTS.md. Use docs/agent-prompts.md. Run prompt #8.

Issue:
[PASTE APPROVED ISSUE HERE]

Edit only:
[PASTE APPROVED FILE PATHS HERE]

### D. `ODM commit/push: [approved files + commit message]`

Equivalent to:

Follow AGENTS.md. Use docs/agent-prompts.md. Run prompt #9.

Approved files:
[PASTE APPROVED FILE PATHS HERE]

Commit message:
[PASTE COMMIT MESSAGE HERE]

### E. `ODM open PR: [title + body]`

Equivalent to:

Follow AGENTS.md. Use docs/agent-prompts.md. Run prompt #10.

PR title:
[PASTE PR TITLE HERE]

PR body:
[PASTE PR BODY HERE]

### F. `ODM post-merge sync: [PR number]`

Equivalent to:

Follow AGENTS.md. Use docs/agent-prompts.md. Run prompt #11.

PR number:
[PASTE PR NUMBER HERE]

### Important rules for aliases

- If required details are missing, ask for the missing details.
- Do not guess branch names, issue descriptions, approved files, commit messages, PR titles, or PR bodies.
- `brief me ODM repo` is read-only and must never edit, commit, push, merge, deploy, delete, reset, or run migrations.
- For editing or GitHub actions, require explicit approval.

## 13. Current Active Repo Short Aliases

These short aliases are the preferred daily commands for the current active repo.

Current active repo: `/Users/gcb/Projects/odm-dashboard`

### A. `repo`

Run a read-only briefing for the current active repo.

Equivalent to:

Follow AGENTS.md. Use docs/agent-prompts.md. Run prompt #1.

Also summarize open PRs and latest 5 commits.

This is read-only. It must never edit, commit, push, merge, deploy, delete, reset, or run migrations.

Run:
pwd
git branch --show-current
git status --short
npm run check
gh pr list --state open --limit 10 || true
git log --oneline --decorate -5

Report:
- Active repo path
- Current branch
- Git status
- Check result
- Open PRs (if available)
- Latest 5 commits
- Recommended next step

### B. `plan: [issue/request]`

Analyze the issue only for the current active repo.

Equivalent to prompt #7.

Issue / request:
[PASTE ISSUE OR REQUEST HERE]

No edits.

### C. `fix: [issue + approved files]`

Apply an approved fix only.

Equivalent to prompt #8.

Issue:
[PASTE APPROVED ISSUE HERE]

Edit only:
[PASTE APPROVED FILE PATHS HERE]

### D. `push: [approved files + commit message]`

Commit and push approved files only.

Equivalent to prompt #9.

Approved files:
[PASTE APPROVED FILE PATHS HERE]

Commit message:
[PASTE COMMIT MESSAGE HERE]

### E. `pr: [title + body]`

Open a PR only.

Equivalent to prompt #10.

PR title:
[PASTE PR TITLE HERE]

PR body:
[PASTE PR BODY HERE]

### F. `sync: [PR number]`

Post-merge sync and cleanup.

Equivalent to prompt #11.

PR number:
[PASTE PR NUMBER HERE]

### Important rules for short aliases

- These short aliases use the current active repo.
- Current active repo: `/Users/gcb/Projects/odm-dashboard`.
- Every response must report the active repo path before taking action.
- If the user later switches to another repo, confirm the new active repo path before using these short aliases.
- If required details are missing, ask for them instead of guessing.
- `repo` is read-only and must never edit, commit, push, merge, deploy, delete, reset, or run migrations.
- Editing, committing, pushing, PR creation, merging, deployment, deletion, and migrations still require explicit approval.
