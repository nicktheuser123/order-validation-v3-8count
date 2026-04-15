require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { getThing } = require("../config/bubbleClient");
const { generateFlow } = require("./generate-flow");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../wireframes")));

// ── Flows registry helpers ────────────────────────────────────────────────────

const FLOWS_PATH = path.join(__dirname, "../flows/flows.json");

function readFlows() {
  if (!fs.existsSync(FLOWS_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(FLOWS_PATH, "utf8")); }
  catch { return {}; }
}

function writeFlows(flows) {
  fs.writeFileSync(FLOWS_PATH, JSON.stringify(flows, null, 2));
}

// ── Root redirect ─────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.redirect("/dashboard.html");
});

// ── Flows API ─────────────────────────────────────────────────────────────────

// GET /api/flows
app.get("/api/flows", (req, res) => {
  const flows = readFlows();
  const flowsDir = path.join(__dirname, "../flows");
  // Annotate each flow with whether a .flow.js file actually exists
  for (const [name, meta] of Object.entries(flows)) {
    meta.hasFlowFile = fs.existsSync(path.join(flowsDir, `${name}.flow.js`));
  }
  res.json({ flows });
});

// POST /api/recording-start  { flowName, baseUrl }
app.post("/api/recording-start", (req, res) => {
  const { flowName, baseUrl } = req.body;
  if (!flowName || !baseUrl) {
    return res.status(400).json({ error: "flowName and baseUrl required" });
  }

  const recordingsDir = path.join(__dirname, "../recordings");
  if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir);

  // Register flow
  const flows = readFlows();
  flows[flowName] = { phase: "recording", createdAt: new Date().toISOString() };
  writeFlows(flows);

  // Remove stale recording file so polling detects fresh save
  const recordingPath = path.join(recordingsDir, `${flowName}.js`);
  if (fs.existsSync(recordingPath)) fs.unlinkSync(recordingPath);

  // Launch Playwright codegen detached — returns immediately
  const proc = spawn(
    "npx",
    ["playwright", "codegen", "-o", recordingPath, baseUrl],
    { detached: true, stdio: "ignore", shell: process.platform === "win32" }
  );
  proc.unref();

  // Track PID so recording-status can check if codegen is still running
  const pidPath = path.join(recordingsDir, `${flowName}.codegen.pid`);
  fs.writeFileSync(pidPath, String(proc.pid));
  proc.on("exit", () => {
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
  });

  res.json({ ok: true });
});

// GET /api/recording-status?flow=<name>
app.get("/api/recording-status", (req, res) => {
  const { flow } = req.query;
  if (!flow) return res.status(400).json({ error: "flow required" });

  const recordingsDir = path.join(__dirname, "../recordings");
  const recordingPath = path.join(recordingsDir, `${flow}.js`);
  const pidPath = path.join(recordingsDir, `${flow}.codegen.pid`);

  // Check if codegen is still running — file may exist but recording isn't done yet
  if (fs.existsSync(pidPath)) {
    try {
      const pid = parseInt(fs.readFileSync(pidPath, "utf8"), 10);
      process.kill(pid, 0); // throws if process doesn't exist
      // Process is still running — not ready yet
      return res.json({ ready: false, recording: true });
    } catch {
      // Process exited — clean up PID file
      if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
    }
  }

  if (!fs.existsSync(recordingPath)) return res.json({ ready: false });

  const content = fs.readFileSync(recordingPath, "utf8");
  const steps = (content.match(/await page\./g) || []).length;

  if (steps === 0) return res.json({ ready: false });

  // Advance phase from recording → ids now that file exists
  const flows = readFlows();
  if (flows[flow] && flows[flow].phase === "recording") {
    flows[flow].phase = "ids";
    writeFlows(flows);
  }

  res.json({ ready: true, steps });
});

// PATCH /api/flows/:name/phase  { phase }
app.patch("/api/flows/:name/phase", (req, res) => {
  const { name } = req.params;
  const { phase } = req.body;
  if (!phase) return res.status(400).json({ error: "phase required" });

  const flows = readFlows();
  if (!flows[name]) return res.status(404).json({ error: "Flow not found" });
  flows[name].phase = phase;
  writeFlows(flows);
  res.json({ ok: true });
});

// ── Verification API ──────────────────────────────────────────────────────────

