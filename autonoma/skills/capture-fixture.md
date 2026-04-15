---
name: Capture Fixture
description: Fetch real Bubble records for a flow and save them into a per-flow fixture file for offline replay.
---

# Skill: Capture Fixture

## What this does
Uses the Verify Fixture screen to fetch Bubble records by type and ID (one at a time) and then saves the entire collection into `fixtures/<flowName>.fixture.json` for offline test reruns.

## Starting point
- Pipeline server running at `http://localhost:3000`
- `.env` has valid Bubble credentials (the server uses `bubbleClient.getThing` internally)
- You have the Bubble type name and record ID for each record you want to capture

## Steps
1. Open `/verify-fixture.html`.
2. Enter the flow name at the top of the page.
3. In the fetch row, enter the Bubble type (e.g. `gp_order`) and the record ID.
4. Click "Fetch".
5. Wait for the record JSON to render in the preview panel.
6. Repeat steps 3-5 for every record the flow needs.
7. Click "Save Fixture".
8. Confirm the success message appears.

## You'll know it worked when
- `fixtures/<flowName>.fixture.json` exists on disk
- The file contains a `records` array with one entry per fetched record
- `flows/flows.json` shows the flow phase as "done"

## Variations
- Invalid type name — the server returns the Bubble 404 message and the preview panel shows the error.
- Flow name missing — "Save Fixture" returns 400 and nothing is written.

## Notes
- The type name passed to `/api/fetch-bubble` is lowercased and whitespace-stripped before the Bubble request.
- `GET /api/get-fixture?flow=<name>` returns the saved fixture JSON for reloading into the screen.
