---
name: Run Refund Validation
description: Execute the Refund validation Jest suite against a specific transaction and order.
---

# Skill: Run Refund Validation

## What this does
Validates a refund across three entities: GYM_Transaction (the refund record), its GP_RefundItems list, and the linked PayIntent.

## Starting point
- Terminal in the repo root
- `.env` credentials present
- `testConfig.js` has `RUN_REFUND_TESTS = true`, `REFUND_TRANSACTION_ID`, and `REFUND_ORDER_ID`

## Steps
1. Open `testConfig.js`.
2. Set `RUN_REFUND_TESTS` to `true`.
3. Set `REFUND_TRANSACTION_ID` to the ID of the refund GYM_Transaction.
4. Set `REFUND_ORDER_ID` to the ID of the GP_Order that was refunded.
5. Run `npm test -- refund.test.js`.
6. Open `test-results.md` and locate the three refund describe blocks.

## You'll know it worked when
- All 13 tests pass across "GYM_Transaction refund validation", "GP_RefundItems validation", and "PayIntent refund validation"
- The report shows Transaction Net Amount equal to the sum of refund item amounts
- PayIntentStatus is "Success" and AmountPay equals the transaction Net Amount

## Variations
- `RUN_REFUND_TESTS = false` — suite is skipped entirely
- Transaction has no RefundItems — `beforeAll` throws and the suite is reported as failed
- PayIntent missing — the PayIntent describe block fails on `payIntent._id` lookup

## Notes
- Transaction type must be "Refund" and Credit/Debit must be "Credit" for all assertions to pass.
- The `recoverable?` flag on each refund item must be explicitly a boolean (not null or undefined).
