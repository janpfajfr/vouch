#!/bin/sh
# Copy to .git/hooks/pre-commit and chmod +x.
# Fails the commit if any dependency lacks a ledger entry.
npx vouch check || {
  echo "vouch: unreviewed dependency. Use vouch <pkg>, or add an approval."
  exit 1
}
