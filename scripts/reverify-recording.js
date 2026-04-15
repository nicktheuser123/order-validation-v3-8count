const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const flowName = process.argv[2];
if (!flowName) {
  console.error("Usage: node scripts/reverify-recording.js <flowName>");
  process.exit(1);
}

const ROOT = path.join(__dirname, "..");
const stabilizedPath = path.join(ROOT, "recordings", `${flowName}-stabilized.js`);
const analysisPath = path.join(ROOT, "recordings", `${flowName}.analysis.json`);
const lockPath = path.join(ROOT, "recordings", `${flowName}.reverifying`);
const logPath = path.join(ROOT, "recordings", `${flowName}.reverify.log`);

if (!fs.existsSync(stabilizedPath)) {
  console.error(`Stabilized recording not found: ${stabilizedPath}`);
  process.exit(1);
}

console.log(`[reverify] Starting re-verification for flow: ${flowName}`);

const prompt = `You are re-verifying a stabilized Playwright recording after the user added Bubble element IDs. The recording at recordings/${flowName}-stabilized.js has already been verified once and any flagged \`#P<digits>\` selectors have been replaced with the stable IDs the user provided in the Bubble editor. Your job is to run it end-to-end and confirm it still works — the same way you would if the user asked you to run a working Playwright script in Claude Code CLI.

## Your job

1. Read the stabilized recording at: recordings/${flowName}-stabilized.js
2. Open a headed browser: playwright-cli open
3. Run the flow end-to-end using playwright-cli
4. If anything fails, debug and patch the stabilized recording
5. Update recordings/${flowName}.analysis.json — only touch the \`flagged[]\` array and any per-step notes. The wrapper handles \`analyzedAt\` and \`runSuccess\` automatically; do NOT write those fields.
6. Close the browser: playwright-cli close

## Snapshot rules (important)

playwright-cli **automatically returns a snapshot at the end of every command's output** — every goto, click, fill, run-code already includes the current page state in its response. Read that — do NOT run \`playwright-cli snapshot\` as a separate command on success paths. Take zero explicit snapshots on a clean run. Only snapshot if a stage fails and you need to debug.

## Batching rules (also important)

The flow is already stabilized and expected to work. Run it in as few \`run-code\` blocks as possible — ideally 2–4 total (e.g., login, body, submit). Do NOT extract each \`await page.*\` and run it individually; each round-trip through \`run-code\` is a subprocess + model turn and is expensive.

If a stage fails, debug it the same way you would in a normal Claude Code CLI session: look at the attached snapshot from the failed command, find a better selector, patch the stage, re-run the stage. Do not fall back to per-step execution unless a second failure on the same stage forces it.

## Waits

Use \`waitForLoadState('domcontentloaded')\` after navigation. Do NOT use \`'networkidle'\` — Bubble polls indefinitely and networkidle will time out.

## Important

- ALWAYS close the browser when done: playwright-cli close
- Do NOT modify \`analyzedAt\` or \`runSuccess\` in analysis.json — the wrapper does that after you exit`;

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
    "3",
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
  console.log(`[reverify] Claude CLI exited with code ${code}`);

  // Update analysis if not already updated
  if (fs.existsSync(analysisPath)) {
    try {
      const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
      if (!analysis.analyzedAt || Date.now() - new Date(analysis.analyzedAt).getTime() > 60000) {
        analysis.runSuccess = code === 0;
        analysis.analyzedAt = new Date().toISOString();
        if (code !== 0) {
          analysis.reverifyError = `Claude CLI exited with code ${code}`;
        }
        fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
      }
    } catch {
      // ignore parse errors
    }
  }

  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  console.log("[reverify] Done");
});

proc.on("error", (err) => {
  console.error("[reverify] Failed to spawn claude:", err.message);
  logStream.end();
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
});
