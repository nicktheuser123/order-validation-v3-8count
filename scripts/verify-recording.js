const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const flowName = process.argv[2];
if (!flowName) {
  console.error("Usage: node scripts/verify-recording.js <flowName>");
  process.exit(1);
}

const ROOT = path.join(__dirname, "..");
const recordingPath = path.join(ROOT, "recordings", `${flowName}.js`);
const analysisPath = path.join(ROOT, "recordings", `${flowName}.analysis.json`);
const lockPath = path.join(ROOT, "recordings", `${flowName}.analyzing`);
const logPath = path.join(ROOT, "recordings", `${flowName}.verify.log`);

if (!fs.existsSync(recordingPath)) {
  console.error(`Recording not found: ${recordingPath}`);
  process.exit(1);
}

console.log(`[verify] Starting verification for flow: ${flowName}`);

const prompt = `You are executing a task in a web app using playwright-cli. The user recorded themselves doing the task — the recording at recordings/${flowName}.js is your **task description**, not a literal script to replay. Read it to understand *what* the user wants to accomplish (navigate to X, fill Y, pick Z from a dropdown, submit). Then execute that intent using playwright-cli, exactly as you would if the user had typed the task as a natural-language instruction.

## Your job

1. Read the recording at: recordings/${flowName}.js
2. Open a headed browser: playwright-cli open
3. Execute the flow using playwright-cli, handling any fragile selectors using your general judgment
4. When done, write recordings/${flowName}-stabilized.js and recordings/${flowName}.analysis.json
5. Close the browser: playwright-cli close

## Snapshot rules (important)

playwright-cli **automatically returns a snapshot at the end of every command's output** — every goto, click, fill, run-code already includes the current page state in its response. Read that — do NOT run \`playwright-cli snapshot\` as a separate command on success paths. Only run an extra snapshot when:
  (a) a command fails and you need to see page state to debug, or
  (b) the snapshot from the previous command did not capture the element you need next.

Aim for ≤5 explicit snapshot calls across the entire verification. Every extra snapshot is a round-trip you pay for.

## Batching rules (also important)

Run the flow in stages, NOT step-by-step. Group consecutive operations on the same logical section into a single \`playwright-cli run-code "async page => { ... }"\` block — exactly as you would if writing a Playwright script by hand. Typical stages:
  - login
  - navigation to the target page
  - fill form body
  - pick calendar / dropdown / autocomplete values
  - submit

Do NOT extract each \`await page.*\` from the recording and run it as a separate \`run-code\` invocation. Each round-trip through \`run-code\` is a subprocess + model turn — treat them as expensive. A 40-step recording should become ~5 \`run-code\` blocks, not 40.

Aim for ≤8 run-code invocations across the entire verification.

## Selector judgment

The recording may contain fragile patterns: Bubble auto-generated \`#P<digits>\` IDs, positional \`.nth(N)\`, race-prone \`getByText(...)\` after autocomplete, hardcoded date gridcells, blind \`.dblclick()\` on calendar navigation. Use the snapshot already in the previous command's output to find stable alternatives — placeholder, aria-label, role+name, label text — just like you would in a normal Claude Code CLI session.

Use your general Playwright knowledge to handle autocomplete inputs, dynamic dropdowns, calendars, multi-select widgets, etc. — the same way you'd approach them if the user had asked you from scratch. Do NOT try to mechanically replay the recording if the original selectors are brittle.

## Waits

Use \`waitForLoadState('domcontentloaded')\` after navigation. Do NOT use \`'networkidle'\` — Bubble polls indefinitely and networkidle will time out.

## Flagging unresolvable cases

If a step uses an element with no stable identifier visible in the snapshot (only a \`#P<digits>\`, only a long \`getByText\`, only positional \`.nth(N)\`), flag it in analysis.json with a \`recommendedId\` in kebab-case and leave the step in the stabilized recording with a clearly commented TODO. The user will add the stable ID in the Bubble editor and reverify will pick it up.

Do NOT spend turns trying to make an unresolvable selector work. Flag and move on.

## Output files — MUST write both when done

1. Stabilized recording: recordings/${flowName}-stabilized.js
   - Clean, runnable Playwright script — batched into stages, not 40 individual page.* calls
   - Stable selectors where possible, commented TODOs where not
   - Redundant patterns removed: no \`.click()\` before \`.fill()\` on the same element, no \`.press('Tab')\` between fields, no \`.press('ControlOrMeta+a')\` before \`.fill()\`
   - Use the \`(async () => { ... })()\` format with \`chromium.launch()\`
   - Appropriate waits where needed

2. Analysis JSON: recordings/${flowName}.analysis.json — MUST be valid JSON in exactly this format:
{
  "flowName": "${flowName}",
  "analyzedAt": "<ISO timestamp>",
  "runSuccess": true,
  "totalSteps": <number>,
  "autoFixed": <number>,
  "flagged": [
    {
      "line": <number>,
      "context": "<what this step does>",
      "action": "<original action string>",
      "fragment": "<the #P selector or fragile locator>",
      "reason": "Key interactive element — add a stable element ID in Bubble editor",
      "recommendedId": "<kebab-case suggested ID>",
      "stableId": null
    }
  ]
}

If no items need flagging, use an empty array for "flagged".

## Important

- ALWAYS write both output files before finishing — the analysis.json being written signals completion to the UI
- Close the browser when done: playwright-cli close`;

const logStream = fs.createWriteStream(logPath, { flags: "w" });

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
    "5",
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

proc.on("close", (code) => {
  logStream.end();
  console.log(`[verify] Claude CLI exited with code ${code}`);

  // If analysis.json wasn't written, write a failure stub
  if (!fs.existsSync(analysisPath)) {
    fs.writeFileSync(
      analysisPath,
      JSON.stringify(
        {
          flowName,
          analyzedAt: new Date().toISOString(),
          runSuccess: false,
          totalSteps: 0,
          autoFixed: 0,
          flagged: [],
          error: `Claude CLI exited with code ${code}. Check recordings/${flowName}.verify.log for details.`,
        },
        null,
        2
      )
    );
  }

  // Remove lock file
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  console.log("[verify] Done");
});

proc.on("error", (err) => {
  console.error("[verify] Failed to spawn claude:", err.message);
  logStream.end();

  fs.writeFileSync(
    analysisPath,
    JSON.stringify(
      {
        flowName,
        analyzedAt: new Date().toISOString(),
        runSuccess: false,
        totalSteps: 0,
        autoFixed: 0,
        flagged: [],
        error: `Failed to spawn claude CLI: ${err.message}`,
      },
      null,
      2
    )
  );

  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
});
