# AGENTS.md — ODM Dashboard Agent Rules

## Project
Main repo:
`/Users/gcb/Projects/odm-dashboard`

This project is part of Gerald C. Balucan's practical AI agent workflow for ODM Dashboard and future Lihok Technologies products.

## Default workflow

Always start safely.

1. Inspect first.
2. Run basic checks when appropriate:
 - `pwd`
 - `git branch --show-current`
 - `git status --short`
 - `npm run check`
3. Summarize what is wrong.
4. Propose the smallest safe fix.
5. Wait for approval before risky or major changes.
6. After approved changes, run checks again.
7. Summarize exactly what changed.

## Safety rules

Do not expose secrets.

Redact:
- API keys
- Telegram bot tokens
- database URLs
- passwords
- private keys
- GitHub tokens
- Microsoft credentials
- OAuth secrets

Require explicit approval before:
- deleting files
- running destructive commands
- force pushing
- deploying
- changing DNS
- sending emails
- running database migrations
- changing authentication/security settings
- modifying main/master directly

## Validation

Default validation command:

`npm run check`

If checks fail, summarize the actual error and propose the smallest safe fix.

## Product intent and decision log

Before treating UI/data differences as bugs, check:

`docs/agent-decisions.md`

If something appears missing from the UI but exists in the data model, ask whether it is intentionally hidden before recommending changes.

## Reporting format

After every task, report:

- Repo path
- Branch
- Git status
- Checks run
- Result
- Files changed
- Recommended next step