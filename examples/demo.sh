#!/bin/sh
# Live, end-to-end demo of you-shall-not-add against the real npm registry.
#
#   ./examples/demo.sh
#
# Builds the CLI from this repo, then runs five scenarios in a throwaway project:
#   1. a safe package installs (and the alternatives engine nudges you)
#   2. a package with an install script is BLOCKED
#   3. check passes when every dependency is in the ledger
#   4. a raw `npm install` bypass is CAUGHT by check
#   5. --force-with-reason records a reason but check still fails without approvedBy
#
# Requires: node 18+, npm, and network access. Nothing is installed outside the
# temporary directory, which is removed on exit.

set -u

REPO=$(cd "$(dirname "$0")/.." && pwd)
CLI="$REPO/dist/src/cli.js"

echo "== building the CLI =="
( cd "$REPO" && npm run build >/dev/null ) || { echo "build failed"; exit 1; }

DEMO=$(mktemp -d)
trap 'rm -rf "$DEMO"' EXIT
echo "== demo project: $DEMO =="
echo '{"name":"demo","version":"1.0.0"}' > "$DEMO/package.json"
echo '{"packageManager":"npm"}'          > "$DEMO/.safe-dep.json"
cd "$DEMO"

run() { echo; echo "\$ safe-add $*"; node "$CLI" "$@"; echo "  exit: $?"; }

echo
echo "########## 1) safe-add left-pad — alternatives nudge, then allow + install ##########"
run left-pad --quiet

echo
echo "---------- ledger entry written ----------"
cat .security/dependency-approvals.json

echo
echo "########## 2) safe-add esbuild — has a postinstall script, expect BLOCK ##########"
run esbuild --quiet

echo
echo "########## 3) check — expect PASS (left-pad is in the ledger) ##########"
echo "\$ check"; node "$CLI" check --quiet; echo "  exit: $?"

echo
echo "########## 4) BYPASS: raw 'npm install ms', then check catches it ##########"
npm install ms --no-audit --no-fund >/dev/null 2>&1 && echo "installed 'ms' via raw npm (no ledger entry)"
echo "\$ check"; node "$CLI" check --quiet; echo "  exit: $?"

echo
echo "########## 5) --force-with-reason: reason is attribution, not authorization ##########"
run esbuild --quiet --force-with-reason "demo: needed for build"
echo "\$ check  (high-risk entry has a reason but no approvedBy)"
node "$CLI" check --quiet; echo "  exit: $?"

echo
echo "== done. The forced entry was recorded and attributed, but check still fails =="
echo "== until a human adds approvedBy: the bypass is impossible to hide. =="
