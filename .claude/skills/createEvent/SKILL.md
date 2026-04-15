---
name: createEvent
description: Creates a new event in the 8count app via browser automation. Pass event name, start date, and end date as arguments. Usage: /createEvent "My Event Name" 7/16/2026 7/18/2026
allowed-tools: Bash(npx playwright*), Bash(npm run flow*), Bash(node -e*), Read, Edit, Bash(playwright-cli:*)
---

# createEvent

Creates a new event in the 8count Event Producer portal. Uses a recorded flow first (fast, zero tokens), falls back to playwright-cli if the flow breaks, then self-heals the flow file.

## Usage

```
/createEvent <eventName> <startDate> <endDate>
```

**Arguments (parsed from ARGUMENTS string):**
- `eventName` (required) — Name of the event. If quoted, treat the quoted string as one argument.
- `startDate` (required) — Start date in `M/DD/YYYY` format (e.g. `7/16/2026`)
- `endDate` (required) — End date in `M/DD/YYYY` format (e.g. `7/18/2026`)

**Examples:**
```
/createEvent "Summer Championship 2026" 7/16/2026 7/18/2026
/createEvent "Fall Classic" 10/01/2026 10/03/2026
```

## Execution order

### Phase 1: Try the recorded flow (fast, zero tokens)

1. Parse the ARGUMENTS string to extract eventName, startDate, and endDate. The event name may be quoted. The dates are the last two space-separated tokens.

2. Write dynamic params to the config file:

```bash
node -e "
const fs = require('fs');
const c = JSON.parse(fs.readFileSync('./flows/create-event.config.json', 'utf-8'));
c.eventName = '<eventName>';
c.startDate = '<startDate>';
c.endDate = '<endDate>';
fs.writeFileSync('./flows/create-event.config.json', JSON.stringify(c, null, 2) + '\n');
"
```

3. Run the flow:

```bash
npm run flow create-event
```

4. **If exit code is 0** → Report success to user. Done.

5. **If exit code is non-zero** → Continue to Phase 2.

### Phase 2: Fall back to playwright-cli (Claude-driven)

1. Read the failure context:
   - Read `test-results/create-event-failure.json` to understand what failed (which step, which selector, error message)
   - Read `test-results/create-event-failure.png` screenshot to see the page state

2. Log to user: `"Flow failed at step N (<step name>). Falling back to playwright-cli..."`

3. Open the browser with playwright-cli:
   - If the failure was at step 1 (Login) or step 2 (Navigate), start from scratch:
     ```bash
     playwright-cli open "https://8countlogin.com/version-81rkv/?nav=login" --browser=chrome --headed
     ```
   - If the failure was at a later step, the browser is already closed. Start from scratch.

4. Complete the event creation using the step-by-step procedure below, starting from the beginning.

5. After the event is created successfully, continue to Phase 3.

### Phase 3: Self-heal the flow file

1. Identify which selector(s) broke from `test-results/create-event-failure.json`
2. Read `flows/create-event.flow.js` to find the broken line
3. Use the playwright-cli snapshot to find the correct selector for the element
4. Edit `flows/create-event.flow.js` with the fixed selector
5. Report to user: `"Flow completed via fallback. Updated create-event.flow.js line X: changed '<old selector>' → '<new selector>'"`

Next time the flow runs, it uses the fixed selector automatically.

## Step-by-step procedure (Phase 2 fallback)

### Static defaults (used for every event)

| Field | Value |
|-------|-------|
| Login URL | `https://8countlogin.com/version-81rkv/?nav=login` |
| Email | `abhishek+ep24.6@millionlabs.co.uk` |
| Password | `123` |
| Scoresheet Classes | All 7: OCS, DE Spirit, IASF, OSF, Rental, United, YCADA |
| Max Teams | `55` |
| Venue Location | `new york` (Google Places autocomplete) |
| Cadence (mins) | `5` |
| Event Description | `Test event created via automation` |
| Venue Name | `ren` |
| Payment Terms | `Deposit/Partial` |
| Deposit Amount | `25` |

### 1. Open headed browser and login

```bash
playwright-cli open "https://8countlogin.com/version-81rkv/?nav=login" --browser=chrome --headed
```

After page loads, take a snapshot. If there is a cookie banner ("Continue..." button), click it. Then:

```bash
playwright-cli fill <email-ref> "abhishek+ep24.6@millionlabs.co.uk"
playwright-cli fill <password-ref> "123"
playwright-cli click <login-button-ref>
```

