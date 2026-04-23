#!/usr/bin/env node
/**
 * Sequential orchestrator for the 20-order matrix.
 *
 * Reads settings.flow.ordersToRun (or all orders in orders.json if empty) and
 * runs each in turn via runOrder. Collects a summary at the end.
 *
 * This is deliberately SEQUENTIAL — single browser context at a time. The
 * runbook (§ Agent Split) describes a max-parallelism topology with 13
 * concurrent workers, owner-agent serialization for Users A/B/C, and 3 pre-
 * phase setup agents. Parallelization is a future upgrade; for the MVP we
 * stick with sequential runs which are strictly easier to debug and let
 * Order #3 stay the regression canary.
 *
 * Usage:
 *   node scripts/run-all.js                  # runs settings.flow.ordersToRun or all
 *   node scripts/run-all.js --only 3,6,7     # override with comma-separated list
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const fs = require("fs");
const path = require("path");
const { runOrder, loadSpec } = require("./run-order");

const ROOT = path.join(__dirname, "..");

function parseArgs(argv) {
  const args = { only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") {
      args.only = argv[++i].split(",").map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);
    }
  }
  return args;
}

function loadOrderList(onlyArg) {
  const orders = JSON.parse(fs.readFileSync(path.join(ROOT, "orders.json"), "utf8"));
  if (onlyArg && onlyArg.length) return onlyArg;

  const settingsPath = path.join(ROOT, "settings.json");
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const fromSettings = settings && settings.flow && settings.flow.ordersToRun;
    if (Array.isArray(fromSettings) && fromSettings.length) return fromSettings;
  }
  return orders.orders.map((o) => o.orderNumber).sort((a, b) => a - b);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const toRun = loadOrderList(args.only);
  console.log(`[run-all] running ${toRun.length} order(s) sequentially: ${toRun.join(", ")}`);

  const results = [];
  for (const n of toRun) {
    const entry = { orderNumber: n };
    try {
      const spec = loadSpec({ order: n });
      console.log(`\n[run-all] ─── order #${String(n).padStart(2, "0")} (flow: ${spec.flow}${spec.discoveryPending ? ", discovery pending" : ""}) ───`);
      if (spec.discoveryPending) {
        console.log(`[run-all] SKIP #${n} — discoveryPending: true. Run Phase 0 for '${spec.flow}' before including this order.`);
        entry.ok = false;
        entry.skipped = true;
        entry.reason = "discoveryPending";
        results.push(entry);
        continue;
      }
      const { total } = await runOrder(spec);
      entry.ok = true;
      entry.total = total;
    } catch (err) {
      entry.ok = false;
      entry.error = err.message;
      console.error(`[run-all] order #${n} FAILED: ${err.message}`);
    }
    results.push(entry);
  }

  console.log("\n[run-all] summary:");
  for (const r of results) {
    if (r.skipped) {
      console.log(`  #${String(r.orderNumber).padStart(2, "0")}: SKIP (${r.reason})`);
    } else if (r.ok) {
      console.log(`  #${String(r.orderNumber).padStart(2, "0")}: OK ($${r.total.toFixed(2)})`);
    } else {
      console.log(`  #${String(r.orderNumber).padStart(2, "0")}: FAIL — ${r.error}`);
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  const skipCount = results.filter((r) => r.skipped).length;
  console.log(`[run-all] ${okCount} ok / ${skipCount} skipped / ${results.length - okCount - skipCount} failed`);
  if (okCount + skipCount < results.length) process.exit(1);
}

main().catch((err) => {
  console.error("[run-all] fatal:", err.message);
  process.exit(1);
});
