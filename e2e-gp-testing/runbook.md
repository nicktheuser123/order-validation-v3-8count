# E2E GP Portal — Runbook for LLM Agent

## Mode Router (read this first)

Read `settings.json` → `flow.mode`:

- `"full"` — run all phases. Use `eventCreation.name / startDate / endDate` to create a fresh event, configure it (Phase 1), then place purchases (Phase 2) and verify (Phase 3).
- `"orders-only"` — skip Phase 1 entirely. Run `npm run e2e:preflight` first; if it exits 0, the existing event in `e2e-state.json` is reusable. Proceed straight to Phase 2 with `state.event.url` as the target.
- `"verify-only"` — skip Phases 1 and 2. Jump directly to `npm test -- e2e-gp-testing/tests/e2eOrder.test.js`.

Subset and append control:

- `flow.ordersToRun` — if a non-empty array of order numbers (e.g. `[7, 9]`), iterate only those rows from the 20-row matrix in Phase 2. Empty array = run all 20.
- `flow.resetOrdersOnRun` — if `true`, overwrite `state.orders` with `[]` before the first purchase so validation only sees the orders from this run. Default `false` (append).

## Quick Re-Run Guide (TL;DR)

1. Read `settings.json` for all config values and pick a `flow.mode`
2. Ensure `testConfig.js` has the E2E test flag enabled and that the event's 4 promotions are **assigned to all 4 ticket types** via the GP admin "Assigned Promotions" tab (failure to do this = "Invalid coupon code" at checkout)
3. Verify promotion percentages via `PATCH /api/1.1/obj/gp_promotion/<id>` if the UI saved them wrong (percentage field is buggy)
4. Follow the Mode Router above
5. Run `npm test -- --testPathPattern=e2e-gp-testing` after all orders are placed
6. Expected results: 41/42 Jest tests pass. The single known failure is a $0.01 rounding difference on custom fees

## How to Use This Runbook

1. **Read `settings.json` first** — it has all configuration: credentials, base URL, payment details, ticket types, promotions, browser mode
2. **Use `playwright-cli` with snapshot-driven navigation** — do NOT rely on hardcoded selectors. After every action, take a snapshot to find the next element ref
3. **When confused about any page, element, or workflow:** use Buildprint MCP tools (`search_json`, `get_json`, `get_tree`) with appId `k-8count` and version `81rkv` — it has the complete Bubble app definition
4. **This guide describes WHAT to do, not HOW to click** — figure out selectors on the fly using snapshots
5. **Record all IDs in `e2e-state.json`** — this is how agents coordinate
6. **Before writing any deterministic selector or fill code**, grep the Gotchas Registry (bottom of this file) by component name and cite the matching entries in-chat. Enforced by `CLAUDE.md`.

## Phase 0: Discovery (observe → record → generate)

**Purpose.** Capture real DOM IDs and selector strategies from a live walkthrough of a distinct UI flow, so the deterministic runner can be written or extended without guessing. One discovery artifact per flow — new permutations within an existing flow (different ticket mix, promo, or contact data) do NOT need re-discovery, only a new row in `orders.json`.

### When to run this phase

- A new flow is being added that isn't covered yet (see the Flow Inventory below) — e.g. first time implementing `logged-in-checkout`.
- User added new `ID Attribute` values in the Bubble editor that affect an existing flow, and that flow's `discovery-<flow>.json` is now stale.
- A deterministic step broke (ID changed, element moved, new gotcha emerged) — treat as targeted re-discovery of that flow's affected steps.

### Flow inventory

Each flow has its own `discovery-<flow>.json`:

| Flow | File | Orders |
|------|------|--------|
| `guest-checkout` | `discovery-guest-checkout.json` | #1, #2, #3, #4, #5 (and $0 branch for #11, #12) |
| `logged-in-checkout` | `discovery-logged-in-checkout.json` | #6, #7, #8, #9, #10, #20 |
| `guest-to-register-checkout` | `discovery-guest-to-register-checkout.json` | #13, #14, #15 |
| `guest-to-login-top-right` | `discovery-guest-to-login-top-right.json` | #16, #17 |
| `register-to-login-checkout` | `discovery-register-to-login-checkout.json` | #18, #19 |

### What it produces

`e2e-gp-testing/discovery-<flow>.json` — the observation log consumed by Claude (in chat) to write or extend the flow's sequencer in `scripts/run-order.js`.

Top-level shape:

- `flow` — the flow name (must match a key in `FLOW_SEQUENCERS`).
- `version` — the Bubble version slug this discovery pass was captured against (e.g. `"81rkv"`).
- `capturedAt` — ISO timestamp. Used to detect drift; compare against the app's last-published-at when re-discovering.
- `representativeOrder` — the order spec the discovery agent exercised. Pure reference for humans; the executor ignores this.
- `steps[]` — per interaction: `businessName`, `action` (`click`/`fill`/`toggle`/`wait`), `id` (real CSS ID or `null`), `tag`, `class`, `text`, `notes` (disambiguation rules + any Gotchas Registry entry names that applied).
- `missingIdsOnStep*` — elements lacking an ID that the user should add in the Bubble editor before the next republish.
- `newGotchas` — silent failures without a matching registry entry; promoted into the Gotchas Registry after the run.

### Prerequisites

