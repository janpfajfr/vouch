#!/usr/bin/env bash
# Hidden setup for assets/demo.tape — sourced (not executed) so the `vouch`
# function and the cd into a throwaway project persist in VHS's shell.
# Run `npm run build` first; this drives the locally-built dist/.
REPO="$PWD"
vouch() { node "$REPO/dist/src/cli.js" "$@"; }
cd "$(mktemp -d)" || return
# A throwaway git identity so the recorded `addedBy` is a demo persona, never
# the real (global) git config — the demo GIF is public.
git init -q
git config user.name "Ada Lovelace"
git config user.email "ada@example.com"
printf '{"name":"my-app","version":"1.0.0"}\n' > package.json
printf '{"packageManager":"npm"}\n' > .safe-dep.json
PS1='$ '
clear
