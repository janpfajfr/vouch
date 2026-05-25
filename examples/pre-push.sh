#!/bin/sh
# Copy to .git/hooks/pre-push and chmod +x.
npx you-shall-not-add check || exit 1
