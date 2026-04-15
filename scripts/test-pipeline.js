const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const resultsDir = path.join(ROOT, "test-results");
const resultsPath = path.join(resultsDir, "pipeline-e2e.json");
const logPath = path.join(resultsDir, "pipeline-e2e.log");
const recordingPath = path.join(ROOT, "recordings", "e2e-login-test.js");

if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir);

// Remove stale results
if (fs.existsSync(resultsPath)) fs.unlinkSync(resultsPath);

// Check if recording already exists (skip browser interaction on rerun)
const hasRecording =
  fs.existsSync(recordingPath) &&
  (fs.readFileSync(recordingPath, "utf8").match(/await page\./g) || []).length > 0;

console.log("[test-pipeline] Starting full E2E pipeline test…");
if (hasRecording) {
  console.log("[test-pipeline] Recording already exists — will reuse it (skipping Phases 1-3)");
} else {
  console.log("[test-pipeline] No recording found — will create one from scratch");
}

const prompt = `You are running a full end-to-end test of the Pipeline app.
The pipeline server is at http://localhost:3000.
You have access to playwright-cli for browser automation.

RECORDING_EXISTS=${hasRecording}

${hasRecording ? `## REUSE PATH — Recording already exists

The recording file recordings/e2e-login-test.js already exists. Skip the browser interaction with 8count and go straight to registering the flow and processing it.

### Phase 4 — Register flow and trigger pipeline processing

1. First, clean up any previous e2e-login-test state:
   - Read flows/flows.json. If "e2e-login-test" already exists AND has phase "done", AND flows/e2e-login-test.flow.js exists, skip straight to Phase 5 (run the flow).
   - Otherwise, continue below.

2. Register the flow with the pipeline:
   curl -s -X POST http://localhost:3000/api/recording-start \\
     -H "Content-Type: application/json" \\
     -d '{"flowName":"e2e-login-test","baseUrl":"https://8countlogin.com/version-81rkv"}'

3. The pipeline spawns codegen — kill it immediately:
   - Read the PID from recordings/e2e-login-test.codegen.pid (wait a second for it to appear)
   - Kill the process: kill <pid>
   - Remove the PID file: rm recordings/e2e-login-test.codegen.pid

4. The pipeline polls recording-status every 2s. Since the recording file already exists and codegen is dead, it will detect it and advance to "ids" phase, then auto-trigger verification.

5. Open the pipeline UI to watch progress:
   playwright-cli open http://localhost:3000/new-recording.html?flow=e2e-login-test

6. Wait for the popover to appear. Take snapshots every 5 seconds. The popover appears when:
   - The pipeline detects the recording (shows "Recording saved")
   - Then triggers AI verification (shows "Analyzing with Claude…")
   - Then verification completes (popover shows result)
   This can take 1-3 minutes. Be patient — keep polling with snapshots.

7. When the popover appears, click the continue/generate button.

8. If the button says "Continue to IDs" — click it, then on the next page click through to generate the flow. If it says "Generate Flow & Continue" — click it directly.

9. Wait for generation to complete (button may show "Generating flow…").

10. After generation, you should be redirected to the dashboard. If not, navigate to http://localhost:3000/dashboard.html

Proceed to Phase 5.` : `## FRESH PATH — Create recording from scratch

### Phase 1 — Start recording via pipeline UI

1. Open the pipeline UI:
   playwright-cli open http://localhost:3000/dashboard.html

2. Take a snapshot to see the current state.

3. Click the "+ New Recording" link to go to new-recording.html.

4. Take a snapshot. Fill in the form:
   - Flow name: e2e-login-test
   - Base URL: https://8countlogin.com/version-81rkv

5. Click "Start Recording".

6. Take a snapshot — verify the status shows "Recording e2e-login-test" and the button is disabled.

### Phase 2 — Interact with the 8count app

The pipeline spawned Playwright codegen which opened a separate browser. We can't control that browser, so we'll kill it and do the interaction ourselves.

7. Wait 3 seconds for codegen to spawn, then:
   - Read the PID file: cat recordings/e2e-login-test.codegen.pid
   - Kill the codegen process: kill <pid>
   - Remove the PID file: rm recordings/e2e-login-test.codegen.pid

8. Open a SECOND browser session to the 8count app:
   playwright-cli -s=app open https://8countlogin.com/version-81rkv

9. Take a snapshot. Interact with the 8count login page:
   - Look for a cookie consent "Continue..." button — click it if visible
   - Click the "Log In" button (switches to login form)
   - Fill email: abhishek+ep24.6@millionlabs.co.uk
   - Fill password: 123
   - Click "Log In" to submit
   - Wait for the page to navigate to /eventproducer (take snapshots to verify)

10. Take a final snapshot — verify you see "Producer Dashboard" or similar.

11. Close the app browser session:
    playwright-cli -s=app close

### Phase 3 — Write the recording file