// POST /api/verify  { flowName }
app.post("/api/verify", (req, res) => {
  const { flowName } = req.body;
  if (!flowName) return res.status(400).json({ error: "flowName required" });

  const recordingsDir = path.join(__dirname, "../recordings");
  if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

  // Write lock file to signal "in progress"
  const lockPath = path.join(recordingsDir, `${flowName}.analyzing`);
  fs.writeFileSync(lockPath, new Date().toISOString());

  // Remove stale analysis so polling doesn't pick up old data
  const analysisPath = path.join(recordingsDir, `${flowName}.analysis.json`);
  if (fs.existsSync(analysisPath)) fs.unlinkSync(analysisPath);

  // Spawn verifier detached
  const proc = spawn(
    "node",
    [path.join(__dirname, "verify-recording.js"), flowName],
    { detached: true, stdio: "ignore", env: process.env, shell: process.platform === "win32" }
  );
  proc.unref();

  res.json({ ok: true });
});

// GET /api/analysis?flow=<name>
app.get("/api/analysis", (req, res) => {
  const { flow } = req.query;
  if (!flow) return res.status(400).json({ error: "flow required" });

  const recordingsDir = path.join(__dirname, "../recordings");
  const lockPath = path.join(recordingsDir, `${flow}.analyzing`);
  const revLockPath = path.join(recordingsDir, `${flow}.reverifying`);
  const analysisPath = path.join(recordingsDir, `${flow}.analysis.json`);

  if (fs.existsSync(revLockPath)) return res.json({ status: "reverifying" });
  if (fs.existsSync(lockPath)) return res.json({ status: "analyzing" });
  if (fs.existsSync(analysisPath)) {
    try {
      const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
      return res.json({ status: "ready", analysis });
    } catch {
      return res.json({ status: "none" });
    }
  }
  return res.json({ status: "none" });
});

// POST /api/apply-ids  { flowName, mappings: [{fragment, stableId}] }
app.post("/api/apply-ids", (req, res) => {
  const { flowName, mappings } = req.body;
  if (!flowName || !Array.isArray(mappings)) {
    return res.status(400).json({ error: "flowName and mappings required" });
  }

  const recordingsDir = path.join(__dirname, "../recordings");
  const stabilizedPath = path.join(recordingsDir, `${flowName}-stabilized.js`);
  const analysisPath = path.join(recordingsDir, `${flowName}.analysis.json`);

  if (!fs.existsSync(stabilizedPath)) {
    return res.status(404).json({ error: "Stabilized recording not found" });
  }

  let content = fs.readFileSync(stabilizedPath, "utf8");
  for (const { fragment, stableId } of mappings) {
    if (!fragment || !stableId) continue;
    // Replace #P<digits> with #stableId in the file
    const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    content = content.replace(new RegExp(escaped, "g"), `#${stableId}`);
  }
  fs.writeFileSync(stabilizedPath, content);

  // Update analysis.json with stableId values
  if (fs.existsSync(analysisPath)) {
    try {
      const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
      for (const { fragment, stableId } of mappings) {
        const entry = (analysis.flagged || []).find((f) => f.fragment === fragment);
        if (entry) entry.stableId = stableId;
      }
      fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
    } catch {
      // ignore
    }
  }

  res.json({ ok: true });
});

// POST /api/reverify  { flowName }
app.post("/api/reverify", (req, res) => {
  const { flowName } = req.body;
  if (!flowName) return res.status(400).json({ error: "flowName required" });

  const recordingsDir = path.join(__dirname, "../recordings");
  const lockPath = path.join(recordingsDir, `${flowName}.reverifying`);
  fs.writeFileSync(lockPath, new Date().toISOString());

  const proc = spawn(
    "node",
    [path.join(__dirname, "reverify-recording.js"), flowName],
    { detached: true, stdio: "ignore", env: process.env, shell: process.platform === "win32" }
  );
  proc.unref();

  res.json({ ok: true });
});

