---
app_name: "8count Order Validation Framework"
app_description: "A Jest-based validation framework that verifies financial calculations in the 8count Bubble (no-code) event ticketing platform. It fetches order, reporting, and refund records from the Bubble Data API, runs pure JavaScript re-implementations of the backend calculations, and asserts that calculator output matches what Bubble stored. It also includes a local browser-automation pipeline (Express server plus Playwright codegen) for recording, stabilizing, and re-running user flows such as login, event creation, and ticket purchase."
core_flows:
  - feature: "Order Validation Suite"
    description: "Validates GP_Order financial fields (gross, discount, service fee, custom fees, processing fees, total order value) against recomputed values from add-ons, ticket types, promotion, and event detail."
    core: true
  - feature: "Reporting Daily Validation Suite"
    description: "Cross-validates GP_ReportingDaily, GP_ReportingTicketTypeDaily, and GP_ReportingCustomFeeDaily aggregates for a given date+event by summing across all paid orders, ticket add-ons, and order fees."
    core: true
  - feature: "Refund Validation Suite"
    description: "Validates GYM_Transaction refund records, GP_RefundItems, and PayIntent linkage when processing a refund against a prior order."
    core: true
  - feature: "Pipeline Dashboard"
    description: "Express-served UI at /dashboard.html that lists recorded flows with their current phase (recording, ids, done) and a Run button that streams flow execution logs into a modal."
    core: false
  - feature: "New Recording"
    description: "Wireframe and API endpoints that launch Playwright codegen for a given flow name and base URL, then poll recording status until a recording file is saved."
    core: false
  - feature: "Recording Verification"
    description: "Spawns a Claude sub-process to analyze a raw Playwright recording, flag fragile selectors, and produce a stabilized version alongside an analysis.json report."
    core: false
  - feature: "Stable ID Mapping"
    description: "Stabilization-checklist screen that lets a user replace flagged fragile selector fragments (e.g. #P<digits>) with stable element IDs, persisting the mapping into the stabilized recording file."
    core: false
  - feature: "Reverification"
    description: "Re-runs the verify pipeline after ID mappings have been applied, producing an updated analysis.json and .reverify.log."
    core: false
  - feature: "Flow Generation"
    description: "Converts a stabilized recording into a parameterized .flow.js file under flows/, using the generate-flow script, and advances the flow phase to done."
    core: false
  - feature: "Flow Runner"
    description: "npm run flow and the /api/run-flow endpoint execute a parameterized flow (login, create-event, purchase flow 11Apr, etc.) with values sourced from its .config.json and stream stdout/stderr to a .run.log file."
    core: false
  - feature: "Fixture Capture"
    description: "Verify-fixture screen plus /api/fetch-bubble and /api/save-fixture endpoints that pull real Bubble records by type and ID into a per-flow .fixture.json for offline test re-runs."
    core: false
  - feature: "Test Results Markdown Report"
    description: "jestMarkdownReporter writes test-results.md on every npm test run, including per-test step descriptions and dynamic data captured via testResultsLogger.step()."
    core: false
feature_count: 12
skill_count: 8
---

# 8count Order Validation Framework

## About this application

This repository is an automated validation harness for the 8count event-ticketing application built on Bubble (no-code). The primary workflow is data validation: a developer points the framework at an order ID in the Bubble database, the framework fetches the order and every related record (add-ons, ticket types, promotion, event detail, order fees, reporting daily records, refund transaction, pay intent), and a suite of pure JavaScript calculators re-derives the expected values and asserts they match what Bubble stored. A secondary workflow is a local browser-automation pipeline that records a user flow with Playwright codegen, verifies and stabilizes the recording with a Claude sub-agent, then replays parameterized flows for regression checks. The framework has no public UI — its users are test engineers and AI coding agents running `npm test` and `npm run pipeline` from their terminal.

## User roles

