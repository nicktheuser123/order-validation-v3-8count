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
12. Toggle "I agree to the Terms and Conditions" — this is a Bubble ionic toggle. Click it with: `page.locator('.bubble-element.ionic-IonicToggle.clickable-element').first().click({ force: true })`. Wait 1-2 seconds after the page transitions to Step 2 before attempting this — the toggle element needs time to render
13. Click "PAY NOW" — the button is greyed out until the toggle is ON
14. **Authorize.net page**: Wait for the payment form to load (~5-10s). Fill: Card Number, Exp Date, Card Code, Last Name, Zip, Address, City, State. Click "Pay" → wait for confirmation → click "Continue"
15. **Success** = "Purchase Completed!" heading on the return page
16. `playwright-cli -s=gp-order-NN close` then `playwright-cli -s=gp-order-NN delete-data`
17. Verify via Bubble API and record the order ID in `e2e-state.json`

### For $0 Orders (#11, #12, #19, #20)

When a 100% or large flat discount makes the total $0, the payment step may be entirely skipped. The order may complete immediately after clicking "PAY NOW" or equivalent. Handle this gracefully.

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

## Known Pitfalls & Lessons Learned

_Updated after each run. Add issues encountered and how to avoid them._

### Waiting for UI Transitions (CRITICAL)
- **Never use `waitForTimeout` as your primary wait strategy** for UI transitions. Timeouts are unreliable — the popup may take longer than expected, or the click may not register immediately
- **Always wait for a specific element to be visible** as proof the transition completed. Use `page.locator(...).waitFor({ state: 'visible', timeout: 10000 })` before interacting
- **Anchor waits to heading/title elements** that are unique to the target view:
  - Login popup → `heading "Log in"`
  - Signup popup → `heading "Create an 8Count profile"`
  - Step 1 Registration → `heading "Registration"`
  - Step 2 Payment → `heading "Payment"` (level 4)
  - Authorize.net page → `textbox "Card Number"`
  - Order success → `heading "Order Confirmed"` OR `heading "Purchase Completed!"`
- After a click that opens a popup, wait for the popup's heading before trying to fill its fields
- After filling fields in a popup, take a fresh snapshot before querying refs — the snapshot tree is stale after interactions

### Browser Session Management
- **Every command uses `-s=<name>`.** The default (unnamed) session is forbidden during Phase 2. Order workers use `-s=gp-order-NN`; setup agents use `-s=gp-setup-{A,B,C}`. Two agents sharing the default session will land on the same Bubble cookies, the last-created order will echo into every tab, and follow-up purchases will be blocked by "in-progress order" checks
- **One named session per order.** Close + `delete-data` the session when the order finishes. Never reuse one `gp-order-NN` across two orders
- **Never open new tabs.** If a new tab opens accidentally (e.g. clicking a link), close it immediately with `playwright-cli -s=gp-order-NN tab-close`
- **Never navigate to separate login pages.** All auth happens via the popup on the ticket page
- **Log out after any EP admin work** performed in the same named session. (Normally this is impossible under the contract — EP admin and order work live in different session names. If they ever share, log out before reusing.)
- **Between different user logins within one agent's queue** (e.g. Owner-A rolling from order #6 to order #7): always close the previous `gp-order-NN` session fully, then open a new `gp-order-MM` with the next order's number. Do not log out and log in within one named session

### Snapshot Hygiene
- **Do not save manual snapshot copies.** `playwright-cli` already auto-saves every snapshot to `.playwright-cli/page-<timestamp>.yml`. Never write files like `orderN-stepN.yml` to the repo root — the accessibility-tree refs inside (`[ref=eXX]`) are session-scoped and die the moment the browser closes, so these files have no replay value and just pollute the tree
- If you genuinely need to capture a specific snapshot for later reference, read `.playwright-cli/page-<timestamp>.yml` directly instead of duplicating it

### Bubble App Behavior
- Use `domcontentloaded` not `networkidle` for waits — Bubble has persistent polling that prevents networkidle from resolving
- Element refs change after every interaction — always snapshot before the next action
- Bubble may show loading spinners between steps — wait for them to disappear before proceeding

