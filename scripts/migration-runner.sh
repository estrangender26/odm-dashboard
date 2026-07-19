#!/bin/bash
#
# Migration Runner - Local automation helper
#
# Requires: Render CLI authenticated locally
# Usage: ./scripts/migration-runner.sh [source] [record_id] [execute]
#

set -e

SOURCE="${1:-governance_files}"
RECORD_ID="${2:-}"
EXECUTE="${3:-false}"
SERVICE_ID="srv-d7tdokmgvqtc73ck8490"

echo "=== Migration Runner ==="
echo "Source: $SOURCE"
echo "Service: $SERVICE_ID"

# Check Render CLI
if ! command -v render &> /dev/null; then
    echo "❌ Render CLI not found. Install with: brew install render"
    exit 1
fi

# Check authentication
if ! render whoami &> /dev/null; then
    echo "❌ Render CLI not authenticated. Run: render login"
    exit 1
fi

echo "✅ Render CLI authenticated"

# Build command
if [ -n "$RECORD_ID" ]; then
    CMD="LEGACY_MIGRATOR_MODE=1 npx tsx scripts/minimal-storage-migrator.ts --sources $SOURCE --ids $RECORD_ID"
    if [ "$EXECUTE" = "true" ] || [ "$EXECUTE" = "--execute" ]; then
        CMD="$CMD --execute --confirm-production"
        echo "Mode: EXECUTE"
    else
        echo "Mode: DRY-RUN"
    fi
else
    CMD="LEGACY_MIGRATOR_MODE=1 npx tsx scripts/minimal-storage-migrator.ts --sources $SOURCE --limit 5"
    echo "Mode: LIST (dry-run, first 5 records)"
fi

echo ""
echo "Command: $CMD"
echo ""

# Open Render Shell and execute
# Note: This requires manual browser authentication to the shell
# The script will output the command to run - copy and paste into Render Shell

echo "=== Action Required ==="
echo "1. Open: https://dashboard.render.com/web-services/$SERVICE_ID/shell"
echo "2. Paste this command:"
echo ""
echo "   $CMD"
echo ""
echo "=== Or use Render CLI (if supported) ==="
echo "render ssh $SERVICE_ID"
echo ""
echo "Then run: $CMD"
