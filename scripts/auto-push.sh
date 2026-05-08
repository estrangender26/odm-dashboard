#!/bin/bash
# Auto-push script — runs after every successful build (background, non-blocking)
# Usage: bash scripts/auto-push.sh "commit message"

cd "$(dirname "$0")/.."

MESSAGE="${1:-Auto-update}"

# Run push in background so it doesn't block the build
(
  sleep 1
  git add -A 2>/dev/null
  
  # Check if there are changes to commit
  if git diff --cached --quiet 2>/dev/null; then
    exit 0
  fi
  
  git commit -m "$MESSAGE" 2>/dev/null
  
  # Push with timeout - don't hang if network is down
  timeout 30 git push https://estrangender26:GITHUB_TOKEN@github.com/estrangender26/odm-dashboard.git main 2>/dev/null
) &

echo "[AUTO-PUSH] Push queued in background"
