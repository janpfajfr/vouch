#!/bin/sh
# Copy to .git/hooks/pre-push and chmod +x.
npx @vouchjs/vouch check || exit 1
