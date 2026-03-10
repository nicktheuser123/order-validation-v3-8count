# Testing Guide

**This document is the single source of truth** for how this repo is structured. When a user asks an AI to create a test case for a domain (orders, subscriptions, etc.), the AI must read this guide and follow the schemas and templates below.

---

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment**
   - Copy `.env.example` to `.env`
   - Add your Bubble API credentials: `BUBBLE_API_BASE` and `BUBBLE_API_TOKEN`

3. **Create test suites**
   - This repo ships with no test suites. Ask an AI: "Create a test case for [your domain]" (e.g. orders, subscriptions).
   - The AI will add config to `testConfig.js`, create `tests/{domain}.test.js`, and `lib/{domain}Calculator.js` or `lib/{domain}Aggregator.js` following the templates in this guide.

4. **Run tests**
   ```bash
   npm test
   ```

   To run a single suite: `npm test -- {domain}.test.js`

   Results are written to `test-results.md` (overwritten each run). See Section 12.

5. **Record a flow (optional)** — Set `BASE_URL` in testConfig, then run `npm run record` to record a user flow with Playwright. See Section 11.

---

## Folder Structure

```
order-validation-v3/
├── testConfig.js           # Dynamically generated - add keys when adding test suites; includes BASE_URL
├── config/                 # Config and tooling
│   ├── bubbleClient.js     # Bubble API client - do not modify
│   ├── logger.js           # Logging helpers
│   ├── testResultsLogger.js # Step recording for test-results.md - use in tests
│   ├── jestMarkdownReporter.js  # Writes test-results.md on each run
│   ├── jest.config.js
│   ├── jest.setup.js
│   └── playwright.config.js  # Playwright baseURL from testConfig
├── lib/                    # Calculation logic
│   ├── testUtils.js        # Shared helpers (getNum, roundTo2) - do not remove
│   ├── parseBubbleUrl.js   # Parse BASE_URL → { appId, version } for Buildprint MCP
│   ├── {domain}Calculator.js   # Per-domain: pure calculation from fetched data
│   └── {domain}Aggregator.js  # Per-domain: aggregate multiple records (optional)
├── tests/
│   └── {domain}.test.js    # One file per domain
├── scripts/
│   └── playwright-record.js   # Launches Playwright codegen, saves to recordings/
├── recordings/             # Playwright recording output (gitignored)
├── test-results.md         # Test results output (gitignored, overwritten each run)
└── TESTING_GUIDE.md        # This file - canonical spec
```

---

## 1. testConfig.js Schema

testConfig.js is **dynamically generated**. It starts empty. For **each new test suite** you add, the AI must add the following and export them.

### Global Config (Playwright)

```javascript
/** Base URL for Playwright recording - where codegen opens the browser */
const BASE_URL = "";  // e.g. "https://yourapp.bubbleapps.io" or "https://yourapp.bubbleapps.io/version-test"
```

appId and version for Buildprint MCP are derived from BASE_URL automatically (see Section 11.4).

### Per-Suite Config Keys

For a suite named `{domain}` (e.g. `order`, `subscription`, `reportingDaily`):

```javascript
/** Set to false to skip this test suite */
const RUN_{SUITE_NAME}_TESTS = true;

/** Primary entity ID - used to fetch the record(s) this suite validates */
const {ENTITY}_ID = "";  // e.g. ORDER_ID, SUBSCRIPTION_ID

/** Optional: validate multiple entities. Use empty array if not needed. */
const {ENTITY}_IDS = [];

/** Bubble data type names. Add a key for every type this suite fetches. */
const TYPES = {
  {ENTITY}: "YourBubbleTypeName",
  // Add all related types, e.g. ADD_ON, TICKET_TYPE, PROMOTION, etc.
};
```

**Naming rules:**
- `RUN_{SUITE}_TESTS`: Use the suite name in UPPER_SNAKE_CASE (e.g. `RUN_ORDER_TESTS`, `RUN_SUBSCRIPTION_TESTS`)
- `{ENTITY}_ID`: The primary Bubble type this suite validates (e.g. `ORDER_ID`, `SUBSCRIPTION_ID`)
- `TYPES`: Keys are UPPER_SNAKE_CASE; values must be **Bubble Data API type names** (see Section 9)

### Module Exports

