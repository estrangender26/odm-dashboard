# Agent Quickstart — ODM Dashboard

This repo has a safe AI agent workflow for Telegram + OpenClaw, Codex App, Claude Code, OpenCode, and future coding agents.

## What this is

The agent files in this repo are not app features.

They are repo instructions that tell AI coding agents how to work safely.

## Main files

- AGENTS.md — safety rules and default workflow
- docs/agent-decisions.md — product decisions and intentional behavior
- docs/agent-prompts.md — reusable prompts for Telegram/OpenClaw

## Daily use from Telegram

### Check repo health

Use this when you want to know if the repo is clean and checks pass.

Prompt:

Follow AGENTS.md. Use docs/agent-prompts.md. Run prompt #1.

### Analyze an issue safely

Use this when you want the agent to investigate a bug or change request without editing files.

Prompt:

Follow AGENTS.md. Use docs/agent-prompts.md. Run prompt #7.

Issue / request:
[PASTE ISSUE HERE]

No edits.

### Apply an approved fix

Use this only after the agent has analyzed the issue and you approve the fix.

Prompt:

Follow AGENTS.md. Use docs/agent-prompts.md. Run prompt #8.

Issue:
[PASTE APPROVED ISSUE HERE]

Edit only:
[PASTE APPROVED FILE PATHS HERE]

### Commit and push a feature branch

Use this after an approved fix passes checks.

Prompt:

Follow AGENTS.md. Use docs/agent-prompts.md. Run prompt #9.

Approved files:
[PASTE FILE PATHS HERE]

Commit message:
[PASTE COMMIT MESSAGE HERE]

### Open a PR

Use this after the branch is pushed.

Prompt:

Follow AGENTS.md. Use docs/agent-prompts.md. Run prompt #10.

PR title:
[PASTE TITLE HERE]

PR body:
[PASTE BODY HERE]

## Safety rules

The agent must ask for approval before:

- editing files
- committing
- pushing
- opening PRs
- merging PRs
- deploying
- deleting files
- running migrations
- changing authentication or security settings
- sending emails

## Simple workflow

1. Run prompt #1
2. Run prompt #7 to analyze
3. Approve prompt #8 if the fix is acceptable
4. Run checks
5. Approve prompt #9 to commit and push
6. Approve prompt #10 to open PR
7. Review manually
8. Merge only when ready

## Important

The agent should never pretend work was done.

If a command fails, it should report the actual error and wait for the next instruction.