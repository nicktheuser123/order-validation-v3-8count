---
name: Run Order Validation
description: Execute the Order validation Jest suite against a specific ORDER_ID and inspect the markdown report.
---

# Skill: Run Order Validation

## What this does
Runs the Order validation Jest suite, which fetches a single GP_Order from the Bubble Data API, recomputes every derived field, and asserts the stored values match.

## Starting point
- Terminal open in the repo root
- `.env` has `BUBBLE_API_BASE` and `BUBBLE_API_TOKEN`
- `testConfig.js` has `RUN_ORDER_TESTS = true` and a non-empty `ORDER_ID`

## Steps
1. Open `testConfig.js` and confirm `ORDER_ID` points to the order you want to validate.
2. Confirm `RUN_ORDER_TESTS` is `true`.
3. Run `npm test -- order.test.js` in the terminal.
4. Wait for Jest to print PASS/FAIL summary.
5. Open `test-results.md` in the project root.
6. Assert that the "Order validation" describe block shows all 15 tests as passing.

## You'll know it worked when
- Jest prints `Tests: 15 passed` for `order.test.js`
- `test-results.md` contains a section titled "Order validation" with a table per assertion showing calculated vs stored values that match

## Variations
- To run without regenerating the report, use `npm run test:watch`.
- To validate multiple orders, populate `ORDER_IDS` in `testConfig.js` (not currently used by the suite but reserved for bulk validation).

## Notes
- If `ORDER_ID` is empty, `beforeAll` throws and every test in the suite is marked failed.
- Currency comparisons use `toBeCloseTo(expected, 2)`; exact integer counts use `toBe()`.
