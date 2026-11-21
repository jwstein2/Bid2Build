#!/usr/bin/env bash
# Runs every flow in dependency order against the local stack (see README). Usage: QA_OUT=/tmp/qa scripts/qa-audit/run-flows.sh
set -u
cd "$(dirname "$0")/../.."
export QA_STATE_TAG="${QA_STATE_TAG:-flows}"
run() { echo "== $*"; env "$@" 2>&1 | grep -E "^(PASS|FAIL|BLOCKED)|^\{" ; }
run node scripts/qa-audit/seed.mjs
run node scripts/qa-audit/flows/auth.mjs
run node scripts/qa-audit/flows/two-step.mjs
run node scripts/qa-audit/flows/admin-grants.mjs
run ROLE=free node scripts/qa-audit/flows/bids.mjs
run ROLE=pro node scripts/qa-audit/flows/bids.mjs
run ROLE=pro node scripts/qa-audit/flows/contractor-core.mjs
run ROLE=free node scripts/qa-audit/flows/contractor-core.mjs
run node scripts/qa-audit/flows/library.mjs
run node scripts/qa-audit/reset-sales.mjs
run node scripts/qa-audit/flows/sales-team.mjs
run node scripts/qa-audit/flows/sales-crm.mjs
run node scripts/qa-audit/flows/sales-pay.mjs
run node scripts/qa-audit/flows/sales-v8x.mjs
run node scripts/qa-audit/flows/enterprise.mjs
run ROLE=pro node scripts/qa-audit/flows/bids.mjs
run node scripts/qa-audit/flows/projects-financials.mjs
run node scripts/qa-audit/flows/pm.mjs
run ROLE=pro node scripts/qa-audit/flows/bids.mjs
run node scripts/qa-audit/flows/checkout.mjs
run node scripts/qa-audit/flows/esign-misc.mjs
run node scripts/qa-audit/flows/uploads.mjs
run node scripts/qa-audit/flows/db-guards.mjs
run node scripts/qa-audit/flows/today-systems.mjs