- User has added Bubble `ID Attribute` values and republished `version: 81rkv`.
- Agent has grepped the Gotchas Registry (bottom of this file) for every third-party or framework component in the target flow (`authorize`, `ionic`, `bubble input`, `run-code`, `shared id`, `login`, `promo`, `$0`, etc.) and is applying those patterns proactively — no re-discovering known fixes.

### Agent contract

Session name: `-s=gp-discovery-<flow>` (e.g. `gp-discovery-logged-in-checkout`). Never the default session.

1. `playwright-cli -s=gp-discovery-<flow> open <eventUrl> --headed` — fresh isolated context.
2. Follow the flow's business logic via snapshot-driven navigation. At each interaction:
   - Apply the relevant Gotchas Registry pattern proactively (`pressSequentially` for Authorize.net, native-setter + input/change events for Bubble inputs, inner-`<label>` for ionic toggles, visibility + DOM-order for shared-ID elements).
   - Probe the DOM: `document.getElementById('<expected-id>')`, `querySelectorAll('#<id>').length`, `offsetParent !== null` for visibility.
   - Append a step object to `discovery-<flow>.json` with the real ID, disambiguation notes, and any registry-entry citations.
3. When a pattern that should work fails silently, record a minimal reproducer + the fix that eventually worked in `newGotchas`.
4. Close the session + `delete-data` at the end.

### Handoff to runner generation (this chat)

After discovery, the user prompts in chat: *"extend run-order.js to handle the `<flow>` flow"*. Claude's contract:

1. Read `discovery-<flow>.json`.
2. Grep the Gotchas Registry for every component touched.
3. **Cite the matching registry entries in-chat, one line per entry**, before writing any selector or fill code. If no entry matches for a specific concern, state that explicitly.
4. Reuse existing primitives/fragments from `scripts/run-order.js` (`addTickets`, `fillContact`, `completeStep1Consent`, `toggleTerms`, `verifyTermsToggleOn`, `payAuthNet`, `fragmentTicketSelection`, etc.) instead of duplicating. Add new primitives only when a step has no existing primitive.
5. Register the new sequencer in `FLOW_SEQUENCERS`.
6. Add the corresponding rows to `orders.json`. Run the order(s) headed to verify. Debug cycles happen in-chat and feed back into the registry as `newGotchas` promotions.

### Registry-promotion rule

After each discovery pass, any `newGotchas` entries in `discovery-<flow>.json` must be reviewed and moved into the Gotchas Registry (below) with Symptom / Cause / Fix / Source. The registry is the single source of truth; the `newGotchas` array is staging only.

## Phase 1: Event Setup

**Skip this phase entirely if `flow.mode` is `"orders-only"` or `"verify-only"`.**

### Goal
Create a fully configured event with processing fees disabled, a 6.5% tax custom fee, 4 ticket types, and 4 promotions.

### Steps

1. **Create event** — Use `/createEvent` skill or `playwright-cli` manually. Event name and dates come from `settings.eventCreation` (`name`, `startDate`, `endDate`)
2. **Navigate to Guest Portal admin** — From the eventproducer page, find the "Guest Portal" tab on the left sidebar. This goes to `gp-guestportal-admin`
3. **Find the event** in the GP admin and open its settings
4. **Configure processing fee** — Set "Do not pass to customers" = YES (disables processing fee for customers)
5. **Add custom fee** — Tax, Percentage, 6.5%, Tax=Yes, Revenue=No
6. **Create 4 ticket types** per `settings.json` ticketTypes array. For "Unlimited" types, leave quantity field empty
7. **Create 4 promotions** per `settings.json` promotions array
8. **Extract all IDs** via Buildprint MCP `search_data` and write to `e2e-state.json`

## Phase 2: Ticket Purchases

### Goal
Create orders covering the 20-order permutation matrix below. Coverage: all 4 ticket types (individually and mixed), all 5 checkout flows, all 4 promo types plus None, $0 edge cases, and special-character injection in 6 orders.

### Permutation Matrix (20 Orders)

| # | Tickets | Qty | Promo | Checkout | Special Chars | Key Test |
|---|---------|-----|-------|----------|---------------|----------|
| 1 | Standard | 3 | None | Guest | No | Baseline standard |
| 2 | Premium | 4 | None | Guest | No | Baseline premium |
| 3 | Std + Prem | 3+2 | None | Guest | No | Mixed regular types |
| 4 | Std Unlimited | 5 | None | Guest | Yes | Unlimited + special chars |
| 5 | Prem Unlimited | 4 | None | Guest | Yes | Unlimited + special chars |
| 6 | Standard | 5 | FLAT10 | Logged-in A | No | Flat discount, logged-in |
| 7 | Premium | 3 | PCT20 | Logged-in A | No | Pct discount, logged-in |
| 8 | Std + Prem | 4+3 | FLAT10 | Logged-in A | Yes | Mixed + flat + special chars |
| 9 | Std Unlim + Prem | 3+2 | PCT20 | Logged-in B | No | Unlimited + regular mixed |
| 10 | Prem Unlim + Std | 2+4 | FLAT10 | Logged-in B | No | Reversed mix + flat |
| 11 | Standard | 3 | PCT100 | Guest | No | 100% off → near-$0 order |
| 12 | Premium | 2 | FLAT1000 | Guest | No | $1000 flat → true $0 order |
| 13 | Std + Prem Unlim | 3+3 | None | Guest→Register (User D) | No | Sign up during checkout |
| 14 | Premium | 5 | PCT20 | Guest→Register (User E) | Yes | Register + discount + special chars |
| 15 | Std Unlimited | 4 | FLAT10 | Guest→Register (User F) | No | Unlimited + register |
| 16 | Standard | 3 | None | Guest→Login top-right (User C) | No | Login via top-right popup |
| 17 | Std + Prem + Std Unlim | 2+2+3 | PCT20 | Guest→Login (User C) | Yes | Triple mix + login + special chars |
| 18 | Prem Unlimited | 5 | FLAT10 | Register→Login (User A) | No | Register page → login instead |
| 19 | All 4 types | 2+2+3+2 | PCT100 | Register→Login (User B) | Yes | All types + near-$0 + special chars |
| 20 | Std + Prem Unlim | 4+3 | FLAT1000 | Logged-in B | No | Large flat → true $0 + logged-in |

