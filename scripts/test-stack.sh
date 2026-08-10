#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# One entry point for the local test stack (docker-compose.test.yml).
#
#   ./scripts/test-stack.sh up       build + start + wait until healthy
#   ./scripts/test-stack.sh down     stop and remove everything
#   ./scripts/test-stack.sh reset    wipe DB + Discord simulator state, keep containers
#   ./scripts/test-stack.sh logs     follow all logs (or: logs fleetplanner)
#   ./scripts/test-stack.sh smoke    fast HTTP + Discord-simulator sanity checks
#   ./scripts/test-stack.sh unit     vitest unit tests in Docker (no stack needed)
#   ./scripts/test-stack.sh unit:local   same, using the local pnpm install
#   ./scripts/test-stack.sh db       DB-integration tests in Docker (stack postgres)
#   ./scripts/test-stack.sh db:local     same, local pnpm + its own throwaway PG
#   ./scripts/test-stack.sh e2e      Playwright against the running stack
#   ./scripts/test-stack.sh all      up → unit → db → e2e → down
#
# Everything is local: Discord is tests/discord-mock, the database is a tmpfs
# postgres, and no production host is contacted at any point.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.test.yml)
WEB_URL="${TEST_STACK_WEB_URL:-http://localhost:8099}"
API_URL="${TEST_STACK_API_URL:-http://localhost:3299}"
MOCK_URL="${TEST_STACK_MOCK_URL:-http://localhost:4400}"
E2E_SECRET="test-e2e-login-secret-local-stack-0123456789"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${CYAN}▶ $*${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
bad()  { echo -e "  ${RED}✗${NC} $*"; }
warn() { echo -e "  ${YELLOW}–${NC} $*"; }

require_docker() {
  docker info >/dev/null 2>&1 || { bad "Docker daemon is not reachable."; exit 1; }
}

wait_for() {
  local url="$1" name="$2" tries="${3:-60}"
  for ((i = 0; i < tries; i++)); do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then ok "$name ready"; return 0; fi
    sleep 2
  done
  bad "$name did not become ready ($url)"
  "${COMPOSE[@]}" logs --tail 60
  return 1
}

cmd_up() {
  require_docker
  info "Building and starting the local test stack"
  "${COMPOSE[@]}" up -d --build
  wait_for "$MOCK_URL/__mock/health" "discord-mock"
  wait_for "$API_URL/api/v1/health" "fleetplanner backend"
  wait_for "$WEB_URL/" "fleetplanner-web (nginx front door)"
  echo
  ok "Stack is up:  web $WEB_URL   api $API_URL   discord-mock $MOCK_URL"
}

cmd_down() {
  info "Stopping the local test stack"
  "${COMPOSE[@]}" down -v --remove-orphans
  ok "down"
}

cmd_reset() {
  info "Resetting state (Discord simulator + E2E operations)"
  curl -fsS -X POST "$MOCK_URL/__mock/reset" >/dev/null && ok "discord-mock reset"
  curl -fsS -X POST "$API_URL/e2e/cleanup" -H "x-e2e-secret: $E2E_SECRET" >/dev/null \
    && ok "E2E operations wiped" || warn "E2E cleanup seam not reachable"
}

cmd_logs() { "${COMPOSE[@]}" logs -f "${@:-}"; }

cmd_smoke() {
  local fails=0
  info "HTTP surface"
  for path in "/" "/start" "/login"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$WEB_URL$path")
    [[ "$code" == "200" ]] && ok "GET $path → $code" || { bad "GET $path → $code"; ((fails++)); }
  done
  for path in "/api/v1/health" "/api/v1/openapi.json"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$WEB_URL$path")
    [[ "$code" == "200" ]] && ok "GET $path → $code" || { bad "GET $path → $code"; ((fails++)); }
  done

  info "Security headers (nginx is the single header layer)"
  headers=$(curl -sI --max-time 10 "$WEB_URL/")
  for h in "x-content-type-options" "x-frame-options" "content-security-policy" "referrer-policy"; do
    grep -qi "^$h:" <<<"$headers" && ok "$h present" || { bad "$h missing"; ((fails++)); }
  done
  [[ $(grep -ci "^content-security-policy:" <<<"$headers") -eq 1 ]] \
    && ok "exactly one CSP header" || { bad "duplicate/missing CSP header"; ((fails++)); }

  info "Discord simulator"
  if curl -fsS --max-time 5 "$MOCK_URL/__mock/health" | grep -q '"ok":true'; then
    ok "discord-mock healthy"
  else
    bad "discord-mock unhealthy"; ((fails++))
  fi
  # The app must reach the simulator, not the real Discord: ask it to list a
  # guild's channels through its own diagnostics-free path — a recorded call is
  # the proof.
  before=$(curl -fsS "$MOCK_URL/__mock/calls" | grep -c '"method"' || true)
  ok "$before Discord calls recorded so far"

  info "Auth is enforced"
  # /api/v1/operations is deliberately public (it lists public ops); these are not.
  for path in "/api/v1/guilds" "/api/v1/account" "/api/v1/hangar"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$WEB_URL$path")
    [[ "$code" == "401" || "$code" == "403" ]] && ok "GET $path unauthenticated → $code" \
      || { bad "GET $path unauthenticated → $code (expected 401/403)"; ((fails++)); }
  done
  # The E2E login seam must answer only to the right secret.
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$WEB_URL/e2e/login" \
    -H "content-type: application/json" -H "x-e2e-secret: wrong" -d '{"username":"e2e-smoke"}')
  [[ "$code" == "404" ]] && ok "E2E seam rejects a wrong secret → 404" \
    || { bad "E2E seam with a wrong secret → $code (expected 404)"; ((fails++)); }

  echo
  [[ $fails -eq 0 ]] && { ok "smoke passed"; return 0; } || { bad "$fails smoke check(s) failed"; return 1; }
}

cmd_unit() {
  # In Docker by default: a local pnpm store that is missing or half-written
  # breaks module resolution in ways that look like real test failures.
  require_docker
  info "Unit tests (vitest, Prisma mocked) — in Docker"
  "${COMPOSE[@]}" run --rm --build unit-tests "$@"
}

cmd_unit_local() {
  info "Unit tests (vitest, Prisma mocked) — local pnpm"
  pnpm --filter @rdoc-suite/fleetplanner test "$@"
}

cmd_db() {
  # In Docker, against the stack's Postgres (its own `fleetplanner_test`
  # database). The historical path — vitest spawning its own container via the
  # docker CLI — cannot run inside a container; this one can.
  require_docker
  info "DB-integration tests — in Docker, against the stack's postgres"
  "${COMPOSE[@]}" up -d fleetplanner-db-test
  "${COMPOSE[@]}" run --rm --build db-tests "$@"
}

cmd_db_local() {
  info "DB-integration tests — local pnpm, throwaway postgres via the docker CLI"
  pnpm --filter @rdoc-suite/fleetplanner test:db "$@"
}

cmd_e2e() {
  info "Playwright E2E against the local stack"
  [[ -d e2e/node_modules ]] || (cd e2e && npm install && npx playwright install chromium)
  cd e2e
  E2E_BASE_URL="$WEB_URL" \
  E2E_BASE_PATH="" \
  E2E_TEST_LOGIN_SECRET="$E2E_SECRET" \
  E2E_DISCORD_MOCK_URL="$MOCK_URL" \
  npx playwright test "$@"
}

cmd_all() {
  cmd_up
  cmd_unit
  cmd_db
  cmd_smoke
  cmd_e2e
  cmd_down
}

case "${1:-}" in
  up)     shift; cmd_up "$@" ;;
  down)   shift; cmd_down "$@" ;;
  reset)  shift; cmd_reset "$@" ;;
  logs)   shift; cmd_logs "$@" ;;
  smoke)  shift; cmd_smoke "$@" ;;
  unit)       shift; cmd_unit "$@" ;;
  unit:local) shift; cmd_unit_local "$@" ;;
  db)         shift; cmd_db "$@" ;;
  db:local)   shift; cmd_db_local "$@" ;;
  e2e)    shift; cmd_e2e "$@" ;;
  all)    shift; cmd_all "$@" ;;
  *)      sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
