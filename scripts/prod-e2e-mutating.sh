#!/usr/bin/env bash
# FR-P2 — GUARDED mutating production E2E (plan §Mutating Production Tests).
#
# This script MUTATES production data. It refuses to run unless ALL of:
#   E2E_ALLOW_PROD_MUTATIONS=1
#   E2E_TEST_OPERATION_ID=<id of a DISPOSABLE test operation, never a real op>
#   E2E_SESSION_COOKIE=<fp_sid value of a test user signed into the suite>
#
#   E2E_ALLOW_PROD_MUTATIONS=1 \
#   E2E_TEST_OPERATION_ID=cmq... \
#   E2E_SESSION_COOKIE=xxxx \
#   ./scripts/prod-e2e-mutating.sh
#
# Guardrails (per plan): test data is prefixed E2E-, created ids are recorded,
# cleanup runs even on failure (trap), and failed cleanup prints the exact
# curl command for manual repair.
set -u

BASE="${E2E_BASE_URL:-https://suite.raumdock.org}"
API="$BASE/fleetplanner/api/v1"

# ── guards ────────────────────────────────────────────────────────────
if [ "${E2E_ALLOW_PROD_MUTATIONS:-0}" != "1" ]; then
  echo "REFUSED: set E2E_ALLOW_PROD_MUTATIONS=1 to run mutating tests against production."
  exit 2
fi
if [ -z "${E2E_TEST_OPERATION_ID:-}" ]; then
  echo "REFUSED: set E2E_TEST_OPERATION_ID to a DISPOSABLE test operation id."
  exit 2
fi
if [ -z "${E2E_SESSION_COOKIE:-}" ]; then
  echo "REFUSED: set E2E_SESSION_COOKIE to the fp_sid value of a signed-in test user."
  exit 2
fi
OP="$E2E_TEST_OPERATION_ID"
COOKIE="fp_sid=$E2E_SESSION_COOKIE"

py() { # file, expr
  (python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))" "$1" "$2" 2>/dev/null) || \
  (python  -c "import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))" "$1" "$2")
}

fail=0
note() { echo "$@"; }
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi }

# ── session / csrf ────────────────────────────────────────────────────
curl -fsS -H "cookie: $COOKIE" "$API/session" -o /tmp/m_session || { echo "FAIL session unreachable"; exit 1; }
USERID="$(py /tmp/m_session "d['user']['id'] if d['user'] else ''")"
CSRF="$(py /tmp/m_session "d['csrfToken'] or ''")"
if [ -z "$USERID" ] || [ -z "$CSRF" ]; then
  echo "REFUSED: session invalid (cookie expired or wrong) — aborting before any mutation."
  exit 2
fi
note "session ok: user=$USERID"

MUT_HDR=(-H "cookie: $COOKIE" -H "x-csrf-token: $CSRF" -H "content-type: application/json")

# Cleanup registry — every entry is "description<TAB>curl args…" executed on exit.
CLEANUPS=()
cleanup() {
  local rc=0
  for entry in "${CLEANUPS[@]:-}"; do
    [ -z "$entry" ] && continue
    local desc="${entry%%$'\t'*}" cmd="${entry#*$'\t'}"
    if eval "curl -fsS ${MUT_HDR[*]@Q} $cmd -o /dev/null"; then
      echo "cleanup ok   $desc"
    else
      echo "cleanup FAIL $desc — run manually:"
      echo "  curl -H 'cookie: fp_sid=…' -H 'x-csrf-token: …' $cmd"
      rc=1
    fi
  done
  CLEANUPS=()
  return $rc
}
trap cleanup EXIT

opdetail() { curl -fsS -H "cookie: $COOKIE" "$API/operations/$OP" -o /tmp/m_op; }