### Special-Character Sample (orders #4, #5, #8, #14, #17, #19)

Inject JSON-breaking characters into free-text fields (Full Name, address, etc.). Reference sample:

```
O'Brien "Test" <b>bold</b> & Co. {special} \back/slash
```

Use variations of: `'`, `"`, `<`, `>`, `&`, `\`, `/`, `{`, `}`, `[`, `]`.

### User → Order Mapping

Pre-created via the 3 setup agents:

| User | Email (see `settings.guestUsers`) | Used By |
|------|----------------------------------|---------|
| User A | `abhjoseph+usera@gmail.com` | #6, #7, #8, #18 |
| User B | `abhjoseph+userb@gmail.com` | #9, #10, #19, #20 |
| User C | `abhjoseph+userc@gmail.com` | #16, #17 |

Created mid-checkout (Guest→Register flow):

| User | Created During | Email |
|------|---------------|-------|
| User D | Order #13 | `abhjoseph+userd@gmail.com` |
| User E | Order #14 | `abhjoseph+usere@gmail.com` |
| User F | Order #15 | `abhjoseph+userf@gmail.com` |

### Execution

Before starting:
- If `flow.mode` is `"orders-only"`, run `npm run e2e:preflight` and only proceed on exit 0. Preflight closes any leftover `playwright-cli` sessions and, if `flow.resetOrdersOnRun` is true, resets `state.setupUsers` to `"pending"` for A/B/C.
- If `flow.resetOrdersOnRun` is `true`, set `state.orders = []` in `e2e-state.json` before the first purchase.
- **Spawn 3 parallel setup agents first** (Setup-A, Setup-B, Setup-C) on sessions `gp-setup-{A,B,C}` to sign up Users A/B/C. Skip any whose `state.setupUsers.<id>` is already `"done"`. Wait for all three flags to be `"done"` before spawning order workers.
- Then spawn up to 13 order worker agents in parallel per the Agent Split below. Each worker owns its sessions (`gp-order-NN`) and runs multiple orders sequentially only if it's an Owner-A/B/C agent.
- Iterate only the order numbers listed in `flow.ordersToRun`; if it's empty, iterate all 20.

### Checkout Flows

- **Guest**: Fill name/email, click "CONTINUE AS GUEST", pay
- **Logged-in**: Click the "Tickets" button first (the Login link only appears inside the tickets view, see below) → then click "Login" in the top-right of the tickets view → popup opens → fill email/password → click "LOG IN" → add tickets and purchase
- **Guest->Register**: Add tickets first, fill info, then at step 1 click "REGISTER & SAVE INFO" instead of "CONTINUE AS GUEST" → complete signup in the flow → finish purchase
- **Guest->Login (top right)**: Add tickets first, then click "Login" in the top-right of the tickets view → popup opens → fill credentials → click "LOG IN" → complete purchase
- **Register->Login**: Click "Tickets" → click "Login" top-right of the tickets view → popup opens → click "SIGN UP" button in the popup → on the signup form click the **"OR LOGIN"** button (it's a button, not a text link) → popup flips back to Log-In form → fill existing credentials → LOG IN → complete purchase

### Login & Signup (IMPORTANT — where the Login link actually is)

**The "Login" link does NOT exist on the event landing view.** It appears only inside the **tickets view**, which you reach by clicking the "Tickets" button on the landing view (URL becomes `?tab=tickets`). The link sits in the top-right of the tickets view header.

Flow: **landing → click "Tickets" button → tickets view → "Login" link visible top-right**.

All login and signup MUST use the popup triggered by that link. **Never navigate to a separate login page or open new tabs.**

- The login popup has Email + Password fields, a "LOG IN" button, and a "SIGN UP" button.
- To create a new account: click "SIGN UP" in the popup → fill registration form (email + password + confirm password only — NO name fields in signup).
- To switch from signup back to login: click the **"OR LOGIN"** button on the signup form (it is a button, not a text link).
- The "REGISTER & SAVE INFO" button at checkout Step 1 also creates an account during purchase (different mid-checkout flow).

### Agent Split (max-parallelism, user-ownership model)

**Session contract (critical):** every `playwright-cli` invocation MUST include `-s=<name>`. The default (unnamed) session is forbidden during Phase 2 — two agents sharing it would land on the same Bubble cookies and collide. Topology summary:

**Pre-phase — 3 parallel setup agents** (only if `state.setupUsers.<id> !== "done"`):
- **Setup-A** (`-s=gp-setup-A`): sign up User A via the login popup (open event URL → click "Tickets" → click "Login" top-right → click "SIGN UP" → fill email+password+confirm) → on success set `state.setupUsers.A = "done"`
- **Setup-B** (`-s=gp-setup-B`): same for User B
- **Setup-C** (`-s=gp-setup-C`): same for User C

Parent agent waits for all three `state.setupUsers` flags to flip to `"done"` before launching the order phase.

**Order phase — 13 worker agents** (parent launches all simultaneously):
- **7 guest workers** — one per order: Guest-01..05, Guest-11, Guest-12 (sessions `gp-order-01` … `gp-order-12`). No user gating.
- **Owner-A** — processes #6, #7, #8, #18 sequentially using sessions `gp-order-06`, `gp-order-07`, `gp-order-08`, `gp-order-18` (open/close a fresh named session per order; do NOT reuse one session across multiple orders). Gated on `state.setupUsers.A == "done"`.
- **Owner-B** — same pattern for #9, #10, #19, #20. Gated on `state.setupUsers.B`.
- **Owner-C** — #16, #17. Gated on `state.setupUsers.C`.
- **Register-D/E/F** — one worker each for #13, #14, #15 (Guest→Register flow creates Users D/E/F mid-checkout). Sessions `gp-order-13/14/15`.

This gives 13 concurrent Chrome contexts at peak and avoids any cross-agent user lock — each shared user (A/B/C) is processed by exactly one owning agent that serializes its own queue.

### Purchase Process (General)

**Every order runs in its own named session `gp-order-NN` where NN is the zero-padded order number.** Never use the default session; never reuse a session across orders.

Per-order lifecycle:
- `playwright-cli -s=gp-order-NN open <eventUrl> --headed` — fresh isolated context
- All subsequent interactions use the same `-s=gp-order-NN` prefix
- `playwright-cli -s=gp-order-NN close` at the end
- `playwright-cli -s=gp-order-NN delete-data` as cleanup (no-op for in-memory profiles, cheap safety)

1. `playwright-cli -s=gp-order-NN open <eventUrl> --headed` — fresh named session
2. If logging in: click "Login" in top-right → fill credentials in popup → LOG IN
3. Find and click "Tickets" button
4. For each ticket type, click "ADD" next to the matching ticket name the required number of times
5. If promo code: click "ENTER PROMO CODE" at the bottom → enter code → click submit/apply
6. Click "PROCEED TO CHECKOUT"
7. **Step 1 - Registration**: Fill Full Name and Email in Contact Info section
8. Check "The contact information is the same for all tickets" checkbox
9. Check the terms checkbox at the bottom of step 1 (just above CONTINUE AS GUEST)
10. Click "CONTINUE AS GUEST" (or "REGISTER & SAVE INFO" for register flow)
11. **Step 2 - Payment**: Scroll down to see the terms toggle and PAY NOW button
12. Toggle "I agree to the Terms and Conditions" — see `### Bubble ionic-toggle` entries in the Gotchas Registry. Click the inner `<label>`, verify the inner checkbox is `checked=true`, then click PAY NOW.
13. Click "PAY NOW" — the button is greyed out until the toggle is ON
14. **Authorize.net page**: see the `### Authorize.net` entries in the Gotchas Registry. Wait for `#cardNum` to be visible, then `pressSequentially` every field, then click the "Pay" button.
15. **Success** = "Purchase Completed!" heading on the return page
16. `playwright-cli -s=gp-order-NN close` then `playwright-cli -s=gp-order-NN delete-data`
17. Verify via Bubble API and record the order ID in `e2e-state.json`