Every config key must be exported:

```javascript
module.exports = {
  BASE_URL,
  RUN_{SUITE}_TESTS,
  {ENTITY}_ID,
  {ENTITY}_IDS,
  TYPES
};
```

When adding a second suite, merge into the exports:

```javascript
module.exports = {
  BASE_URL,
  RUN_ORDER_TESTS,
  ORDER_ID,
  ORDER_IDS,
  RUN_REPORTING_DAILY_TESTS,
  TYPES  // TYPES is shared; add keys for all suites
};
```

### AI Instruction

When creating a new test suite, add the corresponding config keys and export them. **Do not add keys for suites that do not exist.**

---

## 2. Test File Template

File: `tests/{domain}.test.js`

### Structure

1. **Imports:** `config/bubbleClient`, `lib/{domain}Calculator` or `lib/{domain}Aggregator`, `testConfig`
2. **Module-level variables:** Store fetched data and calculation result
3. **beforeAll:** Check flag, validate ID, fetch data, call calculator/aggregator, store result
4. **describe block:** Use `(RUN_* ? describe : describe.skip)` so suite is skippable
5. **it blocks:** One per assertion

### Minimal Template

```javascript
const { getThing, searchThings } = require("../config/bubbleClient");
const { calculate{Domain} } = require("../lib/{domain}Calculator");
const { {ENTITY}_ID, RUN_{SUITE}_TESTS, TYPES } = require("../testConfig");

let entity;
let result;

beforeAll(async () => {
  if (!RUN_{SUITE}_TESTS) return;
  if (!{ENTITY}_ID) {
    throw new Error("Set {ENTITY}_ID in testConfig.js to run this suite");
  }

  entity = await getThing(TYPES.{ENTITY}, {ENTITY}_ID);

  // Fetch related data as needed for your domain
  // const related = await getThing(TYPES.RELATED, entity.relatedId);

  result = calculate{Domain}({
    entity,
    // ... other params
  });
}, 120000);

(RUN_{SUITE}_TESTS ? describe : describe.skip)("{Suite} validation", () => {
  it("validates field A", () => {
    expect(entity["Field A"]).toBe(result.fieldA);
  });

  it("validates field B", () => {
    expect(entity["Field B"]).toBeCloseTo(result.fieldB, 2);
  });
});
```

### beforeAll Pattern (4 steps)

1. **Check flag:** `if (!RUN_{SUITE}_TESTS) return;`
2. **Validate ID:** `if (!{ENTITY}_ID) throw new Error(...);`
3. **Fetch data:** Use `getThing(type, id)` and/or `searchThings(type, constraints)` from bubbleClient
4. **Calculate and store:** Call calculator/aggregator, assign to module-level variable

### describe Skip Pattern

```javascript
(RUN_{SUITE}_TESTS ? describe : describe.skip)("{Suite} validation", () => { ... });
```

### Assertion Patterns

- Exact match: `expect(actual).toBe(expected)`
- Numeric with tolerance: `expect(actual).toBeCloseTo(expected, 2)`

### Jest Execution Order (Critical)

**The `describe` callback runs when the file loads, before `beforeAll`.** Any conditional logic that depends on data fetched in `beforeAll` will execute with initial/empty values.

**Wrong pattern** (causes flaky or incorrect tests):

```javascript
beforeAll(async () => {
  items = await searchThings(TYPES.ITEM, constraints);
}, 120000);

describe("Validation", () => {
  if (items.length === 0) {
    it("has no items", () => expect(items).toHaveLength(0));
    return;
  }
  items.forEach((item, i) => {
    it(`validates item ${i}`, () => { /* ... */ });
  });
});
```

At describe time, `items` is still `[]`, so `items.length === 0` is true. The "no items" test is defined and the `forEach` never runs. Later `beforeAll` populates `items`. The "no items" test then fails because `items` now has data.

**Correct pattern** (throw in `beforeAll` if empty; iterate inside `it`):