- **Test engineer / developer** — Edits `testConfig.js` to set the primary IDs (`ORDER_ID`, `REFUND_TRANSACTION_ID`, `REFUND_ORDER_ID`), runs `npm test`, reads `test-results.md`.
- **AI coding agent** — Follows the canonical spec in `TESTING_GUIDE.md` to add new test suites, calculators, and fixtures. Uses Buildprint MCP to verify Bubble schema and record data.
- **Pipeline operator** — Runs `npm run pipeline`, opens `http://localhost:3000/dashboard.html`, records new flows, maps stable IDs, and triggers flow runs from the dashboard.

## Entry point

- **CLI entry (primary):** `npm test` — runs Jest with `config/jest.config.js`, writes `test-results.md`.
- **Pipeline entry (secondary):** `npm run pipeline` → browser at `http://localhost:3000/` (redirects to `/dashboard.html`).
- **Recording entry:** `npm run record` — launches Playwright codegen directly, saves output under `recordings/`.

Environment prerequisites: `.env` must contain `BUBBLE_API_BASE` and `BUBBLE_API_TOKEN`. `testConfig.js` must have valid IDs for any suite whose `RUN_*_TESTS` flag is true.

## Navigation structure

There is no multi-screen user app. The two "surfaces" are:

1. **Test output** — A single markdown file `test-results.md`, regenerated every run, organized by describe block and test title.
2. **Pipeline UI (wireframe-backed Express app)** — Five screens served from `wireframes/`:
   - `dashboard.html` — Flow list with Run button and phase badge
   - `new-recording.html` — Form to start a new Playwright codegen session
   - `stabilization-checklist.html` — Apply stable IDs to flagged fragile selectors
   - `verify-fixture.html` — Fetch Bubble records and save a fixture
   - `login.html` / `signup.html` / `dashboard-empty.html` — Static mock screens (not wired to auth)

Users move between pipeline screens by clicking header nav links or the phase badge on each flow card.

## Core flows

| Name | Description | Core Flow |
|------|-------------|-----------|
| Order Validation Suite | Validates `GP_Order` fields against `calculateOrder()` output for a single `ORDER_ID`. | Yes |
| Reporting Daily Validation Suite | Cross-validates three daily reporting types for a given (date, event) derived from the seed order. | Yes |
| Refund Validation Suite | Validates `GYM_Transaction`, `GP_RefundItems`, and `PayIntent` consistency for a given refund transaction. | Yes |
| Pipeline Dashboard | Lists flows with phase and a Run button; streams flow execution output into a modal. | No |
| New Recording | Starts a Playwright codegen session for a named flow and base URL. | No |
| Recording Verification | Claude sub-process analyzes the raw recording and produces a stabilized version. | No |
| Stable ID Mapping | Map fragile selector fragments to stable IDs; writes them into the stabilized file. | No |
| Reverification | Re-run verification after ID mappings. | No |
| Flow Generation | Convert a stabilized recording to a parameterized `.flow.js` under `flows/`. | No |
| Flow Runner | Execute a parameterized flow with values from its `.config.json`, stream logs. | No |
| Fixture Capture | Fetch real Bubble records by type+ID and save into `fixtures/{flow}.fixture.json`. | No |
| Test Results Markdown Report | Custom Jest reporter renders `test-results.md` with step-level detail. | No |

## Detailed core flow descriptions

### 1. Order Validation Suite

**Entry point:** `npm test -- order.test.js` with `RUN_ORDER_TESTS=true` and a non-empty `ORDER_ID` in `testConfig.js`.

**Preconditions:**
- `ORDER_ID` points to a real `gp_order` record
- `.env` has `BUBBLE_API_BASE` and `BUBBLE_API_TOKEN`
- The order has an `Event`, `Add Ons` list, and `Order Status` set