### For $0 Orders (#11, #12, #19, #20)

See `### $0 orders` in the Gotchas Registry. Short version: the checkout swaps PAY NOW for a "COMPLETE ORDER 0$" button and skips Authorize.net entirely.

### Payment Method Testing

For one logged-in user: navigate to account settings/payment methods, add a card, verify it shows, delete it, verify deletion.

## Phase 3: Verification (Single Agent)

### Goal
Validate all 20 orders against the calculation engine and reporting aggregates.

### Steps

1. **Wait 30 seconds** after the last order was created (per `settings.json` verification.waitAfterOrderMs)
2. **Run Jest tests**: `npm test -- e2e-gp-testing/tests/e2eOrder.test.js`
3. **Use Buildprint MCP** to spot-check:
   - `search_data` on `custom.gp_order` filtered by event — should find all 20 orders
   - `fetch_data` on a few order IDs — verify field values match Jest expectations
   - Verify GP_EventDetail has `No Processing Fee` = true
4. **UI spot-check** via `playwright-cli`: Login as EP, navigate to event orders, verify orders appear with correct totals
5. **Populate `test-plan.md`** with results

## Page Reference

- **Event Producer home**: `{baseUrl}/eventproducer`
- **Guest Portal admin**: `{baseUrl}/gp-guestportal-admin` (via "Guest Portal" tab on left of EP page)
- **Event guest portal**: URL stored in `e2e-state.json` after event creation
- **For any other page**: use Buildprint MCP `get_tree` or `search_json` to discover pages

## Gotchas Registry

Grep-friendly index of silent-failure patterns and their fixes, indexed by component. Each heading is `### <Component>: <short symptom>` so `grep -ni "### <component>"` surfaces every entry for that component.