### Step-2 Ionic Terms Toggle (CRITICAL — PAY NOW silently no-ops until this is ON)

The Step-2 "I agree to the Terms and Conditions" is a Bubble ionic toggle. **Force-clicks on the outer `.bubble-element.ionic-IonicToggle.clickable-element` div often LOOK like they work but leave the inner `<input type=checkbox>` at `checked=false`, and PAY NOW silently does nothing.** Multiple workers in past runs wasted retries on this.

Reliable strategies (try in this order):

1. **Click the inner `<label>` element** — most reliable single-shot pattern:
   ```js
   container.querySelector('label').click()
   ```
2. **Click the inner `input[type=checkbox]` directly** via JS.
3. **Playwright locator force-click**: `page.locator('.bubble-element.ionic-IonicToggle.clickable-element').first().click({ force: true })`.
4. **Last resort**: real mouse events at the toggle's bounding-rect center — `page.mouse.move(x,y)` → `mousedown` → `mouseup`.

**ALWAYS verify the inner checkbox state after clicking**: `input.checked === true` BEFORE clicking PAY NOW. If it didn't flip, PAY NOW is inert.

**After the Authorize.net Add-Payment-Method detour (see below), the toggle RESETS** — re-toggle before the second PAY NOW attempt.

Never click the "Terms and Conditions" text link next to the toggle — it opens a new tab.

### Checkout Flow
- Step 1 has TWO sets of checkboxes: "same for all tickets" near the top, and a terms checkbox near the bottom (just above CONTINUE AS GUEST). Both need to be checked
- Step 2 has the terms TOGGLE above (not a checkbox). Use the strategies in the section above. PAY NOW stays greyed out until the toggle's inner checkbox is actually `checked=true`
- **PROCEED TO CHECKOUT click**: the containing `<div>` sometimes intercepts pointer events. If the button's own ref doesn't click, try clicking the inner text ref of the button's label instead

### Authorize.net Payment (regular flow)
- The payment page may take 5-10 seconds to fully load — wait for the `textbox "Card Number"` before filling
- After clicking "PAY NOW", wait for the redirect to Authorize.net before interacting
- **`fill()` does NOT trigger Authorize.net's Angular validation.** Fields look populated but the Pay button stays disabled. Use `pressSequentially` for Card Number, Exp Date, and CVV, then Tab to blur — that triggers validation and enables Pay. This is the #1 cause of "stuck Pay button" reports.
- **Exp Date mask**: type digits only (e.g. `0427`). The mask auto-inserts the slash to display `04/27`. Typing the slash yourself breaks validation.
- First/Last name auto-populate from Step-1 contact info — you may need to overwrite the last name to match `settings.payment.lastName`
- After clicking "Pay", wait for "Thank you" confirmation, then click "Continue" to return to the event site

### Authorize.net "Add Payment Method" detour (first order per logged-in user)

Any User A/B/C/D/E/F on their FIRST order of a run has no saved payment method (preflight + the test-user deletion step wipe state between runs). The flow is different from a pure-guest Authorize.net redirect:

1. On Step-2, clicking PAY NOW with no saved card silently no-ops — do **not** loop clicking it; switch to the detour below.
2. Click **"+ Add Payment Method"** on Step-2. This redirects to Authorize.net's standalone `customer/addPayment` page (a different page from the regular payment redirect).
3. Fill card + billing address there and click **SAVE** (not Pay). Use `pressSequentially` for the card fields — `fill()` leaves SAVE disabled.
4. SAVE returns you to Step-2 with the card now saved to the user's profile.
5. **The ionic terms toggle RESETS during this round-trip** — re-toggle it (see the toggle section above) before the second PAY NOW.
6. Click PAY NOW. The card is on file now, so the order completes immediately with NO second Authorize.net redirect — you land straight on "Order Confirmed".
7. All subsequent orders for that user reuse the saved card; no detour needed.

Note: on rare occasions the SAVE button on Authorize.net stays disabled even after `pressSequentially` — clicking Cancel has been observed to still persist the card server-side (the next Step-2 shows the card on file). Prefer getting SAVE to enable; only fall back to Cancel if you've already retried and Step-2 shows the card anyway.