```javascript
// In beforeAll: throw if list is empty after fetching
beforeAll(async () => {
  if (!RUN_{SUITE}_TESTS) return;
  if (!{ENTITY}_ID) {
    throw new Error("Set {ENTITY}_ID in testConfig.js to run this suite");
  }

  items = await searchThings(TYPES.ITEM, constraints);

  if (items.length === 0) {
    throw new Error(`No items found for {ENTITY}_ID ${{{ENTITY}_ID}}`);
  }

  results = items.map(item => calculate{Domain}({ item }));
}, 120000);

// In describe: no guard test needed; forEach runs after beforeAll
describe("Validation", () => {
  it("validates field A for all items", () => {
    items.forEach((item, i) => {
      expect(getNum(item, "field_a")).toBe(results[i].fieldA);
    });
  });
});
```

When `beforeAll` throws, Jest marks all tests in the suite as failed with the setup error — more honest than a vacuously-passing guard test. The `items.forEach` runs **inside** the `it` callback, which executes **after** `beforeAll`. At that point `items` is populated.

**Rule:** Do not branch on fetched data at describe-definition time. Use `it()` callbacks that iterate over the data at test execution time. When fetching a list, throw in `beforeAll` if the list is empty. Do not use a guard `it` test.

---

## 3. Calculator Module Template

File: `lib/{domain}Calculator.js`

### Purpose

Pure calculation. Given fetched Bubble data, return computed values. **No Bubble API calls.**

### Signature

```javascript
function calculate{Domain}({ param1, param2, ... }) {
  // ... calculation logic
  return { field1, field2, ... };
}
```

### Minimal Template

```javascript
const { money, logSection } = require("../config/logger");
const { getNum, roundTo2 } = require("./testUtils");

function calculate{Domain}({ entity, relatedData = {} }) {
  // Implement your domain's calculation logic
  const computed = 0; // e.g. sum of prices, apply discounts, etc.

  return {
    field1: computed,
    field2: 0
  };
}

module.exports = { calculate{Domain} };
```

### Rules

- Use `../config/logger` for `money`, `logSection` if needed
- Use `./testUtils` for `getNum`, `roundTo2`
- Bubble field names (e.g. "Total Amount", "Discount") are schema-specific—use the correct names for your domain
- `TYPES` holds type names; field names stay in code

---

## 4. Aggregator Module Template

File: `lib/{domain}Aggregator.js`

### Purpose

Aggregate data from multiple records and/or reporting tables for comparison. Used when validating sums across many records.

### Signature

```javascript
async function aggregate{Domain}({ records, getThing, ... }) {
  // ... aggregation logic
  return { calculatedSums, tableSums };
}
```

### Minimal Template

```javascript
const { getNum } = require("./testUtils");

async function aggregate{Domain}({
  records,
  reportingEntries,
  getThing
}) {
  let calculatedSums = { total: 0 };
  let tableSums = { total: 0 };

  for (const record of records) {
    // Fetch related data if needed
    // const related = await getThing(TYPES.RELATED, record.relatedId);
    calculatedSums.total += getNum(record, "Amount", "amount_number");
  }

  for (const entry of reportingEntries) {
    tableSums.total += getNum(entry, "Total", "total_number");
  }

  return { calculatedSums, tableSums };
}

module.exports = { aggregate{Domain} };
```

### Rules

- `getThing` is passed in from the test (do not require bubbleClient)
- Use `getNum(obj, ...keys)` to safely read numeric fields (tries multiple field names)
- Return an object the test can use for assertions

---

## 5. Other File Schemas

| File | Schema |
|------|--------|
| **config/jest.config.js** | Must have `testMatch: ["<rootDir>/tests/**/*.test.js"]`, `testTimeout: 120000`, `maxWorkers: 1`, `passWithNoTests: true`. New test files must live in `tests/` and end in `.test.js`. |
| **lib/testUtils.js** | Shared helpers: `getNum(obj, ...keys)` returns first numeric value found; `roundTo2(num)` rounds to 2 decimals. Add new shared helpers here and document in this guide. |
| **config/bubbleClient.js** | `getThing(type, id)` fetches one record; `searchThings(type, constraints)` fetches all matching records. Types and IDs come from testConfig.TYPES and *_ID. |
| **.env.example** | Required: `BUBBLE_API_BASE`, `BUBBLE_API_TOKEN`. No app-specific values. |
| **test-results.md** | Generated by `npm test`; overwritten each run. See Section 12. |

---

## 6. Naming Conventions