Structured entries use **Symptom / Cause / Fix / Source**. Broader guidance (UI transitions, snapshot hygiene) stays in narrative form.

**When writing or modifying deterministic Playwright code under `e2e-gp-testing/scripts/`, grep this section for every component in your flow first** (`authorize`, `bubble`, `ionic`, `playwright-cli`, `login`, `shared id`, etc.) and cite the matching entries in-chat before writing selectors. `CLAUDE.md` enforces this.

---

### Authorize.net: field names are not the American spellings

**Symptom:** `input[name="cardNumber" | "expirationDate" | "cardCode"]` and `button#submitButton` all match nothing.
**Cause:** Authorize.net's hosted form uses different field names than docs imply.
**Fix:** Card fields are `#cardNum`, `#expiryDate`, `#cvv` (all `type=tel`). Billing fields are `input[name="firstName" | "lastName" | "zip" | "address" | "city" | "state" | "phoneNumber"]`. The submit button has text `"Pay"` and no `name` attribute — select with `page.locator('button:has-text("Pay")').first()`.
**Source:** Order #3 deterministic-runner build, 2026-04-22.

### Authorize.net: `fill()` silently ignored, validation requires `pressSequentially`

**Symptom:** Fields look populated after `page.fill('#cardNum', ...)` but the Pay button stays disabled.
**Cause:** Angular validation on the form only fires on keystroke events; `fill()` writes the value without triggering them.
**Fix:** Use `pressSequentially` on **every** field including billing, with a 30–40ms delay. Then click Pay.
```js
await page.locator('#cardNum').pressSequentially('4007000000027', { delay: 40 });
```
**Source:** Pre-existing Phase 2 runbook (most-cited pitfall). Re-confirmed Order #3 run.

### Authorize.net: expiry date must be digits only (mask inserts the slash)

**Symptom:** Typing `04/27` breaks validation; Pay stays disabled.
**Cause:** The field has its own mask that inserts the slash for display.
**Fix:** Type digits only (`0427`). Mask renders `04/27`.
**Source:** Pre-existing Phase 2 runbook.

### Authorize.net: "Add Payment Method" detour for first-order-per-logged-in-user

**Symptom:** Clicking PAY NOW as a freshly-logged-in User A/B/C/D/E/F with no saved card silently no-ops.
**Cause:** Bubble requires a saved payment method for logged-in users; PAY NOW is inert without one.
**Fix:**
1. Click `+ Add Payment Method` on Step 2 → redirects to Authorize.net's `customer/addPayment` page (different from the regular payment redirect).
2. Fill card + billing with `pressSequentially`, click **SAVE** (not Pay).
3. Returns to Step 2. The ionic terms toggle **resets** during this round-trip — re-toggle before the second PAY NOW.
4. Second PAY NOW completes immediately (no redirect) — land on "Order Confirmed".
5. Subsequent orders for the same user reuse the saved card.

Rare fallback: if SAVE stays disabled even after `pressSequentially`, clicking Cancel has been observed to still persist the card server-side. Prefer fixing SAVE.
**Source:** Pre-existing Phase 2 runbook.

### Authorize.net: First/Last name auto-populate from Step 1

**Symptom:** Last Name doesn't match `settings.payment.lastName` after the redirect.
**Cause:** Authorize.net pre-fills First/Last from the Step 1 contact info.
**Fix:** Triple-click to select, then `pressSequentially` the desired last name.
```js
const ln = page.locator('input[name="lastName"]');
await ln.click({ clickCount: 3 });
await ln.pressSequentially(settings.payment.lastName, { delay: 30 });
```
**Source:** Pre-existing Phase 2 runbook.

### Authorize.net: wait for Continue button after Pay, then click to return to Bubble

**Symptom:** Navigating immediately after Pay misses the return to Bubble.
**Cause:** A "Thank you" + Continue interstitial handles the redirect back.
**Fix:**
```js
await page.waitForSelector('button:has-text("Continue")', { timeout: 45000, state: 'visible' });
await page.locator('button:has-text("Continue")').first().click();
```
**Source:** Order #3 deterministic run, 2026-04-22.

---

### Browser session: headless needs an explicit viewport

**Symptom:** Pre-fix `HEADED=false npm run e2e:run-order` hung at step 2 — after clicking Standard `#add`, the `#add-item` quantity widget existed in the DOM but `offsetParent === null`, so `clickVisibleByIdIndex` couldn't find it. `waitFor timeout [Standard add-item widget]`.
**Cause:** `playwright-cli open` ships no `--viewport` / `--window-size` flag. Headless Chromium's default viewport is too narrow for the Bubble ticket-card transitions on this event page, so the responsive layout kept `#add-item` offscreen / collapsed.
**Fix:** After `pw("open", ...)` the runner now pins the viewport via `pw("resize", W, H)` + `pw("run-code", "async page => page.setViewportSize({ width, height })")`. Defaults are 1440×900; override with `VIEWPORT_WIDTH` / `VIEWPORT_HEIGHT` env vars. `setViewportSize` is the one that drives layout in headless; `resize` keeps the headed window consistent.
**Verified:** `HEADED=false npm run e2e:run-order` placed Order #3 at $383.40 in ~107s on 2026-04-23.
**Source:** Order #3 re-run, 2026-04-22; headless fix, 2026-04-23.

