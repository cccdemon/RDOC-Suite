#!/usr/bin/env bash
# RDOC-Suite Integration Test Suite
# Runs against live services — safe (read-only, no state changes).
#
# Usage (local):  bash scripts/test-integration.sh
# Usage (server): pct exec 103 -- bash /opt/RDOC-Suite/scripts/test-integration.sh
#
# Reads .env from /opt/RDOC-Suite/.env if present (server mode).

set -euo pipefail

SUITE_URL="${SUITE_URL:-https://suite.raumdock.org}"
VOICE_URL="${VOICE_URL:-https://voice.raumdock.org}"
TEST_GUILD_ID="${TEST_GUILD_ID:-1431307397842079777}"
[ -n "${RELAY_GUILD_ID:-}" ] && TEST_GUILD_ID="${RELAY_GUILD_ID}"
TEST_GUILD_ID="${TEST_GUILD_ID:-1431307397842079777}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
PASS=0; FAIL=0; SKIP=0

pass() { echo -e "  ${GREEN}✓${NC} $1"; ((PASS++)); }
fail() { echo -e "  ${RED}✗${NC} $1"; ((FAIL++)); }
skip() { echo -e "  ${YELLOW}–${NC} $1 (skipped)"; ((SKIP++)); }
section() { echo -e "\n${CYAN}▶ $1${NC}"; }

http_code() { curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$1"; }
http_body() { curl -s --max-time 10 "$1"; }

# ── Load .env on server ────────────────────────────────────────────────
[ -f /opt/RDOC-Suite/.env ] && set -a && source /opt/RDOC-Suite/.env && set +a 2>/dev/null || true

# ── 1. Container status (server only) ─────────────────────────────────
section "Container Status"
if command -v docker &>/dev/null; then
  for c in rdoc-suite-bridge rdoc-suite-bot rdoc-suite-livekit rdoc-suite-fleetplanner rdoc-suite-caddy; do
    status=$(docker inspect --format='{{.State.Status}}' "$c" 2>/dev/null || echo "missing")
    restarts=$(docker inspect --format='{{.RestartCount}}' "$c" 2>/dev/null || echo "?")
    if [ "$status" = "running" ] && [ "$restarts" -lt 3 ] 2>/dev/null; then
      pass "$c running (restarts: $restarts)"
    elif [ "$status" = "running" ]; then
      fail "$c running but $restarts restarts — check logs"
    else
      fail "$c not running (status: $status)"
    fi
  done
else
  skip "docker not available"
fi

# ── 2. HTTP endpoints ──────────────────────────────────────────────────
section "HTTP Endpoints"

code=$(http_code "$SUITE_URL/health")
body=$(http_body "$SUITE_URL/health")
if [ "$code" = "200" ] && echo "$body" | grep -q '"ok":true'; then
  pass "Bridge health → $body"
else
  fail "Bridge health HTTP $code: $body"
fi

code=$(http_code "$SUITE_URL/fleetplanner")
[ "$code" = "200" ] || [ "$code" = "302" ] && pass "Fleetplanner ($code)" || fail "Fleetplanner HTTP $code"

code=$(http_code "$SUITE_URL/monitoring")
[ "$code" = "200" ] || [ "$code" = "302" ] && pass "Grafana monitoring ($code)" || fail "Grafana HTTP $code"

body=$(http_body "$VOICE_URL")
echo "$body" | grep -qi "ok\|livekit" && pass "LiveKit signaling ($VOICE_URL)" || fail "LiveKit: got '$body'"

code=$(http_code "$SUITE_URL/downloads/")
[ "$code" = "200" ] || [ "$code" = "403" ] || [ "$code" = "404" ] && pass "Downloads endpoint ($code)" || fail "Downloads HTTP $code"

# ── 3. Bridge API ──────────────────────────────────────────────────────
section "Bridge API"

body=$(http_body "$SUITE_URL/auth/start" 2>/dev/null || echo "")
# Should redirect to Discord OAuth
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 --max-redirs 0 "$SUITE_URL/auth/start?guildId=$TEST_GUILD_ID")
[ "$code" = "302" ] || [ "$code" = "200" ] && pass "Bridge OAuth start ($code)" || fail "Bridge OAuth start HTTP $code"

