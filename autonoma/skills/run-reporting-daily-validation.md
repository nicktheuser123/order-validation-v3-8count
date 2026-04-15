---
name: Run Reporting Daily Validation
description: Execute the Reporting Daily Jest suite to cross-validate the three daily reporting record types.
---

# Skill: Run Reporting Daily Validation

## What this does
Uses the seed ORDER_ID to derive (Date Label, Event), then cross-validates every GP_ReportingDaily, GP_ReportingTicketTypeDaily, and GP_ReportingCustomFeeDaily record for that pair by summing across every paid order on the date.

## Starting point
- Terminal in the repo root
- `.env` credentials present
- `testConfig.js` has `RUN_REPORTING_DAILY_TESTS = true` and a valid `ORDER_ID`

## Steps
1. Open `testConfig.js` and confirm `ORDER_ID` references an order whose date has reporting records in Bubble.
2. Confirm `RUN_REPORTING_DAILY_TESTS` is `true`.
3. Run `npm test -- reportingDaily.test.js`.
4. Wait for the suite to finish (allow up to 120 seconds for fetching).
5. Open `test-results.md`.
6. Assert all three describe blocks pass: "GP_ReportingDaily validation", "GP_ReportingTicketTypeDaily validation", "GP_ReportingCustomFeeDaily validation".

## You'll know it worked when
- Jest prints all suite describe blocks as PASS
- `test-results.md` shows calculated totals equal to reported totals for Gross Sales, Total Sales, Net Revenue, Total Tickets Sold, service/processing fees, discounts, and refund adjustments

## Variations
- No GP_ReportingDaily rows — `beforeAll` throws "No GP_ReportingDaily records for date=..."
- No paid orders on the date — `beforeAll` throws "No paid orders for date=..."
- Event has voids — Total Tickets Voided and Total Tickets Voided Amount are asserted to match (default 0 in test data)

## Notes
- Raw refund items cannot be fetched via the Data API on GP_Order, so ticket-type daily Total Refunds is treated as authoritative and feeds the order-level refund assertions.
