#!/usr/bin/env bash
# FR-P2 — read-only production E2E smoke (Phase 4 exit gate + §Production E2E Plan).
# Strictly read-only: GET only, no session, no mutations. Safe to run anytime.
#
#   E2E_BASE_URL=https://suite.raumdock.org ./scripts/prod-e2e-readonly.sh
set -u

BASE="${E2E_BASE_URL:-https://suite.raumdock.org}"
API="$BASE/fleetplanner/api/v1"
NEXT="$BASE/fleetplanner-next"
fail=0

check() { # name, expected, actual
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi
}
contains() { # name, haystack, needle
  case "$2" in *"$3"*) echo "ok   $1" ;; *) echo "FAIL $1: missing [$3]"; fail=1 ;; esac
}
not_contains() { # name, haystack, needle
  case "$2" in *"$3"*) echo "FAIL $1: found [$3]"; fail=1 ;; *) echo "ok   $1" ;; esac
}

# ── API ───────────────────────────────────────────────────────────────
health="$(curl -fsS "$API/health" 2>/dev/null)" || { echo "FAIL health unreachable"; exit 1; }
contains "health status ok" "$health" '"status":"ok"'

ct="$(curl -fsS -o /dev/null -w '%{content_type}' "$API/health")"
contains "api content-type json" "$ct" "application/json"

openapi="$(curl -fsS "$API/openapi.json")"
contains "openapi 3.1" "$openapi" '"openapi":"3.1.0"'
for secret in DISCORD_RDOCRTC_BOT_TOKEN FLEETPLANNER_DB_PASSWORD LIVEKIT_API_SECRET "postgresql://" "10.10.10."; do
  not_contains "openapi no secret: $secret" "$openapi" "$secret"
done

docs_code="$(curl -s -o /tmp/e2e_docs -w '%{http_code}' "$API/docs")"
check "api docs 200" "200" "$docs_code"
contains "api docs swagger ui" "$(cat /tmp/e2e_docs)" "swagger-ui"

session="$(curl -fsS "$API/session")"
check "session anonymous" '{"user":null,"memberships":[],"csrfToken":null}' "$session"

guilds_code="$(curl -s -o /tmp/e2e_guilds -w '%{http_code}' "$API/guilds")"
check "guilds anon 401" "401" "$guilds_code"
contains "guilds 401 envelope" "$(cat /tmp/e2e_guilds)" '"code":"unauthenticated"'
not_contains "guilds 401 not html" "$(cat /tmp/e2e_guilds)" "<html"

ops="$(curl -fsS "$API/operations")"
contains "operations json" "$ops" '"operations":'
not_contains "operations not html" "$ops" "<html"

badid_code="$(curl -s -o /dev/null -w '%{http_code}' "$API/operations/..%2Fetc")"
check "invalid op id 400" "400" "$badid_code"

# ── SPA shadow path ───────────────────────────────────────────────────
idx_code="$(curl -s -o /tmp/e2e_idx -w '%{http_code}' "$NEXT/")"
check "spa index 200" "200" "$idx_code"
contains "spa index asset base" "$(cat /tmp/e2e_idx)" "/fleetplanner-next/assets/"

asset="$(grep -o '/fleetplanner-next/assets/index-[^"]*\.js' /tmp/e2e_idx | head -1)"
if [ -n "$asset" ]; then
  asset_code="$(curl -s -o /tmp/e2e_js -w '%{http_code}' "$BASE$asset")"
  check "spa js bundle 200" "200" "$asset_code"
  contains "spa bundle targets /api/v1" "$(cat /tmp/e2e_js)" "/fleetplanner/api/v1"
else
  echo "FAIL spa asset path not found in index"; fail=1
fi

deep_code="$(curl -s -o /dev/null -w '%{http_code}' "$NEXT/ops/some-op-id")"
check "spa deep link serves index (200)" "200" "$deep_code"

# ── guards unchanged ──────────────────────────────────────────────────
m1="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/metrics")"
m2="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/fleetplanner/metrics")"
check "/metrics blocked" "404" "$m1"
check "/fleetplanner/metrics blocked" "404" "$m2"

ssr_code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/fleetplanner/")"
check "ssr still serves" "200" "$ssr_code"

echo
if [ "$fail" = "0" ]; then echo "ALL CHECKS PASSED"; else echo "FAILURES PRESENT"; exit 1; fi