# ── 1. CQB signup → withdraw ─────────────────────────────────────────
code="$(curl -s -o /tmp/m_r -w '%{http_code}' "${MUT_HDR[@]}" -X POST -d '{"note":"E2E-mutating-test"}' "$API/operations/$OP/cqb/signup")"
check "cqb signup 200" "200" "$code"
CLEANUPS+=("cqb withdraw	-X DELETE '$API/operations/$OP/cqb/signup'")
opdetail && check "viewerCqbSignedUp true" "True" "$(py /tmp/m_op "d['viewerCqbSignedUp']")"
code="$(curl -s -o /dev/null -w '%{http_code}' "${MUT_HDR[@]}" -X DELETE "$API/operations/$OP/cqb/signup")"
check "cqb withdraw 200" "200" "$code"
CLEANUPS=("${CLEANUPS[@]/cqb withdraw*/}")
opdetail && check "viewerCqbSignedUp false again" "False" "$(py /tmp/m_op "d['viewerCqbSignedUp']")"

# ── 2. hangar share toggle → restore ─────────────────────────────────
opdetail
BEFORE="$(py /tmp/m_op "str(d['viewerHangarShared']).lower()")"
TOGGLE=$([ "$BEFORE" = "true" ] && echo false || echo true)
code="$(curl -s -o /dev/null -w '%{http_code}' "${MUT_HDR[@]}" -X PUT -d "{\"allow\":$TOGGLE,\"note\":\"E2E-mutating-test\"}" "$API/operations/$OP/hangar-share")"
check "hangar-share toggle 200" "200" "$code"
CLEANUPS+=("hangar-share restore	-X PUT -d '{\"allow\":$BEFORE}' '$API/operations/$OP/hangar-share'")
code="$(curl -s -o /dev/null -w '%{http_code}' "${MUT_HDR[@]}" -X PUT -d "{\"allow\":$BEFORE}" "$API/operations/$OP/hangar-share")"
check "hangar-share restore 200" "200" "$code"
CLEANUPS=("${CLEANUPS[@]/hangar-share restore*/}")

# ── 3. claim free seat → unclaim ─────────────────────────────────────
opdetail
SEAT="$(py /tmp/m_op "next((s['id'] for u in d['units'] if u['status']=='accepted' for s in u['seats'] if s['claimedBy'] is None and s['order']!=0),'')")"
if [ -z "$SEAT" ]; then
  note "skip seat claim (no free seat in test op)"
else
  code="$(curl -s -o /tmp/m_r -w '%{http_code}' "${MUT_HDR[@]}" -X POST "$API/operations/$OP/seats/$SEAT/claim")"
  if [ "$code" = "409" ]; then
    note "skip seat claim (409: $(py /tmp/m_r "d['error']['message']"))"
  else
    check "seat claim 200" "200" "$code"
    CLEANUPS+=("seat unclaim	-X DELETE '$API/operations/$OP/seats/$SEAT/claim'")
    code="$(curl -s -o /dev/null -w '%{http_code}' "${MUT_HDR[@]}" -X DELETE "$API/operations/$OP/seats/$SEAT/claim")"
    check "seat unclaim 200" "200" "$code"
    CLEANUPS=("${CLEANUPS[@]/seat unclaim*/}")
  fi
fi

# ── 4. resource link add → delete (operator only) ────────────────────
code="$(curl -s -o /tmp/m_r -w '%{http_code}' "${MUT_HDR[@]}" -X POST -d '{"url":"https://example.com/e2e","title":"E2E-Briefing"}' "$API/operations/$OP/resource-links")"
if [ "$code" = "403" ]; then
  note "skip resource link (test user is not an operator of the test op)"
else
  check "resource link add 200" "200" "$code"
  LINKID="$(py /tmp/m_r "d['link']['id']")"
  CLEANUPS+=("resource link delete	-X DELETE '$API/operations/$OP/resource-links/$LINKID'")
  code="$(curl -s -o /dev/null -w '%{http_code}' "${MUT_HDR[@]}" -X DELETE "$API/operations/$OP/resource-links/$LINKID")"
  check "resource link delete 200" "200" "$code"
  CLEANUPS=("${CLEANUPS[@]/resource link delete*/}")
fi

echo
if [ "$fail" = "0" ]; then echo "ALL MUTATING CHECKS PASSED (cleanup complete)"; else echo "FAILURES PRESENT"; exit 1; fi