12. Write the recording file at recordings/e2e-login-test.js in Playwright codegen format.
    Base it on the ACTUAL actions you performed in Phase 2. The format is:

    import { test, expect } from '@playwright/test';

    test('test', async ({ page }) => {
      await page.goto('https://8countlogin.com/version-81rkv');
      await page.getByRole('button', { name: 'Continue...' }).click();
      await page.getByRole('button', { name: 'Log In' }).click();
      await page.getByRole('textbox', { name: 'Enter email' }).fill('abhishek+ep24.6@millionlabs.co.uk');
      await page.getByRole('textbox', { name: 'Enter password' }).fill('123');
      await page.getByRole('button', { name: 'Log In' }).click();
      await page.waitForURL('**/eventproducer**');
    });

    Adjust the selectors if your snapshots showed different element names.

### Phase 4 — Pipeline processes the recording

13. Switch back to the pipeline browser (default session — not -s=app).
    Take a snapshot on the new-recording.html page.

14. The pipeline polls recording-status every 2 seconds. Since the recording file now exists
    and codegen is dead, it will detect the recording and trigger AI verification automatically.

15. Wait for the popover to appear. Take snapshots every 5 seconds. This can take 1-3 minutes
    because the pipeline runs AI verification (Claude analyzes and stabilizes the recording).
    Be patient — keep polling with snapshots.

16. When the popover appears, read what it says and click the continue/generate button.
    - If it says "Continue to IDs" — click it, then proceed through the stabilization page
    - If it says "Generate Flow & Continue" — click it directly

17. Wait for flow generation to complete.

18. After generation, navigate to http://localhost:3000/dashboard.html`}

### Phase 5 — Run the generated flow from dashboard

1. Open http://localhost:3000/dashboard.html (if not already there).
   playwright-cli goto http://localhost:3000/dashboard.html

2. Take a snapshot. Look for the "e2e-login-test" flow card.
   - It should show a "Done" badge (green)
   - It should have a "Run" button

3. Click the Run button on the "e2e-login-test" card.

4. Verify the run modal appears:
   - Title should say "Running: e2e-login-test"
   - A "Running" pill should be visible

5. Wait for the run to complete. Take snapshots every 5 seconds (up to 120 seconds).
   The modal will update when done:
   - "Passed" (green pill) = success
   - "Failed" (red pill) = failure

6. Record the final status and any log output visible in the modal.

7. Close the modal by clicking the x button.

### Phase 6 — Write results

Write the results JSON to test-results/pipeline-e2e.json:

{
  "runAt": "<ISO timestamp>",
  "recordingReused": ${hasRecording},
  "phases": {
    "recording": { "passed": true/false, "notes": "..." },
    "appInteraction": { "passed": true/false, "notes": "..." },
    "verification": { "passed": true/false, "notes": "..." },
    "generation": { "passed": true/false, "notes": "..." },
    "flowRun": { "passed": true/false, "runResult": "passed/failed", "notes": "..." }
  },
  "summary": { "total": 5, "passed": <n>, "failed": <n> }
}

If you reused the recording (RECORDING_EXISTS=true), mark recording and appInteraction as
{ "passed": true, "notes": "Skipped — reused existing recording" }.

Close all browsers when done:
  playwright-cli close

## Important rules

- Use playwright-cli snapshot after EVERY navigation and action to see the page state
- Use named sessions: default session for pipeline UI, -s=app for the 8count app
- If a phase fails, record the failure and try to continue to the next phase
- The AI verification step can take 1-3 minutes — don't give up, keep taking snapshots
- ALWAYS write the results JSON before finishing, even if things failed
- Debug failures like you would in a normal session — read error messages, try alternatives`;

const logStream = fs.createWriteStream(logPath, { flags: "w" });

console.log("[test-pipeline] Spawning Claude CLI…");

const proc = spawn(
  "claude",
  [
    "-p",
    prompt,
    "--allowedTools",
    "Bash(playwright-cli:*),Read,Write,Edit",
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "text",
    "--max-budget-usd",
    "10",
  ],
  {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }
);

proc.stdout.pipe(logStream);
proc.stderr.pipe(logStream);

proc.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
});

proc.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

proc.on("close", (code) => {
  logStream.end();
  console.log(`\n[test-pipeline] Claude CLI exited with code ${code}`);

  // If results weren't written, write a failure stub
  if (!fs.existsSync(resultsPath)) {
    fs.writeFileSync(
      resultsPath,
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          recordingReused: hasRecording,
          phases: {},
          summary: { total: 0, passed: 0, failed: 0 },
          error: `Claude CLI exited with code ${code}. Check test-results/pipeline-e2e.log for details.`,
        },
        null,
        2
      )
    );
  }

  // Print summary
  try {
    const results = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
    console.log(`\n[test-pipeline] Results: ${results.summary.passed}/${results.summary.total} passed`);
    if (results.summary.failed > 0) {
      for (const [phase, result] of Object.entries(results.phases || {})) {
        if (!result.passed) console.log(`  FAIL: ${phase} — ${result.notes}`);
      }
    }
    process.exit(results.summary.failed > 0 ? 1 : 0);
  } catch {
    console.log("[test-pipeline] Could not read results file");
    process.exit(code || 1);
  }
});

proc.on("error", (err) => {
  console.error("[test-pipeline] Failed to spawn claude:", err.message);
  logStream.end();

  fs.writeFileSync(
    resultsPath,
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        recordingReused: hasRecording,
        phases: {},
        summary: { total: 0, passed: 0, failed: 0 },
        error: `Failed to spawn claude CLI: ${err.message}`,
      },
      null,
      2
    )
  );

  process.exit(1);
});
