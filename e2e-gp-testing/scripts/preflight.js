#!/usr/bin/env node
/**
 * Preflight for `flow.mode === "orders-only"` runs.
 *
 * Verifies that `e2e-state.json` has every ID the purchase flows need
 * before an agent skips Phase 1. Exits 0 on pass, 1 with a human-readable
 * message on fail.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SETTINGS_PATH = path.join(ROOT, "settings.json");
const STATE_PATH = path.join(ROOT, "e2e-state.json");

const ORDER_SESSION_COUNT = 20;
const SETUP_SESSIONS = ["gp-setup-A", "gp-setup-B", "gp-setup-C"];

function fail(msg) {
  console.error(`[preflight] FAIL — ${msg}`);
  process.exit(1);
}

function readJson(p, label) {
  if (!fs.existsSync(p)) fail(`${label} not found at ${p}`);
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    fail(`${label} is not valid JSON: ${err.message}`);
  }
}

function silentRun(cmd) {
  try {
    execSync(cmd, { stdio: "pipe" });
    return true;
  } catch (_err) {
    return false;
  }
}

function cleanupPlaywrightSessions() {
  if (!silentRun("command -v playwright-cli")) {
    console.log("[preflight] skipping playwright-cli cleanup — binary not on PATH");
    return;
  }
  silentRun("playwright-cli close-all");
  const sessions = [];
  for (let n = 1; n <= ORDER_SESSION_COUNT; n++) {
    sessions.push(`gp-order-${String(n).padStart(2, "0")}`);
  }
  sessions.push(...SETUP_SESSIONS);
  for (const s of sessions) {
    silentRun(`playwright-cli -s=${s} delete-data`);
  }
  console.log(`[preflight] cleaned playwright-cli sessions (close-all + delete-data for ${sessions.length} named sessions)`);
}

const settings = readJson(SETTINGS_PATH, "settings.json");
const state = readJson(STATE_PATH, "e2e-state.json");

const mode = settings.flow && settings.flow.mode;
if (mode !== "orders-only") {
  console.log(`[preflight] skipped — flow.mode is "${mode}", not "orders-only"`);
  process.exit(0);
}

const event = state.event || {};
if (!event.id) fail("e2e-state.json is missing event.id — run mode:full first or populate manually");
if (!event.url) fail("e2e-state.json is missing event.url");
if (!event.eventDetailId) fail("e2e-state.json is missing event.eventDetailId");

const requiredTicketTypes = (settings.ticketTypes || []).map((t) => t.name);
for (const name of requiredTicketTypes) {
  if (!state.ticketTypes || !state.ticketTypes[name] || !state.ticketTypes[name].id) {
    fail(`e2e-state.json is missing ticketTypes.${name} — run mode:full first or populate manually`);
  }
}

const requiredPromos = (settings.promotions || []).map((p) => p.code);
for (const code of requiredPromos) {
  if (!state.promotions || !state.promotions[code] || !state.promotions[code].id) {
    fail(`e2e-state.json is missing promotions.${code}`);
  }
}

const taxName = settings.customFee && settings.customFee.name;
if (taxName && (!state.customFees || !state.customFees[taxName] || !state.customFees[taxName].id)) {
  fail(`e2e-state.json is missing customFees.${taxName}`);
}

const ordersToRun = (settings.flow && settings.flow.ordersToRun) || [];
if (!Array.isArray(ordersToRun)) fail("flow.ordersToRun must be an array");
for (const n of ordersToRun) {
  if (!Number.isInteger(n) || n < 1 || n > 20) {
    fail(`flow.ordersToRun contains invalid entry ${JSON.stringify(n)} — must be integers in [1, 20]`);
  }
}

if (settings.flow && settings.flow.resetOrdersOnRun) {
  state.setupUsers = { A: "pending", B: "pending", C: "pending" };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
  console.log("[preflight] resetOrdersOnRun=true — reset setupUsers to pending");
}

cleanupPlaywrightSessions();

const subsetMsg = ordersToRun.length > 0 ? `orders [${ordersToRun.join(", ")}]` : "all 20 orders";
console.log(`[preflight] OK — event "${event.name || event.id}" ready for ${subsetMsg}`);
process.exit(0);
