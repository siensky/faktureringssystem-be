#!/usr/bin/env bash
# Kör tsc --noEmit i varje TS-workspace. Bun har ingen inbyggd
# "typecheck alla workspaces"-kommando, så vi loopar över dem explicit.
# Varje paket har composite:false i sin tsconfig eftersom vi inte bygger
# någon dist — bara typkontrollerar källan direkt.
set -euo pipefail
cd "$(dirname "$0")/.."

status=0
for dir in packages/shared packages/contracts services/auth services/billing services/payments apps/backoffice apps/portal; do
  if [ -f "$dir/tsconfig.json" ]; then
    echo "→ typecheck: $dir"
    if ! bunx tsc --noEmit -p "$dir"; then
      status=1
    fi
  fi
done

exit $status
