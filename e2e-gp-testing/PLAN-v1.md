# E2E GP Portal Testing Process — Implementation Plan v1

## Context

Comprehensive, repeatable E2E testing process for the 8count GP portal covering: event creation, configuration, ticket purchasing (20 permutations across 5 checkout flows, 4 ticket types, 4 promo types, special character injection), and order verification. Orchestrated by sub-agents using `playwright-cli` for browser automation and Buildprint MCP for app discovery and data verification.

**When stuck or confused:** Always fall back to Buildprint MCP (`search_json`, `get_json`, `get_tree`) to discover page structures, workflows, fields, and navigation. It has the complete Bubble app definition.

---

## Folder Structure

Everything lives in `e2e-gp-testing/` at the repo root:

```
e2e-gp-testing/
├── PLAN-v1.md                 # This file — versioned implementation plan
├── settings.json              # Master settings — EP creds, flow mode, base URL, browser config
├── e2e-state.json             # Runtime state — event IDs, order IDs, user accounts (written by agents)
├── test-plan.md               # Master markdown — config, permutation matrix, results
├── runbook.md                 # Flexible LLM guide + pitfalls log from previous runs
├── tests/
│   └── e2eOrder.test.js       # Jest suite validating all E2E orders
└── results/                   # Screenshots, evidence (gitignored)
```

---

## Master Settings File: `e2e-gp-testing/settings.json`

Controls all variables for the entire process. Sub-agents read this first.

```json
{
  "baseUrl": "https://8countlogin.com/version-81rkv",
  "eventProducer": {
    "email": "abhishek+ep24.6@millionlabs.co.uk",
    "password": "123"
  },
  "flow": {
    "mode": "full",
    "eventName": "GP E2E Test <YYYYMMDD>",
    "existingEventId": "",
    "eventStartDate": "7/16/2026",
    "eventEndDate": "7/18/2026"
  },
  "browser": {
    "headed": true
  },
  "payment": {
    "cardNumber": "4007000000027",
    "cvv": "123",
    "expiryDate": "04/27",
    "lastName": "TestUser",
    "zip": "10001",
    "address": "123 Test Street",
    "city": "New York",
    "state": "NY"
  },
  "verification": {
    "waitAfterOrderMs": 30000
  }
}
```

**`flow.mode` options:**
- `"full"` — end-to-end: create event, configure, purchase, verify
- `"orders-only"` — skip event creation, use `existingEventId` for purchasing + verification
- `"verify-only"` — skip event + purchasing, just run Jest/Buildprint verification on existing orders

---

## Phase 1: Setup — Create Folder, Settings, State Template, Test Plan Skeleton

### 1.1 Create `e2e-gp-testing/` directory and all files

- `settings.json` — master config (as above)
- `e2e-state.json` — empty state template:
  ```json
  {
    "runId": "",
    "event": { "name": "", "id": "", "url": "", "eventDetailId": "" },
    "ticketTypes": {},
    "promotions": {},
    "customFees": {},
    "guestUsers": [],
    "orders": []
  }
  ```
- `test-plan.md` — skeleton with sections for config, matrix, results (populated during execution)
- `results/` directory for screenshots

### 1.2 Create `tests/e2eOrder.test.js` skeleton

Jest test that reads `e2e-state.json` and validates all orders. Imports from `../../lib/orderCalculator.js`, `../../config/bubbleClient.js`, `../../testConfig.js`.

---

## Phase 2: Event Producer Setup (Sub-Agent 1)

Reads `settings.json` for credentials and base URL. Uses `playwright-cli` with headed/headless per settings.

**Key navigation reference:**
- Event Producer home: `{baseUrl}/eventproducer`
- Guest Portal admin: `{baseUrl}/gp-guestportal-admin` (accessible via "Guest Portal" tab on left side of eventproducer page)
- When confused about any page or element: use Buildprint MCP `search_json` to find the page definition, elements, workflows

### 2.1 Create Event