Wait for redirect to eventproducer page (sleep 5 + snapshot).

### 2. Navigate to Events and click Create Event

```bash
playwright-cli goto "https://8countlogin.com/version-81rkv/eventproducer?debug_mode=true"
```

Take a snapshot, find the "Events" heading in the sidebar and click it. Then find and click the "Create event" heading/button.

### 3. Fill event name

```bash
playwright-cli fill <event-name-ref> "<eventName>"
```

### 4. Select all 7 scoresheet classes

This uses a select2 multi-dropdown. The workflow is:
1. Click the `textbox "Scoresheet Classes"` to open the dropdown
2. Take a snapshot — the treeitems will appear
3. Click `treeitem "OCS"`
4. For remaining items (DE Spirit, IASF, OSF, Rental, United, YCADA):
   - Click `input[type="search"]` (the textbox ref changes after first selection)
   - Click the corresponding treeitem

Best done in a single `run-code` block after the first selection:

```bash
playwright-cli click <scoresheet-textbox-ref>
# snapshot to get treeitem refs
playwright-cli click <OCS-treeitem-ref>
playwright-cli run-code "async page => {
  const items = ['DE Spirit', 'IASF', 'OSF', 'Rental', 'United', 'YCADA'];
  for (const item of items) {
    await page.locator('input[type=\"search\"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('treeitem', { name: item }).click();
    await page.waitForTimeout(500);
  }
}"
```

### 5. Fill Max Teams

```bash
playwright-cli fill <max-teams-ref> "55"
```

### 6. Fill venue location

```bash
playwright-cli fill <venue-location-ref> "new york"
```

Then trigger Google Places autocomplete by typing slowly and selecting the first suggestion:

```bash
playwright-cli run-code "async page => {
  const input = page.getByRole('textbox', { name: 'Enter your venue location (' });
  await input.click();
  await input.fill('');
  await page.waitForTimeout(300);
  await input.pressSequentially('new york', { delay: 100 });
  await page.waitForTimeout(2000);
  const pacItem = page.locator('.pac-item').first();
  const count = await page.locator('.pac-item').count();
  if (count > 0) {
    await pacItem.click();
  } else {
    await input.press('ArrowDown');
    await page.waitForTimeout(200);
    await input.press('Enter');
  }
  await page.waitForTimeout(1000);
}"
```

### 7. Set start and end dates

Dates are in `M/DD/YYYY` format. You need to:

1. Click the Start Date textbox to open its calendar
2. Snapshot to find the "Next month" / "Previous month" buttons
3. Calculate how many months to navigate from the current month to the target month
4. Click "Next month" (`.first()` for start date calendar) the right number of times
5. Click the gridcell matching the start date (e.g. `gridcell "7/16/2026"`)
6. Repeat for End Date using `.last()` for the navigation buttons and gridcells

**Date navigation formula:**
```
monthsToNavigate = (targetYear - currentYear) * 12 + (targetMonth - currentMonth)
```
Current month at page load is always the current calendar month.

### 8. Fill cadence

```bash
playwright-cli fill <cadence-ref> "5"
```

### 9. Fill event description

```bash
playwright-cli fill <description-ref> "Test event created via automation"
```

### 10. Fill venue name

```bash
playwright-cli fill <venue-name-ref> "ren"
```

### 11. Select payment terms and deposit

```bash
playwright-cli select <payment-terms-ref> "Deposit/Partial"
```

Snapshot to find the deposit amount field that appears, then:

```bash
playwright-cli fill <deposit-amount-ref> "25"
```

### 12. Create the event

```bash
playwright-cli click <create-event-button-ref>
```

The page should redirect to `?v=events`. Verify by taking a snapshot and confirming the event name appears in the list.

### 13. Report result

Tell the user the event was created with the name, dates, and that it's unpublished. Leave the browser open.

## Important notes

- Always use `--headed` so the user can see the flow
- Use `resize 1920 1080` after opening if elements overlap
- Refs change after every interaction — always snapshot before clicking
- The select2 dropdown textbox name changes from `"Scoresheet Classes"` to unnamed after first selection — use `input[type="search"]` instead
- Google Places autocomplete needs `pressSequentially` with delay, not `fill`
- Calendar navigation: use `.first()` for start date buttons, `.last()` for end date buttons
- If a click times out, snapshot and retry with the new ref
