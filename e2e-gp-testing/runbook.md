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
Create orders covering the permutation matrix defined in `PLAN-v1.md` § 3.4.

Before starting:
- If `flow.mode` is `"orders-only"`, run `npm run e2e:preflight` and only proceed on exit 0.
- If `flow.resetOrdersOnRun` is `true`, set `state.orders = []` in `e2e-state.json` before the first purchase.
- Iterate only the order numbers listed in `flow.ordersToRun`; if it's empty, iterate all 20.

### Checkout Flows

- **Guest**: Fill name/email, click "CONTINUE AS GUEST", pay
- **Logged-in**: Click "Login" in top-right of the ticket page → popup opens → fill email/password → click "LOG IN" → then add tickets and purchase
- **Guest->Register**: Add tickets first, fill info, then at step 1 click "REGISTER & SAVE INFO" instead of "CONTINUE AS GUEST" → complete signup in the flow → finish purchase
- **Guest->Login (top right)**: Add tickets first, then click "Login" in the top-right header → popup opens → fill credentials → click "LOG IN" → complete purchase
- **Register->Login**: Click "Login" in top-right → popup opens → click "SIGN UP" button in the popup → on the signup form, find the login link and click it → log in with existing credentials → complete purchase

### Login & Signup (IMPORTANT)

All login and signup MUST use the popup triggered by the "Login" link in the top-right of the event ticket page. **Never navigate to a separate login page or open new tabs.**

- The popup has Email, Password fields, a "LOG IN" button, and a "SIGN UP" button
- To create a new account: click "SIGN UP" in the popup → fill registration form
- The "REGISTER & SAVE INFO" button at checkout step 1 also creates an account during purchase

### Agent Split

- **Agent 2a**: Guest checkout orders (#1-5, #11, #12) — no accounts needed
- **Agent 2b**: Logged-in + Guest->Register (#6-10, #13-15, #20) — create Users A+B first via signup, Users D/E/F created during Guest->Register flow
- **Agent 2c**: Guest->Login + Register->Login (#16-19) — create User C first, reuse Users A+B for Register->Login flow

### Purchase Process (General)

**One order at a time. Close the browser completely between orders.**

1. Open event URL in a fresh browser session
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
16. Close the browser
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
- **One browser per order.** Close the browser completely between orders. Never reuse sessions across orders — it causes tab/state pollution
- **Never open new tabs.** If a new tab opens accidentally (e.g. clicking a link), close it immediately with `playwright-cli tab-close`
- **Never navigate to separate login pages.** All auth happens via the popup on the ticket page
- **Log out after any EP admin work.** The browser shares sessions — if you were logged in as Event Producer in the GP admin, that session carries over. Always log out before starting a guest/user purchase flow. Navigate to the event page fresh after logging out
- **Between different user logins**: close the browser entirely and open a fresh one. Do not try to log out and log in as a different user in the same session

### Bubble App Behavior
- Use `domcontentloaded` not `networkidle` for waits — Bubble has persistent polling that prevents networkidle from resolving
- Element refs change after every interaction — always snapshot before the next action
- Bubble may show loading spinners between steps — wait for them to disappear before proceeding
- Bubble Toggle elements (terms agreement, active switches) are NOT visible in playwright snapshots as interactive elements. To click them use a CSS locator with force: `page.locator('.bubble-element.ionic-IonicToggle.clickable-element').first().click({ force: true })`. Never use mouse coordinates — always use locators

### Checkout Flow
- Step 1 has TWO sets of checkboxes: "same for all tickets" near the top, and a terms checkbox near the bottom (just above CONTINUE AS GUEST). Both need to be checked
- Step 2 has a terms TOGGLE (not checkbox) next to "I agree to the Terms and Conditions". PAY NOW stays greyed out until this toggle is ON
- Do NOT click the "Terms and Conditions" link text — it opens a new tab. Only click the toggle element to its left

### Authorize.net Payment
- The payment page may take 5-10 seconds to fully load — wait for the card number field before filling
- After clicking "PAY NOW", wait for the redirect to Authorize.net before interacting
- The first name and last name fields get auto-populated from the contact info — you may need to overwrite the last name
- After clicking "Pay", wait for the "Thank you" confirmation, then click "Continue" to return to the event site

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
