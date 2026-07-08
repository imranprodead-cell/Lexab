#!/usr/bin/env bash
# End-to-end smoke test against a running server (default http://localhost:8080/api).
set -euo pipefail

BASE="${BASE:-http://localhost:8080/api}"
PASS="${SEED_DEMO_PASSWORD:-lexai-demo}"
fail() { echo "✗ $1" >&2; exit 1; }
ok() { echo "✓ $1"; }

json() { curl -sf -H 'Content-Type: application/json' "$@"; }

json "$BASE/health" | grep -q '"ok":true' || fail "health"
ok "health"

TOKEN=$(json -X POST -d "{\"email\":\"a.rahman@freshfields.com\",\"password\":\"$PASS\"}" "$BASE/auth/login" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).token))')
[ -n "$TOKEN" ] || fail "login returned no token"
ok "auth/login"
AUTH=(-H "Authorization: Bearer $TOKEN")

json "${AUTH[@]}" "$BASE/me" | grep -q '"email"' || fail "me"
ok "me"

json "${AUTH[@]}" "$BASE/chats" | grep -q '"c1"' || fail "chats"
ok "chats"

json "${AUTH[@]}" "$BASE/chats/c1/messages" | grep -q '"analysisId"' || fail "chat messages"
ok "chats/:id/messages"

json "${AUTH[@]}" "$BASE/analysis/an_employment_v3" | grep -q '"riskScore":62' || fail "analysis get"
ok "analysis/:id"

json "${AUTH[@]}" -X PATCH -d '{"status":"accepted"}' "$BASE/analysis/an_employment_v3/redlines/r1" | grep -q '"accepted"' || fail "redline patch"
ok "analysis redline PATCH"

json "${AUTH[@]}" -X POST -d '{"fileName":"Smoke_NDA.docx","fileSize":"20 KB"}' "$BASE/analysis" | grep -q '"redlines"' || fail "analysis post"
ok "analysis POST"

json "${AUTH[@]}" "$BASE/documents?search=&status=All&risk=All" | grep -q '"d1"' || fail "documents"
ok "documents"

json "${AUTH[@]}" "$BASE/documents/d1/versions" | grep -q 'v3' || fail "versions"
ok "documents versions"

json "${AUTH[@]}" "$BASE/templates?category=Commercial" | grep -q 'Master Services' || fail "templates"
ok "templates"

json "${AUTH[@]}" -X POST -d '{"documentName":"Smoke.docx","recipients":[{"name":"T","email":"t@t.co"}]}' "$BASE/signatures" | grep -q '"Sent"' || fail "signatures post"
ok "signatures"

json "${AUTH[@]}" "$BASE/analytics/summary" | grep -q '"reviewsByWeek"' || fail "analytics"
ok "analytics"

json "${AUTH[@]}" "$BASE/notifications" | grep -q '"icon"' || fail "notifications"
ok "notifications"

json "${AUTH[@]}" "$BASE/billing/subscription" | grep -q '"plan"' || fail "billing"
ok "billing"

json "${AUTH[@]}" "$BASE/team/members" | grep -q 'team.role.owner' || fail "team"
ok "team"

echo "All smoke checks passed."
