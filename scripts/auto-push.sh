#!/bin/bash
# Auto-push script — runs after every successful build
# Usage: bash scripts/auto-push.sh "commit message"

cd "$(dirname "$0")/.."

MESSAGE="${1:-Auto-update}"

echo "[AUTO-PUSH] Staging changes..."
git add -A

# Check if there are changes to commit
if git diff --cached --quiet; then
  echo "[AUTO-PUSH] No changes to push."
  exit 0
fi

echo "[AUTO-PUSH] Committing: $MESSAGE"
git commit -m "$MESSAGE"

echo "[AUTO-PUSH] Pushing to GitHub..."
if git push https://estrangender26:GITHUB_TOKEN@github.com/estrangender26/odm-dashboard.git main 2>&1; then
  echo "[AUTO-PUSH] ✅ Pushed successfully"
else
  echo "[AUTO-PUSH] ⚠️ Push failed, will retry..."
  sleep 3
  git push https://estrangender26:GITHUB_TOKEN@github.com/estrangender26/odm-dashboard.git main 2>&1
fi
