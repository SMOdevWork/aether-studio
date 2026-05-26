#!/usr/bin/env bash
# AETHER_STUDIO — Pre-deployment Test Suite
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC="$ROOT/public"

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[0;33m'; CYN='\033[0;36m'; NC='\033[0m'
PASS=0; FAIL=0

ok()   { echo -e "  ${GRN}✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }

echo -e "\n${CYN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYN}  AETHER_STUDIO TEST SUITE${NC}"
echo -e "${CYN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

echo -e "${YLW}[1] File checks${NC}"
for f in index.html style.css engine.js; do
  if [ -f "$PUBLIC/$f" ]; then ok "$f exists"; else fail "$f MISSING"; fi
done

echo -e "\n${YLW}[2] File size checks${NC}"
for f in index.html style.css engine.js; do
  SIZE=$(wc -c < "$PUBLIC/$f" 2>/dev/null || echo 0)
  if [ "$SIZE" -gt 500 ]; then ok "$f size OK (${SIZE}B)"; else fail "$f too small (${SIZE}B)"; fi
done

echo -e "\n${YLW}[3] JS syntax${NC}"
if node --check "$PUBLIC/engine.js" 2>/dev/null; then
  ok "engine.js syntax valid"
else
  fail "engine.js has syntax errors"
fi

echo -e "\n${YLW}[4] HTML element checks${NC}"
for id in viewport webcam tracking-canvas hud notification toolbar controls-bottom; do
  if grep -q "id=\"$id\"" "$PUBLIC/index.html" 2>/dev/null; then
    ok "#$id present"
  else
    fail "#$id MISSING"
  fi
done

echo -e "\n${YLW}[5] CDN dependency checks${NC}"
for lib in "three.min.js" "OrbitControls.js" "mediapipe/hands"; do
  if grep -q "$lib" "$PUBLIC/index.html" 2>/dev/null; then
    ok "$lib referenced"
  else
    fail "$lib MISSING"
  fi
done

echo -e "\n${YLW}[6] Engine module checks${NC}"
for mod in ViewportEngine CursorEngine DrawEngine TelemetryEngine ConstraintLayer ExportEngine HUD SceneManager; do
  if grep -q "const $mod" "$PUBLIC/engine.js" 2>/dev/null; then
    ok "$mod present"
  else
    fail "$mod MISSING"
  fi
done

echo -e "\n${YLW}[7] Code quality${NC}"
if grep -q "debugger" "$PUBLIC/engine.js" 2>/dev/null; then
  fail "debugger statement found"
else
  ok "No debugger statements"
fi

echo -e "\n${CYN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${GRN}${PASS} passed${NC} / ${RED}${FAIL} failed${NC}"
echo -e "${CYN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

if [ "$FAIL" -eq 0 ]; then
  echo -e "${GRN}  ALL TESTS PASSED — safe to deploy${NC}\n"
  exit 0
else
  echo -e "${RED}  TESTS FAILED — deployment blocked${NC}\n"
  exit 1
fi
