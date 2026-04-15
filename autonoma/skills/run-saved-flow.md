---
name: Run a Saved Flow
description: Execute an already-generated parameterized .flow.js and watch the streaming log output.
---

# Skill: Run a Saved Flow

## What this does
Triggers the pipeline server to spawn `node flows/<flowName>.flow.js`, which runs the flow against a live browser using the values in its `.config.json`, and streams stdout/stderr into a log modal on the dashboard.

## Starting point
- Pipeline server running at `http://localhost:3000`
- At least one flow with phase "done" and a corresponding `flows/<name>.flow.js` file
- The flow's `.config.json` has the parameter values (e.g. loginUrl, email, password)

## Steps
1. Open `/dashboard.html`.
2. Locate the flow card for the desired flow (e.g. "login", "create-event").
3. Click the green "Run" button on the card.
4. Watch the run modal open with title "Running flow…" and a dark log pane.
5. Observe log lines stream in as the flow executes.
6. Wait for the status pill to change from "Running" (indigo) to "Passed" (green) or "Failed" (red).
7. Review the final log output to confirm each step succeeded.

## You'll know it worked when
- The status pill shows "Passed"
- The log ends with `[exit 0]`
- `flows/<flowName>.run.log` on disk contains the same content

## Variations
- No `.flow.js` exists — the Run button is hidden; generate the flow via the pipeline first.
- Flow fails mid-run — status pill becomes "Failed" and the log shows the Playwright error.

## Notes
- A `.running` lock file is present on disk while the process is alive.
- Each run overwrites the previous `.run.log` for that flow.
