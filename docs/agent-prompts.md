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