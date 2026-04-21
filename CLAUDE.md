# CLAUDE.md

Guidance for Claude Code working in this repo.

## Commands

```bash
npm install                         # Install dependencies
npm test                            # Run all enabled suites (writes test-results.md at repo root)
npm test -- tests/order.test.js     # Run only the single-order suite
npm test -- e2e-gp-testing/tests/e2eOrder.test.js   # Run the 20-order E2E suite
npm run test:watch                  # Watch mode
```

## Architecture

Jest-based validation framework for the 8count Bubble app. Test files fetch data from the Bubble Data API via `config/bubbleClient.js`, run pure calculations from `lib/`, and assert that the calculator output matches what Bubble stored.

### Key files

| File | Role |
|------|------|
| `testConfig.js` | Per-suite flags (`RUN_*_TESTS`), order IDs, Bubble `TYPES` map |
| `config/bubbleClient.js` | `getThing(type, id)` and `searchThings(type, constraints)` |
| `config/testResultsLogger.js` | Call `step(description, details)` inside `it()` blocks; rows land in the per-order table |
| `config/jestMarkdownReporter.js` | Writes `test-results.md` — Overview + Per-Order Results + Aggregate + Failures |
| `lib/testUtils.js` | `getNum(obj, ...keys)` and `roundTo2(num)` |
| `lib/orderCalculator.js` | Pure order calculation (gross → discount → custom fees → processing) |
| `lib/refundCalculator.js` | Refund aggregation |

### Test suites

| Suite | File | What it validates |
|-------|------|-------------------|
| Single-order | `tests/order.test.js` | 15 assertions against `ORDER_ID` in `testConfig.js` |
| Reporting daily | `tests/reportingDaily.test.js` | 24 assertions across daily aggregate records |
| Refund | `tests/refund.test.js` | 13 assertions against `REFUND_ORDER_ID` |
| E2E permutation | `e2e-gp-testing/tests/e2eOrder.test.js` | 42 assertions over the 20-order state in `e2e-gp-testing/e2e-state.json` |

The E2E suite is driven by the orchestration documented in `e2e-gp-testing/PLAN-v1.md` + `runbook.md`: Claude sub-agents create an event, run 20 permuted purchases, then the Jest file validates every resulting order.

### Jest execution order (critical)

The `describe` callback runs **when the file loads**, before `beforeAll`. Never branch on fetched data at describe-definition time.

**Wrong:** `if (items.length === 0)` inside `describe`.

**Right:** throw in `beforeAll` if the fetched list is empty, iterate inside `it()` callbacks.

When `beforeAll` throws, Jest marks every test in the suite as failed with the setup error — no separate guard `it` needed.

### Bubble Data API naming

Type names in `TYPES` are the Bubble editor display name, lowercased with spaces removed (e.g. "Order Item" → `orderitem`). Buildprint MCP internal schema keys (e.g. `cart_items`) are **not** the same as Data API type names — don't confuse them.

### Buildprint MCP for verification

When verifying Bubble app details (option set values, field names, data type schemas, record data), use Buildprint MCP tools:
- `get_json` / `search_json` — explore schema, option sets, workflows
- `fetch_data` — fetch records by ID
- `search_data` — search with constraints

**appId:** `k-8count` | **version:** `81rkv`

### Environment

Copy `.env.example` to `.env` and set:
- `BUBBLE_API_BASE` — e.g. `https://8countlogin.com/api/1.1/obj`
- `BUBBLE_API_TOKEN` — your Bubble API token

### Test output

`test-results.md` (at repo root for `tests/` suites, at `e2e-gp-testing/test-results.md` for the E2E suite) is overwritten on every run. Sections: Overview, Per-Order Results (one table per orderId), Aggregate Results, Failures.