**Steps (from `tests/order.test.js`):**
1. Fetch the seed `GP_Order` by ID.
2. Fetch each add-on in `order["Add Ons"]` in parallel (`gp_addon`).
3. If the order has `GP_Promotion`, fetch the `gp_promotion` record.
4. Fetch the linked `event` and its `GP_EventDetail` (`gp_eventdetail`).
5. For every unique `GP_TicketType` referenced by Ticket-type add-ons, fetch the `gp_tickettype` record into a map.
6. For each custom fee in `order["GP_CustomFees"]`, fetch the `gp_customfeetype` record.
7. Flatten every add-on's `GP_OrderFee` list and fetch each `gp_orderfee`; swallow 404s.
8. Call `calculateOrder({ order, addOns, promotion, ticketTypes, eventDetail, customFeeTypes, orderFees })` from `lib/orderCalculator.js`.
9. Run 15 assertions:
   - Per-addon gross price = ticketPrice × quantity
   - Order Gross Amount = sum of add-on gross prices (ticket type only)
   - Ticket Count, Fee Service, Discount Amount, Donation Amount, Total Order Value
   - Processing Fee Revenue, Processing Fee Deduction (provider-specific: Stripe 2.9% + $0.30, Authorize.Net 0% + $0.05)
   - Sum of GP_OrderFee amounts equals calculated total custom fees
   - Presence checks: Order Status, Payment Method, User or Guest Checkout, Order ID Text, Event

**Variations:**
- No promotion (Step 3 skipped, `discount = 0`)
- Donation-only add-ons (no ticket count, no service fee; donation fee computed separately)
- Zero-dollar order (total payable < $0.01 → all processing fees forced to 0)
- `No Processing Fee` flag ON in event detail (processing fee revenue = 0; Stripe deduction still computed)
- Provider = `authorize_net` (different rate in `PAYMENT_PROVIDERS` lookup)

**Success condition:** Every `expect(...).toBeCloseTo(...)` or `.toBe(...)` passes. `test-results.md` lists each validation with calculated vs stored values.

### 2. Reporting Daily Validation Suite

**Entry point:** `npm test -- reportingDaily.test.js` with `RUN_REPORTING_DAILY_TESTS=true` and a valid `ORDER_ID`.

**Preconditions:**
- Seed order has `Date Label` and `Event` populated
- `GP_ReportingDaily` records exist for (Date Label, Event)
- At least one paid order exists for (Date Label, Event)

**Steps (from `tests/reportingDaily.test.js`):**
1. Fetch seed order; extract `dateLabel` and `eventId`.
2. In parallel, search `gp_reportingdaily`, `gp_reportingtickettypedaily`, `gp_reportingcustomfeedaily`, and `gp_order` (status=Paid) by those constraints.
3. For each paid order, fetch every add-on; for each add-on, fetch every order fee.
4. Compute aggregate calculations: Gross Sales, Total Sales, Total Tickets Sold, Service Fees, Processing Fees, Donations, Discounts, Custom Fees, Refund adjustments.
5. Sum reported values across all `GP_ReportingDaily` records.
6. Compute ticket-type aggregates per `GP_ReportingTicketTypeDaily` (Final Sales, Gross Sales, Service Fees, Discounts, Tickets Sold Count, Net Sales, Refunds, Tickets Live, Tickets Voided).
7. Compute custom-fee aggregates per `GP_ReportingCustomFeeDaily` (Gross Total, Net Total, Refunds Total).
8. Assert reported sums match calculated sums with 2-decimal tolerance for money, exact match for counts.

**Variations:**
- No refunds for the date (`allRefundItems` empty; refund fields fall back to ticketReported values)
- No voids in test data (`Total Tickets Voided` and `Total Tickets Voided Amount` = 0)
- Multiple ticket types per event (iterates over all `GP_ReportingTicketTypeDaily` rows)

**Success condition:** All 24 assertions pass (17 on `GP_ReportingDaily`, 5 on `GP_ReportingTicketTypeDaily`, 2 on `GP_ReportingCustomFeeDaily`). Note: the suite has 12 assertions in the ticket-type block and 3 in the custom-fee block depending on data presence — the actual count may differ per run.

