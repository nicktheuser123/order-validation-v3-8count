#!/usr/bin/env node
/**
 * Reconcile `.order-NN-done.json` marker files against Bubble `gp_order` records.
 *
 * Strategy:
 *   1. Read all marker files for this run.
 *   2. Query all gp_order records linked to the event that were created today (UTC).
 *   3. For each marker, find the matching order by:
 *        (a) contact email exact match (primary), OR
 *        (b) total-order-value within $0.02 of expectedTotal, created within a 10-minute
 *            window around `completedAt` (fallback for logged-in orders where buyer email
 *            may be the account email, not the checkout contact email).
 *   4. Write each (orderNumber, orderId, tickets, promo, checkout) into `state.orders`.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const fs = require("fs");
const path = require("path");
const { searchThings } = require("../../config/bubbleClient");
const { TYPES } = require("../../testConfig");

const ROOT = path.join(__dirname, "..");
const STATE_PATH = path.join(ROOT, "e2e-state.json");

function readMarkers() {
  const files = fs.readdirSync(ROOT).filter((f) => /^\.order-\d{2}-done\.json$/.test(f));
  const markers = files
    .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")))
    .sort((a, b) => a.orderNumber - b.orderNumber);
  if (markers.length !== 20) {
    console.error(`[reconcile] expected 20 markers, found ${markers.length}`);
    process.exit(1);
  }
  return markers;
}

async function fetchAllEventOrders(eventId) {
  const orders = await searchThings(TYPES.GP_ORDER, [
    { key: "Event", constraint_type: "equals", value: eventId }
  ]);
  // Filter to orders created today (UTC), since event has history
  const today = new Date();
  const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return orders.filter((o) => {
    const created = new Date(o["Created Date"]);
    return created >= startOfDay;
  });
}

function findByEmail(orders, email) {
  return orders.filter((o) => {
    const candidates = [o["Email Text"], o["Buyer Email"], o["ContactEmail"], o["Contact Email"]];
    return candidates.some((c) => typeof c === "string" && c.toLowerCase() === email.toLowerCase());
  });
}

function findByTotalAndTime(orders, expectedTotal, completedAtIso) {
  const completedAt = new Date(completedAtIso).getTime();
  const windowMs = 10 * 60 * 1000;
  return orders.filter((o) => {
    const total = Number(o["Total Order Value"]);
    const created = new Date(o["Created Date"]).getTime();
    return (
      Math.abs(total - expectedTotal) <= 0.02 &&
      Math.abs(created - completedAt) <= windowMs
    );
  });
}

async function main() {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  const markers = readMarkers();
  console.log(`[reconcile] Loaded ${markers.length} markers`);

  const allOrders = await fetchAllEventOrders(state.event.id);
  console.log(`[reconcile] Fetched ${allOrders.length} orders created today for event ${state.event.id}`);

  const resolved = [];
  const unresolved = [];
  const claimed = new Set();

  for (const m of markers) {
    let matches = findByEmail(allOrders, m.contactEmail).filter((o) => !claimed.has(o._id));
    let strategy = "email";

    if (matches.length !== 1) {
      const byTotal = findByTotalAndTime(allOrders, m.expectedTotal, m.completedAt).filter(
        (o) => !claimed.has(o._id)
      );
      if (byTotal.length === 1) {
        matches = byTotal;
        strategy = "total+time";
      } else if (byTotal.length > 1) {
        // tie-break by narrower time window
        const sorted = byTotal
          .map((o) => ({ o, dt: Math.abs(new Date(o["Created Date"]).getTime() - new Date(m.completedAt).getTime()) }))
          .sort((a, b) => a.dt - b.dt);
        matches = [sorted[0].o];
        strategy = "total+time(closest)";
      }
    }

    if (matches.length === 1) {
      const o = matches[0];
      claimed.add(o._id);
      resolved.push({
        orderNumber: m.orderNumber,
        orderId: o._id,
        tickets: m.tickets,
        promo: m.promo,
        checkout: m.checkout,
        _matchStrategy: strategy,
        _total: Number(o["Total Order Value"])
      });
      console.log(`  #${String(m.orderNumber).padStart(2, "0")} → ${o._id} (via ${strategy}, total ${o["Total Order Value"]})`);
    } else {
      unresolved.push({ marker: m, candidates: matches.length });
      console.error(`  #${String(m.orderNumber).padStart(2, "0")} → UNRESOLVED (${matches.length} candidates)`);
    }
  }

  if (unresolved.length > 0) {
    console.error(`[reconcile] ${unresolved.length} unresolved markers — state not written`);
    console.error(JSON.stringify(unresolved, null, 2));
    process.exit(1);
  }

  // Write clean orders array (without debug fields)
  state.orders = resolved
    .sort((a, b) => a.orderNumber - b.orderNumber)
    .map(({ _matchStrategy, _total, ...clean }) => clean);

  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
  console.log(`[reconcile] OK — wrote ${state.orders.length} orders to state.orders`);
}

main().catch((err) => {
  console.error("[reconcile] fatal:", err.message);
  if (err.response) console.error(err.response.data);
  process.exit(1);
});
