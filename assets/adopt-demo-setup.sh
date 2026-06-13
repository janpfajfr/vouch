#!/usr/bin/env bash
# Hidden setup for assets/adopt-demo.tape — sourced (not executed) so the `vouch`
# function and the cd into a throwaway monorepo persist in VHS's shell.
# Run `npm run build` first; this drives the locally-built dist/.
#
# Builds a small, realistic npm-workspaces monorepo with a couple dozen ALREADY
# INSTALLED dependencies — the "existing repo" `vouch adopt` is meant to onboard.
# Versions are pinned to currently-clean releases so the post-adopt `vouch check`
# goes green; the high-risk count comes from install-time scripts (core-js et al.),
# which adopt records with a blanket reason so `check` still passes. If a re-render
# ever shows `check` failing on an advisory, a pinned version gained a CVE — bump it.
REPO="$PWD"
vouch() { node "$REPO/dist/src/cli.js" "$@"; }
cd "$(mktemp -d)" || return

# Throwaway git identity so the recorded `addedBy` is a demo persona, never the
# real (global) git config — the demo GIF is public.
git init -q
git config user.name "Ada Lovelace"
git config user.email "ada@example.com"

# Root workspace manifest + three packages, like a real product monorepo.
cat > package.json <<'JSON'
{ "name": "acme-platform", "private": true, "version": "1.0.0", "workspaces": ["packages/*"] }
JSON
mkdir -p packages/web packages/api packages/shared

cat > packages/web/package.json <<'JSON'
{ "name": "@acme/web", "version": "1.0.0",
  "dependencies": {
    "react": "18.3.1", "react-dom": "18.3.1", "zustand": "4.5.5",
    "clsx": "2.1.1", "date-fns": "3.6.0", "chalk": "5.4.1"
  },
  "devDependencies": { "typescript": "5.7.2" } }
JSON

cat > packages/api/package.json <<'JSON'
{ "name": "@acme/api", "version": "1.0.0",
  "dependencies": {
    "express": "4.21.2", "cors": "2.8.5", "helmet": "8.0.0",
    "dotenv": "16.4.7", "pino": "9.5.0", "jsonwebtoken": "9.0.2",
    "core-js": "3.39.0"
  } }
JSON

cat > packages/shared/package.json <<'JSON'
{ "name": "@acme/shared", "version": "1.0.0",
  "dependencies": {
    "zod": "3.23.8", "commander": "12.1.0", "semver": "7.6.3",
    "nanoid": "5.0.9", "dayjs": "1.11.13", "picocolors": "1.1.1"
  } }
JSON

# No vouch config yet — `vouch init` writes one live in the recording (beat 0).
printf 'node_modules/\n' > .gitignore

# Install everything so node_modules exists — this is the "existing repo" state
# adopt reads from. Hidden, so the wait never shows in the recording.
npm install --no-audit --no-fund >/dev/null 2>&1

PS1='$ '
clear
