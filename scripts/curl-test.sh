#!/bin/bash
set -e
API_URL="${API_BASE:-https://odm-dashboard.onrender.com}"
echo "Testing API: $API_URL/api/governance/state/aglipay"
curl -s "$API_URL/api/governance/state/aglipay" | head -500
echo ""
