---
name: Start Pipeline Server
description: Launch the Express pipeline dashboard on localhost:3000 and open it in a browser.
---

# Skill: Start Pipeline Server

## What this does
Starts the local Express server that serves the wireframes under `/` and the pipeline API under `/api/*`.

## Starting point
- Terminal in the repo root
- Port 3000 is free

## Steps
1. Run `npm run pipeline` in the terminal.
2. Wait for the log line "Pipeline server running at http://localhost:3000".
3. Open `http://localhost:3000/` in a browser.
4. Observe the redirect to `/dashboard.html`.
5. Assert the page header shows "Pipeline" with a Docs nav link and an "AJ" avatar on the right.
6. Assert the flow list shows cards for every entry in `flows/flows.json`.

## You'll know it worked when
- The dashboard renders at least one flow card with its name and phase badge
- Clicking the "+ New Recording" button navigates to `/new-recording.html`

## Variations
- Empty state — when `flows/flows.json` is empty or missing, the dashboard redirects or renders a "no flows yet" message (see `dashboard-empty.html`).

## Notes
- The server reads/writes `flows/flows.json` on every mutation, so concurrent pipeline and recording operations are safe for different flow names.
- Stop the server with Ctrl+C in the terminal.
