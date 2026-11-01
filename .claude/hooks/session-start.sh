#!/bin/bash
# Install workspace dependencies so cloud sessions can typecheck and test.
# Package builds are not done here: each npm script builds what it needs.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Run the install only if a listed file has changed since it last succeeded.
hashes=node_modules/.session-start.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  # Delete the old hashes first, so a failed install runs again next time.
  rm -f "$hashes"

  # npm ci never rewrites package-lock.json, so agent diffs stay free of lockfile churn.
  npm ci --no-audit --no-fund

  # This script and every manifest that decides what gets installed.
  sha256sum .claude/hooks/session-start.sh package.json package-lock.json \
    packages/*/package.json apps/*/package.json > "$hashes" || rm -f "$hashes"
fi