### Browser session: every `playwright-cli` call needs `-s=<name>` in Phase 2

**Symptom:** Two agents land on the same Bubble cookies; orders echo across tabs; follow-up purchases are blocked by "in-progress order" checks.
**Cause:** The default (unnamed) `playwright-cli` session is shared across invocations.
**Fix:** Every command passes `-s=<name>`. Order workers use `-s=gp-order-NN`. Setup agents use `-s=gp-setup-{A,B,C}`. Discovery agents use `-s=gp-discovery-<slug>`.
**Source:** Pre-existing Phase 2 runbook.

### Browser session: one named session per order, close + delete-data when done

**Symptom:** Cross-order cookie pollution when a worker reuses a session across multiple orders.
**Fix:** Close + `delete-data` the previous session before opening a fresh `-s=gp-order-MM`. Never log out/in within a single session; between different-user orders, close + reopen.
**Source:** Pre-existing Phase 2 runbook.

### Browser session: never open new tabs, never navigate to separate login pages

**Symptom:** Accidental new tab from a link click fragments session state.
**Fix:** Close stray tabs immediately with `playwright-cli -s=<name> tab-close`. All auth happens via the popup on the ticket page — never a separate login page.
**Source:** Pre-existing Phase 2 runbook.

---

### Bubble async backend: use `domcontentloaded`, not `networkidle`

**Symptom:** `waitForLoadState('networkidle')` never resolves.
**Cause:** Bubble has persistent polling; the network never goes idle.
**Fix:** Use `domcontentloaded`. For data-ready state, `waitForFunction` on a DOM condition (e.g., cart subtotal text matches expected).
**Source:** Pre-existing Phase 2 runbook.

### Bubble async backend: per-order floor of 25s to let workflows settle

**Symptom:** Deterministic runs outrun Bubble's async workflows; reconciliation sees partial state.
**Cause:** Bubble's server-side workflows are async; the UI confirms success before all side-effects land.
**Fix:** In the runner, measure elapsed from order start; if `< MIN_ORDER_MS` (currently 25000), sleep the remainder before closing the session.
**Source:** Approved MVP plan, 2026-04-22.

### Bubble async backend: observable-state wait after cart mutations

**Symptom:** Proceeding to checkout with a stale cart subtotal.
**Fix:** After each ADD or promo apply, `page.waitForFunction` until the cart subtotal text matches the expected value. Blocked on the cart subtotal needing an ID — see `missingIdsOnStep*` in `discovery.json`.
**Source:** Approved MVP plan, 2026-04-22.

---

### Bubble currency input: use clear + `pressSequentially`, not `fill()`

**Symptom:** `fill('50')` produces wrong value; mask mis-parses the digits.
**Cause:** Bubble currency fields use a client-side mask.
**Fix:** Clear with native setter + `input`+`change` events, then `pressSequentially` the digits only.
**Source:** Pre-existing Phase 2 runbook.

---

### Bubble event setup: Google Places autocomplete requires `pressSequentially`

**Symptom:** `fill('1234 Main St')` doesn't trigger the autocomplete dropdown.
**Fix:** `pressSequentially` with a delay.
**Source:** Pre-existing Phase 2 runbook.

### Bubble event setup: Select2 textbox ref changes after first selection

**Symptom:** Second selection in a multi-select fails — the ref is stale.
**Fix:** After the first selection, target subsequent ones via `input[type="search"]`.
**Source:** Pre-existing Phase 2 runbook.

### Bubble event setup: promotions must be assigned to ticket types

**Symptom:** Promo code returns "Invalid coupon code for this event" at checkout.
**Cause:** Creating a promotion doesn't auto-link it to ticket types.
**Fix:** After creating promos, edit each ticket type → "Assigned Promotions" tab → check all applicable → Save. Use the select-all checkbox at the top to assign all at once.
**Source:** Pre-existing Phase 2 runbook.

### Bubble event setup: Cart Limit and Scan Limit required on ticket creation

**Symptom:** Ticket creation fails silently or with a validation error.
**Fix:** Cart Limit must be 1–10 (default 0 fails). Scan Limit must be selected (e.g., "Single Use").
**Source:** Pre-existing Phase 2 runbook.

### Bubble event setup: custom fee creation is the "+" button, not "?"

**Symptom:** Clicking the info (?) button opens a help popup, not the create-fee form.
**Fix:** Click the "+" button near the "Custom Fees" heading in settings.
**Source:** Pre-existing Phase 2 runbook.

### Bubble event setup: date pickers need `.first()` / `.last()` disambiguation

**Symptom:** Setting start-date also sets end-date, or the wrong calendar opens.
**Fix:** Use `.first()` for start-date calendar controls, `.last()` for end-date.
**Source:** Pre-existing Phase 2 runbook.

---

### Bubble input: `el.value = x` does not register — native setter + events required

**Symptom:** Setting a Bubble input's value programmatically doesn't update the framework state; `fill()` also fails.
**Cause:** Bubble hooks into React-style property descriptors; plain assignment bypasses the framework listeners.
**Fix:** Use the native value setter, then dispatch `input` + `change` events.
```js
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
setter.call(el, value);
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```
Encapsulated in the `fillBubbleInput(id, value)` helper in `scripts/run-order-deterministic.js`.
**Source:** Order #3 discovery + deterministic-runner build, 2026-04-22.

---

