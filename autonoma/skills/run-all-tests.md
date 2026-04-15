---
name: Run All Tests
description: Execute every enabled Jest suite in one run and review the consolidated markdown report.
---

# Skill: Run All Tests

## What this does
Runs every Jest suite (whose `RUN_*_TESTS` flag is true) in a single invocation and regenerates `test-results.md` at the end.

## Starting point
- Terminal in the repo root
- `.env` has `BUBBLE_API_BASE` and `BUBBLE_API_TOKEN`
- At least one `RUN_*_TESTS` flag is true in `testConfig.js` with its IDs populated

## Steps
1. Confirm the flags you want to run are set to `true` in `testConfig.js`.
2. Confirm the IDs referenced by each enabled suite are populated.
3. Run `npm test` in the terminal.
4. Wait for Jest to finish all suites.
5. Open `test-results.md`.
6. Review each describe block for pass/fail counts.

## You'll know it worked when
- Jest prints an overall summary with `Test Suites: N passed, N total`
- `test-results.md` contains sections for every enabled suite with per-test tables of calculated vs stored values

## Variations
- Set `RUN_ORDER_TESTS`, `RUN_REPORTING_DAILY_TESTS`, or `RUN_REFUND_TESTS` to `false` to skip individual suites.
- Use `npm run test:watch` to re-run on file changes.

## Notes
- The report is overwritten on every run (it's gitignored).
- Failures in `beforeAll` cascade — every test in that suite is marked failed.
