---
name: Record New Flow
description: Start a Playwright codegen session for a named flow and verify the raw recording is saved.
---

# Skill: Record New Flow

## What this does
Launches Playwright codegen against a base URL so a user can click through a flow while Playwright captures selectors and actions into a .js file under `recordings/`.

## Starting point
- Pipeline server running at `http://localhost:3000`
- Browser open at `/dashboard.html`
- You know the flow name you want to create and the URL to start recording at

## Steps
1. Click "+ New Recording" on the dashboard.
2. Enter a flow name (e.g. "my-flow") in the flow name field.
3. Enter the base URL (e.g. `https://8countlogin.com/version-81rkv`).
4. Click the "Start Recording" button.
5. Watch the Playwright Inspector window open alongside a new browser window.
6. Perform the flow actions in the browser (click, type, navigate).
7. Close the Inspector window when done.
8. Return to the dashboard and wait for the new flow card to appear with phase badge "ids".

## You'll know it worked when
- `recordings/<flow>.js` exists and contains at least one `await page.` line
- The flow card on the dashboard shows phase "ids" (advanced automatically from "recording")
- `flows/flows.json` contains a new entry with `"phase": "ids"`

## Variations
- Port 3000 unavailable — the pipeline server fails to start; free the port and retry.
- Closing the browser before any action — recording file is empty; status endpoint keeps returning `{ ready: false }`.

## Notes
- The codegen process is spawned detached with its PID tracked in `recordings/<flow>.codegen.pid`.
- The dashboard polls `/api/recording-status` to detect completion.
