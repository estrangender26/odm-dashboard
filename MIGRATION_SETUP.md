# Migration Automation Setup

## Goal
Enable Codex to run migration commands autonomously in production Render environment.

## Option 1: GitHub Actions (Recommended for Automation)

### Step 1: Generate Render API Key
1. Go to https://dashboard.render.com/account
2. Click "API Keys" 
3. Generate new key (name: "Codex Migration")
4. Copy the key (starts with `rnd_`)

### Step 2: Add to GitHub Secrets
1. Go to https://github.com/estrangender26/odm-dashboard/settings/secrets
2. Click "New repository secret"
3. Name: `RENDER_API_KEY`
4. Value: Paste the key from Step 1
5. Click "Add secret"

### Step 3: Run Migration via GitHub Actions
1. Go to https://github.com/estrangender26/odm-dashboard/actions
2. Click "Migration Pilot" workflow
3. Click "Run workflow"
4. Fill in:
   - Source: `governance_files` (or `governance_uploads`, `doc_files`)
   - Record ID: Leave empty for list, or specific ID like `7`
   - Execute: Check only when ready to migrate (not for dry-run)
5. Click "Run workflow"

## Option 2: Local Render CLI (Immediate Use)

Already set up - Render CLI is authenticated on this machine.

Commands are prepared in `.github/workflows/` and `scripts/migration-runner.sh`.

## Security Notes
- API Key stored only in GitHub Secrets (never in code)
- Workflow requires manual trigger (workflow_dispatch)
- Execute mode requires explicit checkbox
- Logs are sanitized automatically
- No credentials in output

## Current Status
- ✅ Render CLI authenticated locally
- ✅ Supabase CLI authenticated locally  
- ✅ Workflow files created
- ⏳ Waiting for RENDER_API_KEY in GitHub Secrets (for autonomous execution)
