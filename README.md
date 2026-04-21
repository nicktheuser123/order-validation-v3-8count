# 8count Order Validation

Jest suite that validates 8count GP portal orders against their stored Bubble Data API values.

## Prerequisites

- Node.js ≥ 14

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Environment variables**
   - Copy `.env.example` to `.env`
   - Set `BUBBLE_API_BASE` and `BUBBLE_API_TOKEN`

3. **Set the order to validate** — edit `testConfig.js`, set `ORDER_ID` to a real GP_Order ID, toggle `RUN_*_TESTS` flags for the suites you want.

4. **Run**
   ```bash
   npm test                                        # all enabled suites
   npm test -- tests/order.test.js                 # single-order suite only
   npm test -- e2e-gp-testing/tests/e2eOrder.test.js   # 20-order E2E suite
   ```

   Results land in `test-results.md` (repo root) or `e2e-gp-testing/test-results.md` (E2E suite). Format: Overview + per-order tables + aggregate + failures.

## Layout

```
config/           Jest setup, Bubble client, markdown reporter
lib/              Pure calculators (orderCalculator, refundCalculator, testUtils)
tests/            Single-order / refund / reporting-daily suites
e2e-gp-testing/   20-order permutation pipeline (plan, runbook, state, tests)
testConfig.js     IDs, flags, Bubble type names
CLAUDE.md         Architecture notes for Claude Code
```

See [CLAUDE.md](CLAUDE.md) for architecture details. The E2E pipeline is specced in [`e2e-gp-testing/PLAN-v1.md`](e2e-gp-testing/PLAN-v1.md) and driven by [`e2e-gp-testing/runbook.md`](e2e-gp-testing/runbook.md).