### Bubble ionic-toggle: outer div click silently no-ops — click inner `<label>`

**Symptom:** Clicking `.bubble-element.ionic-IonicToggle.clickable-element` appears to succeed but the inner `<input type=checkbox>` stays `checked=false`, and PAY NOW is inert.
**Cause:** The outer div is a passive wrapper; the `<label>` dispatches the toggle.
**Fix:** Click the inner label; verify the checkbox state before clicking PAY NOW.
```js
document.getElementById('toggle-terms').querySelector('label').click();
// verify:
document.querySelector('#toggle-terms input[type=checkbox]').checked === true
```
Fallback ladder if the label click silently fails: direct `input[type=checkbox].click()` → `page.locator(...).click({ force: true })` → real mouse events at the bounding-rect center.

**Never** click the "Terms and Conditions" text link next to the toggle — it opens a new tab.
**Source:** Pre-existing Phase 2 runbook + Order #3 discovery.

### Bubble ionic-toggle: resets after Authorize.net Add-Payment-Method detour

**Symptom:** Toggle was ON before the detour, but OFF after returning to Step 2.
**Fix:** Re-toggle before the second PAY NOW.
**Source:** Pre-existing Phase 2 runbook.

---

### Bubble percentage input: may save wrong — verify via API and patch

**Symptom:** UI shows 20% but stored `DiscountPct` is 0.2 / 0.02 / 2 — values vary.
**Cause:** UI save for percentage fields is buggy.
**Fix:** After creation, `curl -X PATCH /api/1.1/obj/gp_promotion/<id>` with the correct decimal (0.20 for 20%).
**Source:** Pre-existing Phase 2 runbook.

---

### Bubble shared IDs: `#add` and `#add-item` disambiguated by visibility + DOM order

**Symptom:** `document.getElementById('add')` returns the first of 4 elements; `#add-item` matches one per active card.
**Cause:** The Bubble editor does not enforce unique IDs across repeating groups.
**Fix:** Filter by `offsetParent !== null` (visibility), then pick by DOM-order index. Encapsulated in the `clickVisibleByIdIndex(id, index)` helper.
```js
const visible = Array.from(document.querySelectorAll('#' + id)).filter(e => e.offsetParent !== null);
visible[index].click();
```
On the tickets view, `#add` initial visible order: 0=Standard, 1=Premium, 2=Standard Unlimited, 3=Premium Unlimited. When a card activates, its `#add` disappears (replaced by the quantity widget), so subsequent indices shift: once Standard is active, Premium becomes visible idx 0.
**Source:** Order #3 discovery, 2026-04-22.

---

### Bubble Step-1: "authorized cardholder" checkbox has no ID

**Symptom:** No `#authorized-cardholder` or similar; class alone matches multiple Groups.
**Fix:** Target by class + text:
```js
Array.from(document.querySelectorAll('.clickable-element.bubble-element.Group'))
  .find(e => e.textContent.includes('authorized cardholder'))
  .click();
```
Ask the user to add an `ID Attribute` in the Bubble editor to make this deterministic.
**Source:** Order #3 discovery (logged in `missingIdsOnStep1`), 2026-04-22.

### Bubble Step-1: both checkboxes required ("same for all tickets" + terms)

**Symptom:** CONTINUE AS GUEST doesn't advance to Step 2.
**Fix:** Check "The contact information is the same for all tickets" near the top **and** the terms checkbox near the bottom (just above CONTINUE AS GUEST).
**Source:** Pre-existing Phase 2 runbook.

### Bubble Step-1 (Guest→Register): popup Email field starts empty

**Symptom:** Checkout form has an email filled, but the REGISTER & SAVE INFO popup's Email field is empty.
**Cause:** The popup doesn't inherit from the checkout form.
**Fix:** Fill the email again in the popup. Target: `page.locator('input[placeholder="Email"]').last()` to disambiguate from the checkout form's email field. Password fields: fresh snapshot once popup is visible, then `getByRole('textbox', { name: 'Password' })` / `name: 'Confirm password'`. After successful signup, the user is logged in and a CONTINUE button replaces CONTINUE AS GUEST / REGISTER; new users have no saved payment method — trigger the Authorize.net Add-Payment-Method detour (see above).
**Source:** Pre-existing Phase 2 runbook.

---

### Bubble checkout: PROCEED TO CHECKOUT containing div may intercept pointer events

**Symptom:** Clicking PROCEED TO CHECKOUT by the button ref does nothing.
**Fix:** Click the inner text ref of the button's label instead.
**Source:** Pre-existing Phase 2 runbook.

---

### Jest calculator: FLAT discount capped at ticket gross in stored value

**Symptom:** FLAT1000 on a $200 order stores `Discount Amount` = $200, not $1000.
**Cause:** Bubble caps at `min(discount, grossTicketTotal)`. But the service-fee-absorb check (`addonGross - discount <= 0`) uses the **uncapped** discount value.
**Fix:** Don't "correct" this — `lib/orderCalculator.js` intentionally matches Bubble's behavior.
**Source:** Pre-existing Phase 2 runbook (Business Logic Findings).

### Jest calculator: percentage custom fees apply post-discount

**Symptom:** Expected tax based on gross, actual tax based on net-of-discount.
**Fix:** Formula: `(totalGrossTicketBase - discountTotal + totalServiceFee) × feeAmt`. Intentional — matches Bubble.
**Source:** Pre-existing Phase 2 runbook (Business Logic Findings).