### 3. Refund Validation Suite

**Entry point:** `npm test -- refund.test.js` with `RUN_REFUND_TESTS=true`, `REFUND_TRANSACTION_ID`, and `REFUND_ORDER_ID` set.

**Preconditions:**
- The transaction has `OS GYM Transaction Type = "Refund"`
- `RefundItems` list is non-empty
- `PayIntent` is linked

**Steps (from `tests/refund.test.js`):**
1. Fetch the `gp_order` and `gym_transaction` in parallel.
2. Fetch each `gp_refunditems` record from `transaction["RefundItems"]`.
3. If `transaction["PayIntent"]` is set, fetch the `payintent` record.
4. Call `calculateRefundAggregates({ refundItems })` from `lib/refundCalculator.js`.
5. Assert three groups:
   - **GYM_Transaction refund validation (6 tests)** — type is Refund, Credit/Debit is Credit, Net Amount = sum of item amounts, Refund Date populated, RefundItems non-empty, Order back-link
   - **GP_RefundItems validation (5 tests)** — amount ≥ 0, type set; ticket items have ticket+ticketType; Transaction back-ref matches; sum equals Net Amount; `recoverable?` is boolean
   - **PayIntent refund validation (3 tests)** — PayIntentStatus is Success, AmountPay matches Net Amount, PayIntent links back to the order

**Variations:**
- Refund with ticket items only (donation/service_fee/custom_fee blocks skipped)
- Refund with recoverable fees (contributes to `totalFeesRefundAdj` and `processingFeeRevRefundAdj`)
- Partial refund (some ticket items, some service fees — `totalRefunds` sums all regardless of type)

**Success condition:** All 13 assertions pass when `RUN_REFUND_TESTS=true`. Suite skips (`describe.skip`) when the flag is false.

## Pipeline flow descriptions (non-core)

### Pipeline Dashboard

- Path: `/dashboard.html` (also `/` redirects here)
- Reads `flows/flows.json` via `GET /api/flows`
- Each flow card shows: name, phase badge (`recording`, `ids`, `verify`, `done`), a Run button (if `.flow.js` exists)
- Run button calls `POST /api/run-flow { flowName }`, then polls `GET /api/run-status?flow=<name>` to populate a modal with streaming log output
- Run result pill shows `Running`, `Passed` (on `[exit 0]`), or `Failed`

### New Recording

- Path: `/new-recording.html`
- User enters a flow name and base URL, submits
- `POST /api/recording-start { flowName, baseUrl }` spawns `npx playwright codegen -o recordings/<flow>.js <baseUrl>` detached; writes a `.codegen.pid` file
- Client polls `GET /api/recording-status?flow=<name>` — when the file exists and contains `await page.` calls and the pid is no longer live, the server advances the flow phase from `recording` to `ids`

### Recording Verification

- Triggered by `POST /api/verify { flowName }`
- Writes a `.analyzing` lock file, spawns `node scripts/verify-recording.js <flowName>` detached
- The verifier internally invokes `claude -p` with `--allowedTools "Bash(playwright-cli:*),Read,Write,Edit"` to analyze the recording, flag fragile selectors, and produce `<flow>-stabilized.js` plus `<flow>.analysis.json`
- Status polled via `GET /api/analysis?flow=<name>` — returns `analyzing`, `reverifying`, `ready`, or `none`

### Stable ID Mapping

- Path: `/stabilization-checklist.html`
- Loads `<flow>.analysis.json` and displays each flagged fragment
- User enters stable IDs per fragment
- `POST /api/apply-ids { flowName, mappings }` rewrites `<flow>-stabilized.js` replacing each fragment with `#<stableId>`, and patches the analysis.json

### Reverification

- `POST /api/reverify { flowName }` writes a `.reverifying` lock file and spawns `node scripts/reverify-recording.js <flowName>`
- Produces an updated analysis and `.reverify.log`