If `flow.mode === "full"`:
- Use `/createEvent` skill with event name and dates from settings
- If that fails, fall back to `playwright-cli` manual flow
- After creation, extract event URL from the redirect or page content

If `flow.mode === "orders-only"` or `"verify-only"`:
- Skip, use `existingEventId` from settings

### 2.2 Navigate to Guest Portal Admin

1. From eventproducer page, click "Guest Portal" tab on the left sidebar
2. This navigates to `gp-guestportal-admin` page
3. Find the created event in the list, open its settings

### 2.3 Configure Processing Fee

- Find the processing fee section
- Set "Do not pass to customers" = YES (this means `No Processing Fee` = true on GP_EventDetail)
- Save

### 2.4 Configure Custom Fee

Add a custom fee with:
- Tax: Yes
- Revenue: No
- Type: Percentage
- Amount: 6.5%

### 2.5 Create Ticket Types (4 types)

| Ticket Type | Price | Service Fee | Quantity Available |
|-------------|-------|-------------|-------------------|
| Standard | $50 | $2 | 100 |
| Premium | $100 | $5 | 50 |
| Standard Unlimited | $50 | $2 | _(leave empty)_ |
| Premium Unlimited | $100 | $5 | _(leave empty)_ |

Navigate to ticket type management. Create each type. For "Unlimited" types, leave the quantity/availability field empty (meaning unlimited).

### 2.6 Create Promotions (4 promos)

| Code | Type | Value | Applies To | Purpose |
|------|------|-------|-----------|---------|
| FLAT10 | Discount Amount | $10 | Ticket | Modest flat discount |
| PCT20 | Discount Percentage | 20% | Ticket | Percentage discount |
| PCT100 | Discount Percentage | 100% | Ticket | Full discount → $0 order |
| FLAT1000 | Discount Amount | $1000 | Ticket | Large flat → $0 order (exceeds any ticket price) |

### 2.7 Extract IDs via Buildprint MCP and Update State

1. `search_data` on `custom.event` filtered by event name → get event ID
2. `search_data` on `custom.gp_eventdetail` filtered by event → get eventDetail ID, verify `No Processing Fee` = true
3. `search_data` on `custom.gp_tickettype` filtered by event → get all 4 ticket type IDs
4. `search_data` on `custom.gp_customfeetype` filtered by event → get custom fee type ID
5. `search_data` on `custom.gp_promotion` filtered by event → get all 4 promo IDs
6. Write everything to `e2e-gp-testing/e2e-state.json`
7. Extract the guest portal event URL for Phase 3

---

## Phase 3: Ticket Purchasing (3 Parallel Sub-Agents)

Each agent reads `settings.json` for payment/browser config and `e2e-state.json` for event URL and IDs.

### 3.1 Ticket Types Available

| Type | Price | SF | Qty |
|------|-------|----|-----|
| Standard | $50 | $2 | 100 |
| Premium | $100 | $5 | 50 |
| Standard Unlimited | $50 | $2 | Unlimited |
| Premium Unlimited | $100 | $5 | Unlimited |

### 3.2 Checkout Flows

| Flow | Description |
|------|-------------|
| **Guest** | Fill name/email, click "CONTINUE AS GUEST", pay |
| **Logged-in** | Already logged in, proceed directly to payment |
| **Guest→Register** | Start as guest, add tickets, then click Register button in step 1 (ticket details step), sign up, then complete purchase |
| **Guest→Login (top right)** | Start as guest, add tickets, click Login button on top-right nav, log in with existing account, complete purchase |
| **Register→Login** | Go to register page, but instead of signing up, click login link/button and log in with existing credentials |

### 3.3 Special Characters for Text Fields

Every text input that accepts free text (name, email prefix, address, etc.) must be tested with JSON-breaking characters in at least 6 of the 20 orders:

```
O'Brien "Test" <b>bold</b> & Co. {special} \back/slash
```

