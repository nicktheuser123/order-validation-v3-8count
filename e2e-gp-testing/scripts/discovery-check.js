#!/usr/bin/env node
/**
 * Discovery-freshness smoke probe. Verifies the top-tier element IDs captured
 * in each discovery-<flow>.json still exist on their expected views.
 *
 * What it does:
 *   1. For each discovery-<flow>.json with status != "PENDING_DISCOVERY":
 *      - Open the event URL in a one-off session.
 *      - Check that the landing Tickets button exists.
 *      - Click it; check the tickets-view ADD buttons exist.
 *      - (Future: deeper probes into Step 1 / Step 2 ids captured in steps[].)
 *   2. Flag any flow where a critical ID is missing as "STALE — re-discover".
 *
 * Intentionally shallow: full coverage would be indistinguishable from running
 * every flow. This is a 10-second sanity check before a full e2e:run-all.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PROBE_SESSION_PREFIX = "gp-discovery-check";
const ROOT = path.join(__dirname, "..");

function pw(session, ...args) {
  try {
    return execFileSync("playwright-cli", [`-s=${session}`, ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : "";
    throw new Error(`playwright-cli failed: ${args.join(" ")}\n${stderr}`);
  }
}

function pwEval(session, js) {
  const raw = pw(session, "eval", `() => { return (${js}); }`);
  const m = raw.match(/### Result\n([\s\S]*?)(?:\n### |$)/);
  return m ? m[1].trim() : "";
}

async function probeFlow(flowFile, eventUrl) {
  const session = `${PROBE_SESSION_PREFIX}-${flowFile.replace(/\.json$/, "")}`;
  const disc = JSON.parse(fs.readFileSync(path.join(ROOT, flowFile), "utf8"));
  const result = { file: flowFile, flow: disc.flow, status: "PENDING", missing: [], notes: [] };

  if (disc.status === "PENDING_DISCOVERY") {
    result.status = "PENDING";
    result.notes.push("discovery not yet captured — nothing to probe");
    return result;
  }

  try {
    try { pw(session, "delete-data"); } catch {}
    pw(session, "open", eventUrl, "--headed");
    try { pw(session, "resize", "1440", "900"); } catch {}
    pw(session, "run-code", `async (page) => { await page.setViewportSize({ width: 1440, height: 900 }); }`);

    const landingOk = pwEval(session, `!!document.getElementById('gp-test-tickets-button')`);
    if (landingOk !== "true") result.missing.push("landing #gp-test-tickets-button");

    if (landingOk === "true") {
      pwEval(session, `(() => { document.getElementById('gp-test-tickets-button').click(); return true; })()`);
      // Brief wait for the tickets view to render.
      const start = Date.now();
      let ticketsOk = false;
      while (Date.now() - start < 10000) {
        const any = pwEval(session, `Array.from(document.querySelectorAll('button#add')).some(b => b.offsetParent !== null)`);
        if (any === "true") { ticketsOk = true; break; }
        await new Promise((r) => setTimeout(r, 400));
      }
      if (!ticketsOk) result.missing.push("tickets-view button#add (visible)");
    }

    result.status = result.missing.length === 0 ? "OK" : "STALE";
  } catch (err) {
    result.status = "ERROR";
    result.notes.push(err.message.slice(0, 200));
  } finally {
    try { pw(session, "close"); } catch {}
    try { pw(session, "delete-data"); } catch {}
  }
  return result;
}

async function main() {
  const state = JSON.parse(fs.readFileSync(path.join(ROOT, "e2e-state.json"), "utf8"));
  const eventUrl = state.event && state.event.url;
  if (!eventUrl) throw new Error("e2e-state.json missing event.url");

  const flowFiles = fs.readdirSync(ROOT).filter((f) => /^discovery-.+\.json$/.test(f));
  if (!flowFiles.length) {
    console.log("[discovery-check] no discovery-*.json files found");
    return;
  }

  console.log(`[discovery-check] probing ${flowFiles.length} flow(s) against ${eventUrl}`);
  const results = [];
  for (const f of flowFiles) {
    process.stdout.write(`  ${f} ... `);
    const r = await probeFlow(f, eventUrl);
    results.push(r);
    process.stdout.write(`${r.status}${r.missing.length ? ` (missing: ${r.missing.join(", ")})` : ""}\n`);
  }

  console.log("\n[discovery-check] summary:");
  const stale = results.filter((r) => r.status === "STALE" || r.status === "ERROR");
  for (const r of results) {
    console.log(`  ${r.flow.padEnd(32)} ${r.status}${r.notes.length ? `  — ${r.notes.join("; ")}` : ""}`);
  }
  if (stale.length) {
    console.log(`\n[discovery-check] ${stale.length} flow(s) STALE — re-run Phase 0 discovery for those flows.`);
    process.exit(1);
  }
  console.log("[discovery-check] all probed flows OK");
}

main().catch((err) => {
  console.error("[discovery-check] fatal:", err.message);
  process.exit(1);
});
