#!/usr/bin/env bash
# Runs the crawler once per role against the mock backend. Needs `next start` on :3000 (built with the
# mock env, see scripts/pipeline/walk.mjs). Output: $1/<role>/results.json + screenshots.
set -u
OUT=${1:-audit}
EST=11111111-1111-4111-8111-111111111111
mock() { pkill -f mock-supabase; sleep 0.5; env "$@" nohup node scripts/ux-audit/mock-supabase.mjs > /tmp/mock.log 2>&1 &
  until curl -s localhost:54321 -o /dev/null; do sleep 0.3; done; curl -s "localhost:54321/__onboarding?status=completed" > /dev/null; }
run() { local role=$1; shift; echo "=== $role"; env ROLE=$role "$@" node scripts/platform-audit/crawl.mjs "$OUT/$role" 2>&1 | grep -v "^\[clicks\]" | tail -200 > "$OUT/$role.log"; tail -1 "$OUT/$role.log"; }
mkdir -p "$OUT"
ROLES=${ROLES:-"signed-out contractor enterprise-owner enterprise-estimator platform-owner"}
for r in $ROLES; do case $r in
  signed-out) mock MOCK_PIPELINE=1; run signed-out AUTH=0 SKIP_THEMES=1 MAX_PAGES=60 SEEDS="/,/pricing,/bids,/learn,/login,/trial,/bid-check,/start/siding,/company/join,/privacy,/terms,/dashboard,/admin,/estimates/$EST,/projects,/settings/billing,/nope-404" ONLY='^/(?!admin/|settings/|dashboard/|projects/|company/(?!join))' ;;
  contractor) mock MOCK_PIPELINE=1 MOCK_ESIGN_FIXTURE=/tmp/esign-fixture.json; run contractor MAX_PAGES=70 SEEDS="/dashboard,/estimates/$EST,/estimates/$EST?step=proposal,/projects,/settings/company,/settings/billing,/settings/account,/settings/pricing,/dashboard/customers,/dashboard/items,/dashboard/templates,/whats-new,/company,/admin,/learning,/mentorship" ONLY='^/(dashboard|estimates|projects|settings|whats-new|company|admin$|signed|learning|mentorship|builder|welcome)' ;;
  enterprise-owner) mock MOCK_SCENARIO=enterprise_owner MOCK_PIPELINE=1; run enterprise-owner SKIP_THEMES=1 MAX_PAGES=30 SEEDS="/company,/company/users,/company/pipeline,/company/billing,/company/proposal-style,/projects/team,/settings/billing" ONLY='^/(company|projects/team|settings/billing)' ;;
  enterprise-estimator) mock MOCK_SCENARIO=enterprise_estimator MOCK_PIPELINE=1; run enterprise-estimator SKIP_THEMES=1 CLICK=0 MAX_PAGES=20 SEEDS="/company,/company/users,/company/pipeline,/company/billing,/company/proposal-style,/projects/team,/admin" ONLY='^/(company|projects/team|admin$)' ;;
  platform-owner) mock MOCK_ADMIN=1 MOCK_COMMAND_CENTER=1; run platform-owner MAX_PAGES=70 MAX_CLICKS=30 SEEDS="/admin,/admin/customers,/admin/complimentary,/admin/revenue,/admin/revenue/scorecard,/admin/marketing,/admin/usage,/admin/operations,/admin/costs,/admin/costs/forecast,/admin/referrals,/admin/creators,/admin/market,/admin/flags,/admin/logs,/admin/audit,/admin/sales,/admin/states,/admin/templates,/admin/activity,/admin/data-quality,/admin/definitions,/admin/proposal-text,/admin/marketing/radar,/admin/marketing/facebook-trial" ONLY='^/admin' ;;
esac; done
