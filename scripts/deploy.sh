#!/usr/bin/env bash
# ================================================================
# AETHER_STUDIO — Deployment Pipeline
#
# Usage:
#   ./scripts/deploy.sh dev        → push to dev branch (staging)
#   ./scripts/deploy.sh prod       → promote dev → main (production)
#   ./scripts/deploy.sh both       → push dev, then promote to prod
#
# Flow:
#   1. Run test suite
#   2. If tests pass → push to target branch(es)
#   3. GitHub Pages serves main automatically
# ================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/scripts"
GITHUB_TOKEN="${GITHUB_ACCESS_TOKEN:-}"
REPO="SMOdevWork/aether-studio"
BASE="https://api.github.com"

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[0;33m'
CYN='\033[0;36m'
BLD='\033[1m'
NC='\033[0m'

TARGET="${1:-dev}"

echo -e "\n${CYN}${BLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYN}${BLD}  AETHER_STUDIO DEPLOYMENT PIPELINE${NC}"
echo -e "${CYN}${BLD}  Target: ${YLW}${TARGET^^}${NC}"
echo -e "${CYN}${BLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# ── Step 1: Tests ──
echo -e "${YLW}▶ Running test suite...${NC}"
if ! bash "$SCRIPTS/test.sh"; then
  echo -e "${RED}${BLD}✗ DEPLOYMENT ABORTED — tests failed${NC}\n"
  exit 1
fi
echo -e "${GRN}✓ Tests passed${NC}\n"

# ── Step 2: Push files via GitHub API ──
push_to_branch() {
  local BRANCH="$1"
  local COMMIT_MSG="$2"
  echo -e "${YLW}▶ Pushing to branch: ${BLD}${BRANCH}${NC}"

  python3 << PYEOF
import base64, json, subprocess, os, sys

TOKEN  = os.environ.get('GITHUB_ACCESS_TOKEN', '')
REPO   = '$REPO'
BASE   = '$BASE'
BRANCH = '$BRANCH'
MSG    = '$COMMIT_MSG'
PUBLIC = '$ROOT/public'

files = {
    'index.html': f'{PUBLIC}/index.html',
    'style.css':  f'{PUBLIC}/style.css',
    'engine.js':  f'{PUBLIC}/engine.js',
}

def api(method, path, data=None):
    cmd = ['curl','-s','-X', method,
           '-H', f'Authorization: Bearer {TOKEN}',
           '-H', 'Content-Type: application/json',
           f'{BASE}{path}']
    if data: cmd += ['-d', json.dumps(data)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(r.stdout)

def get_sha(path):
    r = api('GET', f'/repos/{REPO}/contents/{path}?ref={BRANCH}')
    return r.get('sha')

errors = 0
for fname, fpath in files.items():
    with open(fpath,'rb') as f:
        content = base64.b64encode(f.read()).decode()
    sha = get_sha(fname)
    payload = {'message': MSG, 'content': content, 'branch': BRANCH}
    if sha: payload['sha'] = sha
    res = api('PUT', f'/repos/{REPO}/contents/{fname}', payload)
    if 'content' in res:
        print(f'  ✓ {fname}')
    else:
        print(f'  ✗ {fname}: {res.get("message","unknown")}')
        errors += 1

sys.exit(errors)
PYEOF

  [ $? -eq 0 ] \
    && echo -e "${GRN}✓ Pushed to ${BRANCH}${NC}\n" \
    || { echo -e "${RED}✗ Push to ${BRANCH} failed${NC}\n"; exit 1; }
}

# ── Step 3: Promote dev → main (merge via API) ──
promote_to_prod() {
  echo -e "${YLW}▶ Promoting dev → main (production)...${NC}"

  python3 << PYEOF
import json, subprocess, os, sys

TOKEN = os.environ.get('GITHUB_ACCESS_TOKEN', '')
REPO  = '$REPO'
BASE  = '$BASE'

def api(method, path, data=None):
    cmd = ['curl','-s','-X', method,
           '-H', f'Authorization: Bearer {TOKEN}',
           '-H', 'Content-Type: application/json',
           f'{BASE}{path}']
    if data: cmd += ['-d', json.dumps(data)]
    return json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout)

# Get dev SHA
dev = api('GET', f'/repos/{REPO}/git/refs/heads/dev')
dev_sha = dev['object']['sha']

# Fast-forward main to dev SHA
res = api('PATCH', f'/repos/{REPO}/git/refs/heads/main', {
    'sha': dev_sha, 'force': False
})

if res.get('object', {}).get('sha') == dev_sha:
    print(f'  ✓ main promoted to {dev_sha[:8]}')
elif 'message' in res:
    # If fast-forward fails (diverged), create a merge commit instead
    print(f'  → Fast-forward failed ({res["message"]}), attempting merge...')
    merge = api('POST', f'/repos/{REPO}/merges', {
        'base': 'main', 'head': 'dev',
        'commit_message': 'chore: promote dev → main [production deploy]'
    })
    if merge.get('sha'):
        print(f'  ✓ Merged to main: {merge["sha"][:8]}')
    else:
        print(f'  ✗ Merge failed: {merge}')
        sys.exit(1)
PYEOF

  [ $? -eq 0 ] \
    && echo -e "${GRN}✓ Production promoted${NC}\n" \
    || { echo -e "${RED}✗ Promotion failed${NC}\n"; exit 1; }
}

# ── Execute target ──
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

case "$TARGET" in
  dev)
    push_to_branch "dev" "chore(dev): update staging [$TIMESTAMP]"
    echo -e "${GRN}${BLD}▶ STAGING DEPLOYED${NC}"
    echo -e "  Branch: dev — review before promoting to prod\n"
    ;;
  prod)
    promote_to_prod
    echo -e "${GRN}${BLD}▶ PRODUCTION DEPLOYED${NC}"
    echo -e "  URL: https://smodevwork.github.io/aether-studio/\n"
    ;;
  both)
    push_to_branch "dev" "feat: update build [$TIMESTAMP]"
    promote_to_prod
    echo -e "${GRN}${BLD}▶ FULL DEPLOY COMPLETE${NC}"
    echo -e "  Staging (dev) + Production (main) both updated"
    echo -e "  URL: https://smodevwork.github.io/aether-studio/\n"
    ;;
  *)
    echo -e "${RED}Unknown target: $TARGET. Use: dev | prod | both${NC}\n"
    exit 1
    ;;
esac
