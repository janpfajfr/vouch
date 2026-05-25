#!/bin/sh
# Copy to .git/hooks/pre-commit and chmod +x.
# Fails the commit if any dependency lacks a ledger entry.
npx you-shall-not-add check || {
  echo "you-shall-not-add: unreviewed dependency. Use safe-add, or add an approval."
  exit 1
}
