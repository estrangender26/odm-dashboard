#!/bin/bash
# Auto-push script — runs after every successful build (background, non-blocking)
# Usage: GITHUB_TOKEN=your_token bash scripts/auto-push.sh "commit message"

cd "$(dirname "$0")/.."

MESSAGE="${1:-Auto-update}"
TOKEN="${GITHUB_TOKEN:-}"
REMOTE_URL="${GITHUB_REMOTE:-https://github.com/estrangender26/odm-dashboard.git}"

# Run push in background so it doesn't block the build
(
  sleep 1
  git add -A 2>/dev/null
  
  # Check if there are changes to commit
  if git diff --cached --quiet 2>/dev/null; then
    exit 0
  fi
  
  git commit -m "$MESSAGE" 2>/dev/null
  
  # Push with token — try env var first, then token file
  if [ -n "$TOKEN" ]; then
    timeout 30 git push "https://estrangender26:${TOKEN}@${REMOTE_URL#https://}" main 2>/dev/null
  elif [ -f ".github-token" ] && grep -q "ghp_" .github-token 2>/dev/null; then
    FILE_TOKEN=$(grep "ghp_" .github-token | head -1 | tr -d '[:space:]')
    timeout 30 git push "https://estrangender26:${FILE_TOKEN}@${REMOTE_URL#https://}" main 2>/dev/null
  else
    timeout 30 git push "$REMOTE_URL" main 2>/dev/null
  fi
) &

echo "[AUTO-PUSH] Push queued in background"