| Item | Pattern | Example |
|------|---------|---------|
| Test file | `{domain}.test.js` | `order.test.js`, `subscription.test.js` |
| Calculator | `{domain}Calculator.js` | `orderCalculator.js` |
| Aggregator | `{domain}Aggregator.js` | `reportingAggregator.js` |
| Run flag | `RUN_{SUITE}_TESTS` | `RUN_ORDER_TESTS` |
| Entity ID | `{ENTITY}_ID` | `ORDER_ID`, `SUBSCRIPTION_ID` |
| TYPES key | `UPPER_SNAKE_CASE` | `ORDER`, `ADD_ON`, `REPORTING_DAILY` |

---

## 7. Import Paths

- **Tests:** `../config/bubbleClient`, `../config/testResultsLogger`, `../lib/{module}`, `../testConfig`
- **Lib:** `../config/logger`, `./testUtils`

---

## 8. AI Agent Instructions

### When user asks to "create a test case for X"

1. **Read this guide** for schemas and templates
2. **Update testConfig.js:** Add `RUN_X_TESTS`, `X_ID`, `TYPES.X` (and related types), export all. Use **Data API type names** (Section 9)—not Buildprint MCP schema keys.
3. **Create tests/x.test.js** using the test file template, filling in domain-specific fetch logic and assertions
4. **Create lib/xCalculator.js** (or xAggregator.js if aggregating) using the calculator/aggregator template
5. **Use testResultsLogger** (Section 12): Import it and call `step()` inside each `it()` block with dynamic data (IDs, amounts, etc.) so `test-results.md` is detailed and user-friendly
6. **Do not** create config keys or files for domains the user did not request
7. **Jest execution order:** When validating multiple records (e.g. list of items), do not branch on `items.length` at describe-definition time. After fetching a list in `beforeAll`, throw if it is empty (e.g. `if (items.length === 0) throw new Error(...)`). Then use `it()` callbacks that iterate at test runtime. No guard `it` test is needed. See Section 2.

### When user asks to "add a new assertion to X"

1. Add a new `it("validates ...", () => { ... })` block in `tests/x.test.js`
2. Use `testResultsLogger.step()` inside the block with dynamic data (Section 12)
3. If the assertion requires new calculated fields, update `lib/xCalculator.js` to return them

### When user asks to "add a new test suite"

1. Follow the "create a test case" flow
2. Merge new config into existing testConfig.js exports
3. Add new TYPES keys to the shared TYPES object if needed

---

## 9. Bubble Data API vs Buildprint MCP: Name Mapping

**Critical:** The `bubbleClient` calls the **Bubble Data API** (REST). There are **two separate naming rules** — one for type names (used in URL paths and `testConfig.TYPES`) and one for field names (used in test and calculator code to access JSON properties). These rules are different. Mixing them up causes 404 errors or silent `undefined` values.

---

### 9.1 Data API Type Names (for `testConfig.TYPES` and URL paths)

Type names go in the URL: `GET /api/1.1/obj/{type}/{id}`. They are derived from the **editor display name**:

- **Lowercase**
- **Spaces removed**
- Underscores and other characters preserved as-is

| Editor Display Name | Data API Type Name |
|---------------------|--------------------|
| `Order` | `order` |
| `Order Item` | `orderitem` |
| `GP_Order` | `gp_order` |
| `GP_CustomFeeType` | `gp_customfeetype` |
| `GP_ReportingDaily` | `gp_reportingdaily` |

**Do not use Buildprint MCP internal path keys** (e.g. `/user_types/gp_customfees`) as type names. The path key is the original internal ID assigned when the type was created — it does not change if the type is later renamed. The Data API uses the **current display name**, not the original internal key.

| Buildprint Path Key | Editor Display Name | Correct Data API Type Name |
|---------------------|--------------------|-----------------------------|
| `gp_customfees` | `GP_CustomFeeType` | `gp_customfeetype` |
| `gp_reporting_daily` | `GP_ReportingDaily` | `gp_reportingdaily` |

To verify type names: use Buildprint MCP `get_summary` to get the editor display name, then apply the lowercase + spaces-removed rule.

---

### 9.2 Data API Field Names (for test and calculator code)

Field names are used to access properties on fetched records (e.g. `order["Event"]`, `addon["OS AddOnType"]`). The Bubble Data API returns fields using their **exact editor display name** — with original casing and spaces preserved. They are **not** lowercased or reformatted.

