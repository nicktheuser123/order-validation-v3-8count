# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm test             # Run all tests (writes test-results.md)
npm test -- order.test.js   # Run a single test suite
npm run test:watch   # Watch mode
npm run record       # Launch Playwright codegen (saves to recordings/)
```

## Architecture

This is a Jest-based validation framework for Bubble (no-code) applications. It fetches data from the Bubble Data API and asserts that calculated fields match what the backend computed.

**Data flow:** Test file (`tests/`) fetches from Bubble via `bubbleClient` → passes raw data to a calculator (`lib/`) → asserts calculator output matches API field values.

### Key files

| File | Role |
|------|------|
| `testConfig.js` | Per-suite IDs, flags, and type names. Dynamically generated — add keys when adding suites. |
| `config/bubbleClient.js` | `getThing(type, id)` and `searchThings(type, constraints)`. Do not modify. |
| `config/testResultsLogger.js` | Call `step(description, details)` inside `it()` blocks to populate `test-results.md`. |
| `config/jestMarkdownReporter.js` | Custom Jest reporter; writes `test-results.md` on every run. |
| `lib/testUtils.js` | `getNum(obj, ...keys)` and `roundTo2(num)`. Do not remove. |
| `lib/parseBubbleUrl.js` | Derives `appId` and `version` from `BASE_URL` for Buildprint MCP. |

### Per-domain pattern

Each domain (e.g. `order`) has three files:
1. `testConfig.js` — `RUN_ORDER_TESTS`, `ORDER_ID`, `ORDER_IDS`, `TYPES.ORDER`
2. `tests/order.test.js` — fetches data, calls calculator, asserts
3. `lib/orderCalculator.js` — pure calculation, no API calls

### Jest execution order (critical)

The `describe` callback runs **when the file loads**, before `beforeAll`. Never branch on fetched data at describe-definition time.

**Wrong:** `if (items.length === 0)` inside `describe` (evaluates before `beforeAll` runs)

**Right:** Throw in `beforeAll` if the fetched list is empty, then iterate inside `it()` callbacks:
```javascript
beforeAll(async () => {
  items = await searchThings(TYPES.ITEM, constraints);
  if (items.length === 0) throw new Error("No items found");
  results = items.map(item => calculateDomain({ item }));
}, 120000);

// No guard test needed; forEach runs after beforeAll
it("validates all items", () => {
  items.forEach((item, i) => {
    expect(getNum(item, "field")).toBe(results[i].field);
  });
});
```

When `beforeAll` throws, Jest marks all tests in the suite as failed with the setup error. No separate guard `it` test is needed.

### Bubble Data API naming

Type names in `TYPES` must be the Bubble editor display name, lowercased with spaces removed (e.g. "Order Item" → `orderitem`). Buildprint MCP internal schema keys (e.g. `cart_items`) are **not** the same as Data API type names.

### Environment

Copy `.env.example` to `.env` and set:
- `BUBBLE_API_BASE` — e.g. `https://yourapp.bubbleapps.io/api/1.1/obj`
- `BUBBLE_API_TOKEN` — your Bubble API token

### Test output

`test-results.md` is overwritten on every `npm test` run (gitignored). Use `testResultsLogger.step()` inside each `it()` block with dynamic data (IDs, amounts) to make the report useful for non-coders.

### Full spec

`TESTING_GUIDE.md` is the canonical reference for templates, naming conventions, Buildprint MCP workflow, and AI agent instructions.