### Jest calculator: $0.01 per-order custom fee rounding divergence

**Symptom:** Per-order custom fee assertion may be off by $0.01 in rare cases.
**Cause:** Bubble rounds tax per-addon then sums; our calculator sums base then rounds. Pure floating-point strategy divergence — not a business-logic error.
**Fix:** Accept as a known Jest failure. All reporting-daily aggregates still match exactly.
**Source:** Pre-existing Phase 2 runbook.

---

### Login flow: "Login" link only appears inside the tickets view

**Symptom:** No Login link visible on the event landing page.
**Cause:** The link is only rendered inside the tickets view.
**Fix:** Click "Tickets" on the landing view → URL becomes `?tab=tickets` → Login link appears top-right. Never navigate to a separate login page; all auth happens via the popup.
**Source:** Pre-existing Phase 2 runbook.

---

### playwright-cli eval: output wrapped in "### Result" — extract the block

**Symptom:** `pw("eval", ...)` stdout looks like raw text; comparisons against `"true"` or JSON fail.
**Cause:** `playwright-cli` wraps all eval output as `### Result\n<value>\n### Ran Playwright code\n...`.
**Fix:** Extract the Result block with a regex.
```js
const m = raw.match(/### Result\n([\s\S]*?)(?:\n### |$)/);
return m ? m[1].trim() : "";
```
Encapsulated in the `pwEval(js)` helper in `scripts/run-order-deterministic.js`.
**Source:** Order #3 deterministic run, 2026-04-22.

### playwright-cli run-code: silent failures — exit 0 even when Playwright throws

**Symptom:** `pw("run-code", ...)` returns exit 0 but the inner code threw a TimeoutError/selector-miss.
**Cause:** The CLI captures the inner error and embeds it as `"err": "..."` in the Result section; the process exit code doesn't reflect it.
**Fix:** Grep the stdout for `"err":` or `TimeoutError|Error:` and escalate.
```js
if (/"err"\s*:/.test(out) || /TimeoutError|Error:/.test(out)) {
  throw new Error("run-code reported an error:\n" + out);
}
```
Applied around the Authorize.net `run-code` call in `run-order-deterministic.js`.
**Source:** Order #3 deterministic run, 2026-04-22.

---

### Snapshots: don't save manual copies; refs die when the browser closes

**Symptom:** `orderN-stepN.yml` files accumulate in the repo; their `[ref=eXX]` values are session-scoped and useless once the browser closes.
**Fix:** `playwright-cli` auto-saves every snapshot to `.playwright-cli/page-<timestamp>.yml`. Read those directly if you need to reference a prior snapshot. Never write snapshot files to the repo root.
**Source:** Pre-existing Phase 2 runbook.

---

### UI transitions: wait for specific visible elements, not `waitForTimeout`

**Symptom:** Tests pass locally then flake on slower environments.
**Cause:** Fixed timeouts mask the underlying "element not yet rendered" race.
**Fix:** Anchor waits to unique heading/title elements of the target view. Use `page.locator(...).waitFor({ state: 'visible', timeout: 10000 })`. After a click that opens a popup, wait for the popup's heading before filling fields. After filling fields, take a **fresh snapshot** before querying refs — snapshot trees are stale after interactions.

Reference anchors:
- Login popup → `heading "Log in"`
- Signup popup → `heading "Create an 8Count profile"`
- Step 1 Registration → `heading "Registration"`
- Step 2 Payment → `heading "Payment"` (level 4)
- Authorize.net page → `#cardNum` visible (textbox names may not match, see Authorize.net field-names entry)
- Order success → `heading "Order Confirmed"` or `heading "Purchase Completed!"`
**Source:** Pre-existing Phase 2 runbook.

---

### Unique contact email per run

**Symptom:** Reconciliation picks the wrong order when the same email is reused across runs; Pending debris confuses the query.
**Cause:** The reconcile script queries by email; duplicates from previous runs match too.
**Fix:** Timestamp the email: `abhishek+gp-det-o<NN>-${Date.now()}@millionlabs.co.uk`. The Bubble field for this constraint is `Email Address` (**not** `Email Text` — that's a different field).
**Source:** Order #3 deterministic run, 2026-04-22.

---

### $0 orders: "COMPLETE ORDER 0$" button replaces PAY NOW

**Symptom:** No redirect to Authorize.net happens for a $0 order.
**Cause:** When the total hits $0, the checkout swaps PAY NOW for a "COMPLETE ORDER 0$" button — no payment step.
**Fix:** Detect the button text and click it directly. No Authorize.net handling.

Note: A 100% percentage discount (PCT100) zeroes ticket price but service fee + tax on service fee still apply — so the order may **not** be $0 (e.g. 3 Standard: $0 tickets + $6 SF + $0.39 tax = $6.39). A large flat discount (FLAT1000 on $200 tickets) zeroes the whole order including fees — true $0.
**Source:** Pre-existing Phase 2 runbook.

---

### Screenshots: take only when stuck, not on every step

**Symptom:** Runs slow down significantly when every step takes a screenshot.
**Fix:** Screenshot only after 2+ failed attempts on the same step, or when debugging element-overlap issues. Don't routinely screenshot during successful runs.
**Source:** Pre-existing Phase 2 runbook.