```js
// Correct — use the display name exactly as it appears in Bubble editor
order["Add Ons"]           // a list field named "Add Ons"
order["GP_Promotion"]      // a linked field named "GP_Promotion"
order["Gross Amount"]      // a number field named "Gross Amount"
addon["OS AddOnType"]      // an option set field named "OS AddOnType"
addon["GP_TicketType"]     // a linked field named "GP_TicketType"

// Wrong — these formats do NOT work in API responses
order.add_on_list_custom_gp_addon     // Buildprint schema key format — wrong
order.gp_promotion_custom_gp_promotion // Buildprint schema key format — wrong
order.gross_amount_number              // snake_case — wrong
```

**Never derive field names from Buildprint MCP internal schema keys.** Buildprint uses its own internal field key format (e.g. `add_on_list_custom_gp_addon`, `gp_promotion_custom_gp_promotion`) which does not match what the Data API returns.

**The only reliable way to get field names** is to fetch an actual record and inspect the JSON keys:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://{appId}.bubbleapps.io/{version}/api/1.1/obj/{type}/{id}"
```

The keys in the `response` object are the field names to use in code.

#### Option set field values

Option set field values are also returned as their **display name** (original casing):

```js
addon["OS AddOnType"] === "Ticket"    // value is "Ticket", not "ticket"
promotion["OS GP Promotion Type"] === "Discount Amount"  // not "discount_amount"
customFee["Type"] === "Percentage"    // not "porcentaje" or "percent"
```

Always verify the actual option values by fetching a real record — do not guess from Buildprint option set keys.

---

### 9.3 Summary

| Context | Rule | Example |
|---------|------|---------|
| `testConfig.TYPES` values | Lowercase display name, spaces removed | `"gp_customfeetype"` |
| Fetching records: `getThing(TYPES.X, id)` | Use `TYPES.X` (type name from above) | `getThing(TYPES.GP_ORDER, id)` |
| Accessing fields on fetched records | Exact display name, spaces and case preserved | `order["Gross Amount"]` |
| Option set values in comparisons | Exact display name as returned by API | `=== "Ticket"`, `=== "Percentage"` |

### AI Instruction

When writing tests or calculators:
1. Use Buildprint MCP `get_summary` to get editor display names for types → apply lowercase + spaces-removed rule for `TYPES` values
2. **Always fetch a real record** to discover actual field names and option values — never guess from Buildprint internal keys
3. Access fields with bracket notation when names contain spaces: `record["Field Name"]`
4. Never use the Buildprint internal schema key format (`field_type_typename`) as field names in code

---

## 10. Buildprint MCP Workflow (Future)

The goal is to integrate with Buildprint MCP to:

1. Fetch Bubble workflow logic (which workflows write which fields)
2. Generate or update test case calculations from that logic
3. Run tests via `npm test`

**Design implication:** Calculation modules and config use clear, documented structures so they can be generated or updated by tools. **Name mapping:** Use Section 9 when translating MCP schema output to API-ready type and field names.

---

## 11. Playwright Recording + Buildprint Workflow

Use Playwright codegen to record a user flow, then use Buildprint MCP to discover business logic and generate Jest validation tests.

### 11.1 Prerequisites

- `BASE_URL` in testConfig (must be a Bubble app URL, e.g. `https://yourapp.bubbleapps.io` or `https://yourapp.bubbleapps.io/version-test`)
- appId and version are derived from BASE_URL automatically; no separate Buildprint env vars

### 11.2 Recording a Flow

1. Set `BASE_URL` in `testConfig.js` to your Bubble app URL
2. Run `npm run record`
3. Perform the flow in the browser (e.g. place order, create subscription)
4. Stop recording; output is saved to `recordings/latest-recording.js`

### 11.3 AI Agent: Creating Tests from a Recording

When the user says "create tests from my recording" or "generate tests from the recording":

1. Read `recordings/latest-recording.js` (or path user provides)
2. Extract page URLs, actions, and any assertions from the Playwright-generated code (`page.goto(...)`, `page.click(...)`, `page.fill(...)`, `expect(...)`)
3. Call Buildprint MCP per Section 11.4
4. Generate Jest test file, calculator/aggregator, and testConfig updates per existing Sections 1–4
5. Use Section 9 for Data API name mapping