// POST /api/generate-flow  { flowName }
app.post("/api/generate-flow", (req, res) => {
  const { flowName } = req.body;
  if (!flowName) return res.status(400).json({ error: "flowName required" });

  const recordingsDir = path.join(__dirname, "../recordings");
  const stabilizedPath = path.join(recordingsDir, `${flowName}-stabilized.js`);
  const recordingForGenerate = path.join(recordingsDir, `${flowName}-recording.js`);

  // generateFlow() expects <flowName>-recording.js — copy stabilized there
  const srcPath = fs.existsSync(stabilizedPath)
    ? stabilizedPath
    : path.join(recordingsDir, `${flowName}.js`);

  if (!fs.existsSync(srcPath)) {
    return res.status(404).json({ error: "No recording found to generate flow from" });
  }

  try {
    fs.copyFileSync(srcPath, recordingForGenerate);
    const ok = generateFlow(flowName, { force: true });

    if (!ok) {
      return res.status(500).json({ error: "generateFlow returned false" });
    }

    // Advance phase to done (skip fixture step)
    const flows = readFlows();
    if (flows[flowName]) {
      flows[flowName].phase = "done";
      writeFlows(flows);
    }

    res.json({ ok: true, flowFile: `flows/${flowName}.flow.js` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Fixture API ───────────────────────────────────────────────────────────────

// GET /api/fetch-bubble?type=gporder&id=...
app.get("/api/fetch-bubble", async (req, res) => {
  const { type, id } = req.query;
  if (!type || !id) {
    return res.status(400).json({ error: "type and id are required" });
  }
  try {
    const record = await getThing(type.toLowerCase().replace(/\s+/g, ""), id.trim());
    res.json({ record });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.message || err.message || "Fetch failed";
    res.status(status).json({ error: message });
  }
});

// POST /api/save-fixture  { flowName, records }
app.post("/api/save-fixture", (req, res) => {
  const { flowName, records } = req.body;
  if (!flowName || !Array.isArray(records)) {
    return res.status(400).json({ error: "flowName and records are required" });
  }
  const fixturesDir = path.join(__dirname, "../fixtures");
  if (!fs.existsSync(fixturesDir)) fs.mkdirSync(fixturesDir);

  const fixture = { flowName, createdAt: new Date().toISOString(), records };
  fs.writeFileSync(
    path.join(fixturesDir, `${flowName}.fixture.json`),
    JSON.stringify(fixture, null, 2)
  );

  // Advance flow phase to done
  const flows = readFlows();
  if (flows[flowName]) {
    flows[flowName].phase = "done";
    writeFlows(flows);
  }

  res.json({ ok: true });
});

// GET /api/get-fixture?flow=create-event
app.get("/api/get-fixture", (req, res) => {
  const { flow } = req.query;
  if (!flow) return res.status(400).json({ error: "flow is required" });
  const fixturePath = path.join(__dirname, "../fixtures", `${flow}.fixture.json`);
  if (!fs.existsSync(fixturePath)) return res.json({ fixture: null });
  try {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    res.json({ fixture });
  } catch {
    res.json({ fixture: null });
  }
});

// ── Run Flow API ──────────────────────────────────────────────────────────────

// POST /api/run-flow  { flowName }
app.post("/api/run-flow", (req, res) => {
  const { flowName } = req.body;
  if (!flowName) return res.status(400).json({ error: "flowName required" });

  const flowPath = path.join(__dirname, "../flows", `${flowName}.flow.js`);
  if (!fs.existsSync(flowPath)) {
    return res.status(404).json({ error: `Flow file not found: flows/${flowName}.flow.js` });
  }

  const logsDir = path.join(__dirname, "../flows");
  const logPath = path.join(logsDir, `${flowName}.run.log`);
  const lockPath = path.join(logsDir, `${flowName}.running`);

  // Clear previous run log
  fs.writeFileSync(logPath, "");
  fs.writeFileSync(lockPath, new Date().toISOString());

  const proc = spawn("node", [flowPath], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    shell: process.platform === "win32",
  });

  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  proc.stdout.pipe(logStream);
  proc.stderr.pipe(logStream);

  proc.on("close", (code) => {
    logStream.end();
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    // Append exit line
    fs.appendFileSync(logPath, `\n[exit ${code}]`);
  });

  proc.unref();
  res.json({ ok: true });
});

// GET /api/run-status?flow=<name>
app.get("/api/run-status", (req, res) => {
  const { flow } = req.query;
  if (!flow) return res.status(400).json({ error: "flow required" });

  const logsDir = path.join(__dirname, "../flows");
  const logPath = path.join(logsDir, `${flow}.run.log`);
  const lockPath = path.join(logsDir, `${flow}.running`);

  const running = fs.existsSync(lockPath);
  let output = "";
  let success = null;

  if (fs.existsSync(logPath)) {
    output = fs.readFileSync(logPath, "utf8");
    if (!running) {
      success = output.includes("[exit 0]");
    }
  }

  res.json({ running, output, success });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Pipeline server running at http://localhost:${PORT}`);
});
