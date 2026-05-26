#!/bin/sh
# Copy to .git/hooks/pre-push and chmod +x.
npx vouch check || exit 1
