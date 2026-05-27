#!/bin/sh
# Copy to .git/hooks/pre-commit and chmod +x.
# Fails the commit if any dependency lacks a ledger entry.
npx vouch check || {
  echo "vouch: unrecorded dependency. Record it with: vouch <pkg>"
  exit 1
}
