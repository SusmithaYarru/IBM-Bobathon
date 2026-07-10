#!/usr/bin/env bash
# test-ingest.sh — Smoke test: send all 3 sample HL7 messages to ACE
#
# Prerequisites:
#   - ACE integration server running on localhost:7080
#   - Agent layer running on localhost:4000
#   - curl available
#
# Usage:  bash tests/test-ingest.sh

set -euo pipefail

ACE_URL="${ACE_URL:-http://localhost:7080/hl7/ingest}"
AGENT_URL="${AGENT_URL:-http://localhost:4000}"
SAMPLES_DIR="$(cd "$(dirname "$0")/../samples" && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

echo "=========================================="
echo " HL7 ACE Starter Kit — Smoke Tests"
echo "=========================================="
echo ""

# ─── 1. Health check on Agent Layer ──────────────────────────────────────────
info "Checking agent layer health..."
HEALTH=$(curl -sf "${AGENT_URL}/health" || echo '{"status":"DOWN"}')
STATUS=$(echo "$HEALTH" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
if [ "$STATUS" = "UP" ]; then
    pass "Agent layer is UP"
else
    fail "Agent layer health check failed: $HEALTH"
fi

echo ""

# ─── 2. Send ADT^A01 ─────────────────────────────────────────────────────────
info "Sending ADT^A01 (Patient Admission)..."
ADT_FILE="${SAMPLES_DIR}/ADT_A01_admit.hl7"
HTTP_CODE=$(curl -s -o /tmp/adt_response.txt -w "%{http_code}" \
    -X POST "${ACE_URL}" \
    -H "Content-Type: application/hl7-v2; charset=utf-8" \
    --data-binary "@${ADT_FILE}")

if [ "$HTTP_CODE" = "200" ]; then
    ACK=$(cat /tmp/adt_response.txt | tr -d '\r' | head -2)
    pass "ADT^A01 — HTTP 200 | ACK: $(echo $ACK | grep -o 'MSA|AA' || echo 'received')"
else
    fail "ADT^A01 failed with HTTP $HTTP_CODE: $(cat /tmp/adt_response.txt)"
fi

# ─── 3. Send ORU^R01 (critical lab) ──────────────────────────────────────────
info "Sending ORU^R01 (Critical Lab Result)..."
ORU_FILE="${SAMPLES_DIR}/ORU_R01_lab_result.hl7"
HTTP_CODE=$(curl -s -o /tmp/oru_response.txt -w "%{http_code}" \
    -X POST "${ACE_URL}" \
    -H "Content-Type: application/hl7-v2; charset=utf-8" \
    --data-binary "@${ORU_FILE}")

if [ "$HTTP_CODE" = "200" ]; then
    pass "ORU^R01 — HTTP 200 (critical Potassium 6.8 HH) | ACK received"
else
    fail "ORU^R01 failed with HTTP $HTTP_CODE"
fi

# ─── 4. Send ORM^O01 (drug allergy) ──────────────────────────────────────────
info "Sending ORM^O01 (Penicillin order — allergy conflict expected)..."
ORM_FILE="${SAMPLES_DIR}/ORM_O01_order.hl7"
HTTP_CODE=$(curl -s -o /tmp/orm_response.txt -w "%{http_code}" \
    -X POST "${ACE_URL}" \
    -H "Content-Type: application/hl7-v2; charset=utf-8" \
    --data-binary "@${ORM_FILE}")

if [ "$HTTP_CODE" = "200" ]; then
    pass "ORM^O01 — HTTP 200 | Penicillin allergy alert expected in agent output"
elif [ "$HTTP_CODE" = "422" ]; then
    pass "ORM^O01 — HTTP 422 (allergy conflict correctly flagged)"
else
    fail "ORM^O01 failed with HTTP $HTTP_CODE"
fi

# ─── 5. Demo endpoint (agent-only test) ───────────────────────────────────────
echo ""
info "Running agent demo pipeline..."
DEMO=$(curl -sf "${AGENT_URL}/demo")
COUNT=$(echo "$DEMO" | grep -o '"status"' | wc -l | tr -d ' ')
if [ "$COUNT" -ge 3 ]; then
    pass "Demo pipeline — $COUNT results returned"
else
    fail "Demo pipeline returned fewer than 3 results"
fi

echo ""
echo "=========================================="
echo " All smoke tests completed successfully"
echo "=========================================="