# ── 4. Discord Bot ─────────────────────────────────────────────────────
section "Discord API"

if [ -n "${DISCORD_RDOCRTC_BOT_TOKEN:-}" ]; then
  resp=$(curl -s -H "Authorization: Bot $DISCORD_RDOCRTC_BOT_TOKEN" \
    "https://discord.com/api/v10/users/@me" --max-time 10)
  if echo "$resp" | grep -q '"username"'; then
    username=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('username','?'))" 2>/dev/null || echo "?")
    pass "RDOC-RTC Bot online: @$username"
  else
    fail "RDOC-RTC Bot auth failed: $resp"
  fi
else
  skip "DISCORD_RDOCRTC_BOT_TOKEN not set"
fi

if [ -n "${DISCORD_FLEETPLANNER_BOT_TOKEN:-}" ]; then
  resp=$(curl -s -H "Authorization: Bot $DISCORD_FLEETPLANNER_BOT_TOKEN" \
    "https://discord.com/api/v10/users/@me" --max-time 10)
  echo "$resp" | grep -q '"username"' && pass "Fleetmanager Bot online" || fail "Fleetmanager Bot auth failed"
else
  skip "DISCORD_FLEETPLANNER_BOT_TOKEN not set"
fi

# ── 5. Fleetplanner API ────────────────────────────────────────────────
section "Fleetplanner API"

resp=$(http_body "$SUITE_URL/fleetplanner/api/ships?q=Polaris")
if echo "$resp" | grep -q '\['; then
  count=$(echo "$resp" | grep -o '"id"' | wc -l)
  pass "Ship search returns $count results"
else
  fail "Ship search failed: $resp"
fi

# ── 6. WebSocket ───────────────────────────────────────────────────────
section "WebSocket (Bridge)"

if command -v node &>/dev/null && node -e "require('ws')" 2>/dev/null; then
  result=$(node -e "
const WebSocket = require('ws');
const suiteUrl = new URL(process.env.SUITE_URL || '$SUITE_URL');
suiteUrl.protocol = suiteUrl.protocol === 'https:' ? 'wss:' : 'ws:';
suiteUrl.pathname = '/ws';
suiteUrl.search = '?token=invalid_test_token';
const ws = new WebSocket(suiteUrl.toString());
ws.on('close', (code) => {
  if (code === 4401 || code === 4400) process.stdout.write('AUTH_REJECT');
  else process.stdout.write('CODE:' + code);
  process.exit(0);
});
ws.on('error', (e) => { process.stdout.write('ERR:' + e.message); process.exit(0); });
setTimeout(() => { process.stdout.write('TIMEOUT'); process.exit(0); }, 6000);
" 2>/dev/null)
  case "$result" in
    AUTH_REJECT) pass "WebSocket endpoint up (auth rejection working: 4401)" ;;
    TIMEOUT)     fail "WebSocket timeout — endpoint unreachable?" ;;
    *)           fail "WebSocket: $result" ;;
  esac
else
  skip "ws module not available (run: pnpm install in repo root first)"
fi

# ── 7. LiveKit API ────────────────────────────────────────────────────
section "LiveKit"

if [ -n "${LIVEKIT_API_KEY:-}" ] && [ -n "${LIVEKIT_API_SECRET:-}" ]; then
  # Check LiveKit Room API (local port on server only)
  if command -v curl &>/dev/null && curl -s http://127.0.0.1:7880 &>/dev/null; then
    pass "LiveKit admin port 7880 reachable (server)"
  else
    skip "LiveKit admin port only accessible on server"
  fi
else
  skip "LIVEKIT_API_KEY/SECRET not set"
fi

# ── Summary ────────────────────────────────────────────────────────────
echo -e "\n${CYAN}════════════════════════════════${NC}"
echo -e " ${GREEN}✓ $PASS passed${NC}  ${RED}✗ $FAIL failed${NC}  ${YELLOW}– $SKIP skipped${NC}"
echo -e "${CYAN}════════════════════════════════${NC}\n"

[ $FAIL -eq 0 ] && exit 0 || exit 1