Use variations of: `'`, `"`, `<`, `>`, `&`, `\`, `/`, `{`, `}`, `[`, `]`

### 3.4 Permutation Matrix (20 Orders)

| # | Tickets | Qty | Promo | Checkout | Special Chars | Key Test |
|---|---------|-----|-------|----------|---------------|----------|
| 1 | Standard | 3 | None | Guest | No | Baseline standard |
| 2 | Premium | 4 | None | Guest | No | Baseline premium |
| 3 | Std + Prem | 3+2 | None | Guest | No | Mixed regular types |
| 4 | Std Unlimited | 5 | None | Guest | Yes | Unlimited type + special chars |
| 5 | Prem Unlimited | 4 | None | Guest | Yes | Unlimited type + special chars |
| 6 | Standard | 5 | FLAT10 | Logged-in | No | Flat discount, logged-in |
| 7 | Premium | 3 | PCT20 | Logged-in | No | Pct discount, logged-in |
| 8 | Std + Prem | 4+3 | FLAT10 | Logged-in | Yes | Mixed + flat + special chars |
| 9 | Std Unlim + Prem | 3+2 | PCT20 | Logged-in | No | Unlimited + regular mixed |
| 10 | Prem Unlim + Std | 2+4 | FLAT10 | Logged-in | No | Reversed mix + flat |
| 11 | Standard | 3 | PCT100 | Guest | No | 100% off → $0 order |
| 12 | Premium | 2 | FLAT1000 | Guest | No | $1000 flat → $0 order |
| 13 | Std + Prem Unlim | 3+3 | None | Guest→Register | No | Sign up during checkout |
| 14 | Premium | 5 | PCT20 | Guest→Register | Yes | Register + discount + special chars |
| 15 | Std Unlimited | 4 | FLAT10 | Guest→Register | No | Unlimited + register |
| 16 | Standard | 3 | None | Guest→Login (top right) | No | Login via top-right button |
| 17 | Std + Prem + Std Unlim | 2+2+3 | PCT20 | Guest→Login (top right) | Yes | Triple mix + login + special chars |
| 18 | Prem Unlimited | 5 | FLAT10 | Register→Login | No | Register page → login instead |
| 19 | All 4 types | 2+2+3+2 | PCT100 | Register→Login | Yes | All types + $0 + special chars |
| 20 | Std + Prem Unlim | 4+3 | FLAT1000 | Logged-in | No | Large flat → $0 + logged-in |

**Coverage summary:**
- All 4 ticket types individually (#1, #2, #4, #5) and in combinations (#3, #8, #9, #10, #13, #17, #19, #20)
- All 5 checkout flows (#1-5/11-12=Guest, #6-10/20=Logged-in, #13-15=Register, #16-17=Login, #18-19=Register→Login)
- All 4 promo types (None, FLAT10, PCT20, PCT100, FLAT1000)
- $0 order edge cases (#11, #12, #19, #20)
- Special characters in 6 orders (#4, #5, #8, #14, #17, #19)
- Quantities range from 2 to 9 tickets per order

### 3.5 Guest User Accounts

**Pre-created accounts** (created by Agent 2b before purchases):

| User | Email | Password | Used By |
|------|-------|----------|---------|
| User A | `e2e.usera@testmail.com` | `Test123!` | Orders #6, #7, #8 |
| User B | `e2e.userb@testmail.com` | `Test123!` | Orders #9, #10, #20 |
| User C | `e2e.userc@testmail.com` | `Test123!` | Orders #16, #17 (login from top-right) |

**Created during checkout flow** (Guest→Register):

| User | Created During | Email |
|------|---------------|-------|
| User D | Order #13 | `e2e.userd@testmail.com` |
| User E | Order #14 | `e2e.usere@testmail.com` |
| User F | Order #15 | `e2e.userf@testmail.com` |

**Register→Login** (navigates to register, then logs in with existing account):
- Order #18 → logs in as User A
- Order #19 → logs in as User B

### 3.6 Parallel Agent Split (max-parallelism, user-ownership model)

**Session contract.** Every `playwright-cli` command an agent issues during Phase 2 MUST include `-s=<name>` — the default (unnamed) session is forbidden. Two agents sharing the default session land on the same Bubble cookies and collide (last-created order echoes into every tab; follow-up purchases get blocked by the "in-progress order" check). See `.claude/skills/playwright-cli/references/session-management.md` for the isolation guarantees of named sessions.

**Session naming.**
- Order workers use `-s=gp-order-NN` (zero-padded order number).
- Setup agents use `-s=gp-setup-A`, `-s=gp-setup-B`, `-s=gp-setup-C`.
- Owner agents running multiple orders sequentially open a fresh `gp-order-NN` per order — **do not reuse one session across orders**.

**Pre-phase — 3 parallel setup agents** (~60-90s, skip any whose `state.setupUsers.<id>` is already `"done"`):

| Setup agent | Session | Work |
|---|---|---|
| **Setup-A** | `gp-setup-A` | Open event URL, click Login → SIGN UP, fill registration with User A creds from `settings.guestUsers[0]`, confirm the account is created, set `state.setupUsers.A = "done"`, close session |
| **Setup-B** | `gp-setup-B` | Same pattern for User B |
| **Setup-C** | `gp-setup-C` | Same pattern for User C |

All three run concurrently. The parent agent waits for all three `state.setupUsers` flags to flip to `"done"` before spawning the order phase. If `flow.resetOrdersOnRun` is true, preflight already reset the flags to `"pending"`.

**Order phase — 13 worker agents** (parent launches all at once; owner agents internally serialize their queues):

| Agent | Session(s) | Orders (sequential if multiple) | Gate |
|---|---|---|---|
| Guest-01 | `gp-order-01` | #1 | — |
| Guest-02 | `gp-order-02` | #2 | — |
| Guest-03 | `gp-order-03` | #3 | — |
| Guest-04 | `gp-order-04` | #4 | — |
| Guest-05 | `gp-order-05` | #5 | — |
| Guest-11 | `gp-order-11` | #11 ($0) | — |
| Guest-12 | `gp-order-12` | #12 ($0) | — |
| Owner-A | `gp-order-06` → `gp-order-07` → `gp-order-08` → `gp-order-18` | #6, #7, #8, #18 | `state.setupUsers.A == "done"` |
| Owner-B | `gp-order-09` → `gp-order-10` → `gp-order-19` → `gp-order-20` | #9, #10, #19, #20 | `state.setupUsers.B == "done"` |
| Owner-C | `gp-order-16` → `gp-order-17` | #16, #17 | `state.setupUsers.C == "done"` |
| Register-D | `gp-order-13` | #13 (Guest→Register creates User D) | — |
| Register-E | `gp-order-14` | #14 (Guest→Register creates User E) | — |
| Register-F | `gp-order-15` | #15 (Guest→Register creates User F) | — |

**Why this topology.** Bubble's server-side state for a logged-in user includes the in-progress cart. Two simultaneous sessions logged in as the same user (e.g. User A) would collide on that server state regardless of client-side cookie isolation. Owner-A/B/C each processes its shared user's orders serially inside one worker, which removes the need for any cross-agent mutex. Guest and Register-D/E/F orders have no user contention and each get their own worker. Peak concurrency: 13 browser contexts; the long pole is Owner-A / Owner-B at 4 sequential orders each.

**Coordination surface** — still `e2e-state.json`, no new infrastructure:
- `state.setupUsers = { A, B, C }` with values `"pending"` / `"done"` — gate for Owner agents
- `state.orders = [...]` — every agent appends `{ orderNumber, orderId, tickets, promo, checkout }` on completion (unchanged)

Each agent appends completed order IDs to `e2e-state.json`. For $0 orders (#11, #12, #19, #20): the payment step may be skipped entirely or show $0 — the agent should handle both cases and verify the order still completes (confirmation screen or "purchase complete" popup).

### 3.7 Purchase Flow (General)

1. Navigate to event URL from `e2e-state.json`
2. Click "Tickets"
3. Click "ADD" for each ticket type x quantity
4. If using promo: find promo code input, enter code, apply
5. Fill guest info fields (Full Name, Email) — use special chars where flagged in matrix
6. **Checkout flow variant** (see 3.2 for each flow type)
7. Accept terms
8. Click "PAY NOW" (if not $0 order)
9. On Authorize.net page: fill card/address from `settings.json` payment config
10. Click pay → click continue
11. **Success = either "order confirmed" screen OR "purchase complete" popup**
12. Wait 30 seconds (per `settings.json` verification.waitAfterOrderMs) for backend workflows to complete
13. Record order ID in `e2e-state.json`

### 3.8 Payment Method Testing

For at least one logged-in user (User A or B):
- Navigate to account/payment methods
- Add a saved payment method (test card from settings)
- Verify it appears
- Delete the saved payment method
- Verify deletion
- Proceed to purchase with manual card entry

---

## Phase 4: Order Verification (Sub-Agent 3)

Runs after all Phase 3 agents complete. Waits 30 seconds after the last order before starting.

### 4.1 Jest Data API Verification

**New file: `e2e-gp-testing/tests/e2eOrder.test.js`**

Reads order IDs from `e2e-gp-testing/e2e-state.json`. For each order:

1. Fetch: order, addons, promotion, eventDetail, ticketTypes, customFeeTypes, orderFees via `bubbleClient`
2. Run `calculateOrder()` from `lib/orderCalculator.js`
3. Assert ALL existing order.test.js assertions:
   - `Gross Amount` <-> `grossAmount` (toBeCloseTo, 2)
   - `Ticket Count` <-> `ticketCount` (toBe)
   - `Fee Service` <-> `totalServiceFee` (toBeCloseTo, 2)
   - `Discount Amount` <-> `discountTotal` (toBeCloseTo, 2)
   - Custom fees sum <-> `totalCustomFees` (toBeCloseTo, 2)
   - `Processing Fee Revenue` = 0 (processing fee disabled)
   - `Processing Fee Deduction` <-> `stripeDeduction` (toBeCloseTo, 2)
   - `Total Order Value` <-> `totalOrderValue` (toBeCloseTo, 2)
   - `Order Status`, `Payment Method`, `Guest Checkout`, `Order ID Text`, `Event` link
4. Also run **reportingDaily** assertions from `reportingDaily.test.js`:
   - GP_ReportingDaily aggregates (Gross Sales, Total Sales, Net Revenue, etc.)
   - GP_ReportingTicketTypeDaily per-type aggregates
   - GP_ReportingCustomFeeDaily per-fee aggregates
5. Also run **refund-style** field presence checks from `refund.test.js` patterns (if applicable)

**For $0 orders** (#11, #12, #19, #20): verify `Total Order Value` = 0, `Processing Fee Deduction` = 0, `Processing Fee Revenue` = 0.

**Test file imports:**
```javascript
const { calculateOrder } = require("../../lib/orderCalculator");
const { getThing, searchThings } = require("../../config/bubbleClient");
const { TYPES } = require("../../testConfig");
```

**30-second wait:** Built into the test — `beforeAll` fetches data, if critical fields are null/missing, sleep 30s and retry once.

### 4.2 Buildprint MCP Verification

1. `get_summary` — confirm all data types exist
2. `search_data` on `custom.gp_order` filtered by event → find all 20 orders
3. `fetch_data` on order IDs → spot-check field values
4. Fetch GP_EventDetail → confirm `No Processing Fee` = true, custom fee config correct
5. `search_json` for order-creation and fee-calculation workflows → trace logic paths
6. `search_data` on `custom.gp_reportingdaily` → verify daily aggregates

### 4.3 UI Verification via playwright-cli

Login as event producer, navigate to event orders on `eventproducer` page:
1. Verify all 20 orders appear
2. Spot-check 5-6 orders: click to view, verify ticket types, quantities, totals
3. Take screenshots as evidence → save to `e2e-gp-testing/results/`

---

## Phase 5: Documentation & Repeatability

### 5.1 Populate `e2e-gp-testing/test-plan.md`

Final report with:
- Event configuration (IDs, URLs, settings)
- Per-order results table: expected vs actual for each field, pass/fail
- Jest test output summary
- Buildprint verification results
- Screenshot references

### 5.2 Create `e2e-gp-testing/runbook.md`

**This is a flexible guide, NOT a prescriptive script.** No hardcoded selectors. Structure:

- How to use this runbook (read settings.json, use snapshots, use Buildprint MCP when confused)
- Phase 1: Event Setup (high-level what to do)
- Phase 2: Purchases (permutation matrix, checkout flow descriptions, success criteria)
- Phase 3: Verification (run Jest tests, check Buildprint, spot-check UI)
- Known Pitfalls & Lessons Learned (updated after each run)
- Page Reference (EP home, GP admin, use Buildprint for others)

---

## Implementation Order

1. **Create folder + settings + state template + test-plan skeleton** (Phase 1)
2. **Branch from main** → `e2e-gp-portal-testing`
3. **Event Producer Setup** (Phase 2) — single sub-agent with playwright-cli
4. **Ticket Purchasing** (Phase 3) — 3 parallel sub-agents:
   - Agent 2a: Pure guest orders (#1-5, #11, #12) — 7 orders
   - Agent 2b: Logged-in + Guest→Register (#6-10, #13-15, #20) — 9 orders
   - Agent 2c: Guest→Login + Register→Login (#16-19) — 4 orders
5. **Create e2eOrder.test.js** (Phase 4 prep) — Jest suite reading from e2e-state.json
6. **Run verification** (Phase 4) — Jest tests + Buildprint MCP + UI spot-checks
7. **Generate report + runbook** (Phase 5) — populate test-plan.md, write runbook.md

## Files to Create

| File | Purpose |
|------|---------|
| `e2e-gp-testing/PLAN-v1.md` | This versioned plan |
| `e2e-gp-testing/settings.json` | Master settings controlling entire process |
| `e2e-gp-testing/e2e-state.json` | Runtime state (event IDs, order IDs, users) |
| `e2e-gp-testing/test-plan.md` | Master markdown — config, matrix, results |
| `e2e-gp-testing/runbook.md` | Flexible LLM guide + pitfalls log |
| `e2e-gp-testing/tests/e2eOrder.test.js` | Jest suite for all 20 E2E orders |
| `e2e-gp-testing/results/` | Screenshots directory |

## Files to Modify

| File | Change |
|------|--------|
| `testConfig.js` | Add `RUN_E2E_TESTS` flag |

## Key Existing Files Reused

| File | How Used |
|------|----------|
| `lib/orderCalculator.js` | Core calculation logic — called by e2eOrder.test.js |
| `config/bubbleClient.js` | `getThing()`, `searchThings()` for fetching Bubble data |
| `lib/testUtils.js` | `getNum()`, `roundTo2()` helpers |
| `config/testResultsLogger.js` | `step()` for test report output |
| `tests/order.test.js` | Pattern reference — all assertions replicated |
| `tests/reportingDaily.test.js` | Pattern reference — reporting assertions replicated |
| `.claude/skills/createEvent/SKILL.md` | Event creation skill |
| `.claude/skills/playwright-cli/SKILL.md` | Browser automation reference |

## Verification Checklist

- [ ] All 20 orders created (confirmation screen or "purchase complete" popup)
- [ ] $0 orders (#11, #12, #19, #20) handled correctly (may skip payment)
- [ ] Special character orders (#4, #5, #8, #14, #17, #19) didn't break anything
- [ ] All 5 checkout flows exercised
- [ ] Payment method add/delete tested for at least one user
- [ ] `npm test -- e2e-gp-testing/tests/e2eOrder.test.js` passes for all 20 orders
- [ ] Reporting daily aggregates verified via Jest + Buildprint
- [ ] Buildprint MCP confirms event config, order fields, workflow logic
- [ ] EP UI shows all orders with correct totals
- [ ] `test-plan.md` populated with complete results
- [ ] `runbook.md` written with known pitfalls for future re-runs