### 11.4 Deriving appId and version + Buildprint MCP Call Sequence

**First:** Call `parseBubbleUrl(testConfig.BASE_URL)` from `lib/parseBubbleUrl.js`. If `appId` is null (custom domain), try `parseBubbleUrl(process.env.BUBBLE_API_BASE)`.

**Bubble URL structure:**
- `https://[appId].bubbleapps.io` → version `"live"`
- `https://[appId].bubbleapps.io/version-test` → version `"test"`
- `https://[appId].bubbleapps.io/version-<id>` → version `"<id>"` (custom branch)

**Buildprint MCP call sequence:**

1. **get_guidelines** with `paths: ["general", "exploring/app"]` at session start
2. **get_summary** with derived `appId`, `version` — get page names, data types, reusables
3. **Map recording to pages:** Use URLs from `page.goto()` in the recording to match Buildprint page names
4. **get_tree** with `include_workflows: true` for matched pages — get workflows triggered by elements
5. **search_json** to find workflows that write to relevant data types (e.g. Order, Order Item)
6. **get_json** for workflow/action details — understand calculation logic
7. **Name mapping:** Use Section 9 rules to convert MCP schema keys to Bubble Data API type names for `testConfig.TYPES` and `bubbleClient` calls

**Recording file schema:** `recordings/latest-recording.js` contains Playwright-generated JS. Extract: URLs from `page.goto()`, selectors from `page.click()`/`page.fill()`, assertions from `expect()`.

### 11.5 AI Instruction

When user says "create tests from my recording" or "generate tests from the recording": follow Section 11.3.

---

## 12. Test Results Markdown Output

Each `npm test` run produces a single Markdown file, `test-results.md`, in the project root. The file is **overwritten** on every run. It provides a user-friendly, UI-style view of test results—readable by non-coders—without changing Jest's console output.

### Output File

| Property | Value |
|----------|-------|
| **Path** | `test-results.md` (project root) |
| **Behavior** | Overwritten each run |
| **Format** | Markdown with hierarchy: Test Suites → Test Cases → Steps |

### Hierarchy

1. **Test Suite** — One per test file (e.g. "Order validation")
2. **Test Case** — One per `it()` block (e.g. "validates field A")
3. **Steps** — How each assertion was validated (recorded via `testResultsLogger`)

### Recording Steps

Import `testResultsLogger` and call it **inside** each `it()` block, before the assertion. **Include dynamic data** (IDs, amounts, line items) in the `details` object so it appears in the report.

```javascript
const testResultsLogger = require("../config/testResultsLogger");

it("validates order total", () => {
  // Record steps with dynamic data from the actual test run
  testResultsLogger.step("Fetched Order from API", {
    orderId: entity._id,
    orderItemValue: 78  // actual value from the order
  });
  testResultsLogger.step("Calculated subtotal", {
    formula: "Sum of line item prices",
    lineItems: items.map(i => i.price),
    result: result.total
  });
  testResultsLogger.step("Compared with Bubble field", {
    expected: result.total,
    actual: entity["Total Amount"]
  });
  expect(entity["Total Amount"]).toBe(result.total);
});
```

### API

| Method | Purpose |
|--------|---------|
| `step(description, details?)` | Record a validation step. `details` is an object; keys become labels, values appear in the report. Include dynamic data (IDs, amounts, etc.). |
| `fieldCalculation(fieldName, { steps, expected, actual })` | Record a field calculation breakdown. `steps` is an array of `{ description, detail? }`. |

### Formatting Guidelines

- Use **plain language**; avoid jargon
- Structure for **non-coders** — someone reading the markdown should understand what was validated without reading code
- **Always include dynamic data** in `details` — e.g. order ID, order item value (78), line item prices, calculated result. This makes the report useful for debugging and auditing.

### AI Instruction

When creating or extending test cases:

1. Import `testResultsLogger` from `../config/testResultsLogger`
2. Inside each `it()` block, before the assertion, call `step()` for each logical step (fetch, calculate, compare)
3. Pass **dynamic data** in the `details` object — IDs, amounts, line items, expected/actual values
4. For field validations, use `fieldCalculation()` to break down the calculation
5. Use plain-language descriptions