### Currency and Percentage Input Fields
- Bubble's currency input fields use a mask. To set a price: first clear the field using the native value setter (`el.value = ''` with input/change events dispatched), then use `pressSequentially` to type the digits. Do not use `fill()` alone — it may produce wrong values
- Bubble's percentage fields store values as decimals (0.20 = 20%). The GP admin UI percentage inputs can be unreliable — verify values via the Bubble Data API after creation and patch with `curl -X PATCH` if needed

### Event Setup
- Google Places autocomplete (venue location) requires `pressSequentially` with delay, not `fill`
- Select2 dropdowns (multi-select like scoresheet classes): after the first selection, the textbox ref changes — use `input[type="search"]` for subsequent selections
- For date pickers: use `.first()` for start date calendar controls and `.last()` for end date
- The "Cart Limit" field on ticket creation is required (1-10) — if left at 0, creation fails
- The "Scan Limit" dropdown on ticket creation is required — select "Single Use" or another option
- Custom fee creation: click the "+" button near "Custom Fees" heading in settings. It opens a popup form. The info (?) button opens a help popup instead — don't confuse them
- Promotion percentage values may not save correctly via the UI. After creating percentage promotions, verify via `curl` to the Bubble API and patch `DiscountPct` if needed
- **Promotions must be assigned to ticket types.** After creating promotions, edit EACH ticket type → click "Assigned Promotions" tab → check all applicable promotions → Save. Without this, promo codes will show "Invalid coupon code for this event" at checkout
- The "Assigned Promotions" tab shows a list with checkboxes. Use the select-all checkbox at the top to assign all promos at once
- Order of setup matters: create promotions FIRST, then create ticket types and assign promos during creation (or edit tickets after to assign). If tickets are created before promos, you must go back and edit each ticket to assign

### $0 Orders
- When a discount makes the total $0.00, the checkout shows a "COMPLETE ORDER 0$" button instead of "PAY NOW" — no redirect to Authorize.net. Just click it
- A 100% percentage discount (PCT100) zeroes out ticket price but service fee + tax on service fee still apply — so the order may NOT be $0 (e.g. 3 Standard tickets: $0 tickets + $6 SF + $0.39 tax = $6.39)
- A large flat discount (FLAT1000 on $200 tickets) fully zeroes the order including fees — true $0

### Guest→Register (REGISTER & SAVE INFO) Flow
- After clicking "REGISTER & SAVE INFO", a signup popup appears with Email, Password, Confirm password
- **The popup's Email field starts EMPTY** even though you filled an email in the checkout form — you must fill it again in the popup
- The popup's Email field conflicts with checkout form email fields. Target it using: `page.locator('input[placeholder="Email"]').last()` to get the popup's field
- The popup's Password fields can be targeted by snapshot ref (getByRole textbox 'Password' and 'Confirm password') — but ONLY after taking a fresh snapshot once the popup is visible
- After successful signup, the user is logged in and the CONTINUE button appears (replacing CONTINUE AS GUEST / REGISTER). Cart is preserved
- New registered users have no saved payment method — must click "+ Add Payment Method" on Step 2

### Screenshots for Debugging
- Take screenshots only when stuck (after 2+ failed attempts on the same step)
- Do not screenshot on every step — it slows down the flow
- Screenshots are useful for: identifying unexpected UI state, finding elements not in the snapshot tree, debugging element overlap issues

### Business Logic Findings (from first full run)

These calculation rules were discovered via Jest test failures and verified against Bubble's actual stored values. The `lib/orderCalculator.js` was updated to match. Do not "fix" these again — they are intentional:

1. **FLAT discount cap**: `Discount Amount` stored value is capped at ticket gross (`min(discount, grossTicketTotal)`). However the service-fee-absorb check (`addonGross - discount <= 0`) uses the UNCAPPED discount value
2. **Percentage custom fees apply post-discount**: `(totalGrossTicketBase - discountTotal + totalServiceFee) × feeAmt`, not pre-discount

### Known Test Failures (non-actionable)

- Per-order custom fee assertion may be off by $0.01 in rare cases: Bubble rounds tax per-addon then sums; our calculator sums base then rounds. Pure floating-point strategy divergence — not a business logic error. All reporting-daily aggregates still match exactly