### Flow Generation

- `POST /api/generate-flow { flowName }` copies the stabilized file to `<flow>-recording.js`, then calls `generateFlow(flowName, { force: true })` from `scripts/generate-flow.js`
- On success, writes `flows/<flowName>.flow.js` and advances phase to `done`

### Flow Runner

- `POST /api/run-flow { flowName }` spawns `node flows/<flowName>.flow.js` with stdout/stderr piped to `flows/<flowName>.run.log`
- A `.running` lock file is present while the process is alive; on exit the server appends `[exit <code>]`
- `GET /api/run-status?flow=<name>` returns `{ running, output, success }`

### Fixture Capture

- Path: `/verify-fixture.html`
- `GET /api/fetch-bubble?type=<typeName>&id=<id>` returns one Bubble record
- `POST /api/save-fixture { flowName, records }` writes `fixtures/<flowName>.fixture.json` and advances the flow phase to `done`
- `GET /api/get-fixture?flow=<name>` reads back the saved fixture

## Common UI patterns

- **Phase badges** on flow cards: grey `recording`, orange `ids`, indigo `verify`, green `done`
- **Mini stepper dots** on each flow card indicate current phase progress
- **Run result modal** with a dark log area (`#111827` background), status pill (`Running` / `Passed` / `Failed`), and a close button
- **Empty state** on `dashboard-empty.html` when no flows are registered
- **Sticky header** across every pipeline screen with logo `P`, page title, Docs link, and avatar `AJ`
- **Primary action button** is indigo (`#6366F1`); destructive / fail states use red (`#dc2626`)

## Test output patterns

- `test-results.md` is overwritten on every `npm test` run (gitignored)
- Each test emits one or more rows via `testResultsLogger.step(description, details)` inside its `it()` block
- The custom reporter (`config/jestMarkdownReporter.js`) groups rows by describe block and formats a markdown table per assertion
- The seed `.jest-test-steps.json` file is used to transport step data from Jest workers back to the reporter in the main process

## Preferences / conventions

- Bubble Data API type names: editor display name, lowercased, spaces removed (e.g. "GP Order" → `gp_order`)
- Bubble field names in code use exact editor casing (e.g. `order["Add Ons"]`, `addon["OS AddOnType"]`, `addon["GP_TicketType"]`)
- Option-set values via Data API use display casing (`"Refund"`, `"Credit"`, `"Success"`), not the lowercase internal keys returned by Buildprint
- Use `toBeCloseTo(expected, 2)` for currency; `toBe()` for integer counts and enum strings
- `beforeAll` timeout is `120000ms`; throw if a fetched list is empty rather than branching inside `describe`
- Skip pattern: `(RUN_*_TESTS ? describe : describe.skip)` so the suite can be disabled via flag
- Do not modify `config/bubbleClient.js` or remove `lib/testUtils.js`
- `TESTING_GUIDE.md` is the canonical spec for adding new suites; this document is the user-perspective map

## Skills index

| Skill | File | Purpose |
|-------|------|---------|
| Run Order Validation | skills/run-order-validation.md | Execute the Order suite against a specific ORDER_ID |
| Run Reporting Daily Validation | skills/run-reporting-daily-validation.md | Execute the Reporting Daily suite |
| Run Refund Validation | skills/run-refund-validation.md | Execute the Refund suite against a transaction and order |
| Run All Tests | skills/run-all-tests.md | Execute every enabled Jest suite and inspect test-results.md |
| Start Pipeline Server | skills/start-pipeline-server.md | Start the Express dashboard server on port 3000 |
| Record New Flow | skills/record-new-flow.md | Start a Playwright codegen session and save the raw recording |
| Run a Saved Flow | skills/run-saved-flow.md | Execute a parameterized flow and stream logs |
| Capture Fixture | skills/capture-fixture.md | Fetch real Bubble records and save a per-flow fixture file |
