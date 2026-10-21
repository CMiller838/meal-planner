#!/usr/bin/env bash
# Redeploy after a commit (run by tools/githooks/post-commit in the background): publish main so GitHub Pages
# rebuilds, redeploy the Cloudflare Worker when it or a module it bundles changed, then confirm the live site serves
# the new service-worker cache name. The last output line is the result (the hook sends it to Telegram).
set -uo pipefail
cd "$(dirname "$0")/.."
[ "$(git branch --show-current)" = main ] || { echo "not on main: not deploying"; exit 0; }
SITE=https://cmiller838.github.io/meal-planner
WORKER_FILES='^(worker/|(exclusions|day-hints|data|shelf-life|shopping-list|mealdb|nutrition|generator)\.js$|(substitutions|ingredient-nutrient-tags|nutrition-targets|plan-preferences|pack-sizes)\.json$)'

cache=$(grep -o 'meal-planner-v[0-9]*' sw.js | head -1)
changed=$(git diff --name-only origin/main..HEAD)
git push origin main 2>&1 | tail -1
[ "${PIPESTATUS[0]}" = 0 ] || { echo "DEPLOY FAILED: git push"; exit 1; }

msg="pushed"
if grep -qE "$WORKER_FILES" <<<"$changed"; then
    if (cd worker && npx --yes wrangler deploy 2>&1 | tail -3); then msg="$msg, worker redeployed"; else echo "DEPLOY FAILED: wrangler deploy"; exit 1; fi
fi
for _ in $(seq 1 24); do   # Pages takes a minute or two
    curl -fsS "$SITE/sw.js?$(date +%s)" 2>/dev/null | grep -q "$cache" && { echo "deployed ($msg): $SITE serves $cache"; exit 0; }
    sleep 10
done
echo "DEPLOY UNCONFIRMED ($msg): $SITE still not serving $cache after 4 min"; exit 1
