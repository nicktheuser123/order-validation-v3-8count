#!/usr/bin/env node
/**
 * Deterministic runner — MVP scope: Order #3 only.
 * Standard × 3 + Premium × 2, Guest checkout, no promo.
 * Expected total: $383.40.
 *
 * Element IDs were captured by the discovery agent — see discovery.json.
 * Uses `playwright-cli eval` for all Bubble-side DOM clicks/fills,
 * and `playwright-cli run-code` for the Authorize.net step (pressSequentially).
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const { execFileSync } = require("child_process");

// ─── config ────────────────────────────────────────────────────────────────
const SESSION = "gp-order-03";
const EVENT_URL = "https://8countlogin.com/version-81rkv/event/gp-e2e-test-20260417-2026";
const EVENT_ID = "1776417949185x800633791145312300";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const CONTACT_NAME = `GP Det 03 ${RUN_ID}`;
const CONTACT_EMAIL = `abhishek+gp-det-o03-${Date.now()}@millionlabs.co.uk`;
const CARD = {
  number: "4007000000027",
  exp: "0427",
  cvv: "123",
  lastName: "TestUser",
  zip: "10001",
  address: "123 Test Street",
  city: "New York",
  state: "NY"
};
const EXPECTED_TOTAL = 383.40;
const MIN_ORDER_MS = 25000;
// HEADED=false (env) → headless. Default headed (per feedback_headed_browser.md).
const HEADED = process.env.HEADED !== "false";

// ─── helpers ───────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function jitter() { return sleep(200 + Math.floor(Math.random() * 400)); }

function pw(...args) {
  try {
    return execFileSync("playwright-cli", [`-s=${SESSION}`, ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : "";
    console.error(`[pw FAIL] ${args.map((a) => (a.length > 80 ? a.slice(0, 80) + "..." : a)).join(" ")}`);
    if (stderr) console.error(stderr.trim());
    throw err;
  }
}

function pwEval(js) {
  // playwright-cli prints: "### Result\n<value>\n### Ran Playwright code\n..."
  // Extract the Result section.
  const raw = pw("eval", `() => { return (${js}); }`);
  const m = raw.match(/### Result\n([\s\S]*?)(?:\n### |$)/);
  return m ? m[1].trim() : "";
}

function pwEvalVoid(js) {
  // For clicks / value-sets where we don't care about the return value.
  pw("eval", `() => { ${js} }`);
}

async function waitFor(js, { timeoutMs = 30000, pollMs = 400, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const out = pwEval(js);
    if (out === "true" || out === '"true"') return;
    await sleep(pollMs);
  }
  throw new Error(`waitFor timeout${label ? ` [${label}]` : ""}: ${js.slice(0, 120)}`);
}

function clickId(id) {
  pwEvalVoid(`const el = document.getElementById(${JSON.stringify(id)}); if (!el) throw new Error('not found: #' + ${JSON.stringify(id)}); el.click();`);
}

function fillBubbleInput(id, value) {
  pwEvalVoid(`
    const el = document.getElementById(${JSON.stringify(id)});
    if (!el) throw new Error('not found: #' + ${JSON.stringify(id)});
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  `);
}

function clickVisibleByIdIndex(id, index = 0) {
  pwEvalVoid(`
    const all = Array.from(document.querySelectorAll('#' + ${JSON.stringify(id)}));
    const visible = all.filter((e) => e.offsetParent !== null);
    if (!visible[${index}]) throw new Error('no visible #' + ${JSON.stringify(id)} + ' at index ' + ${index} + ' (total visible: ' + visible.length + ')');
    visible[${index}].click();
  `);
}

async function queryOrderIdByEmail(email) {
  const { searchThings } = require("../../config/bubbleClient");
  const orders = await searchThings("gp_order", [
    { key: "Event", constraint_type: "equals", value: EVENT_ID }
  ]);
  const mine = orders
    .filter((o) => (o["Email Address"] || "").toLowerCase() === email.toLowerCase())
    .sort((a, b) => new Date(b["Created Date"]) - new Date(a["Created Date"]));
  return mine[0] || null;
}

// ─── the purchase flow ─────────────────────────────────────────────────────
async function run() {
  const started = Date.now();

  console.log("[run-order-03] cleaning session");
  try { pw("delete-data"); } catch { /* first-run no-op */ }

  console.log(`[run-order-03] opening event page (${HEADED ? "headed" : "headless"})`);
  if (HEADED) pw("open", EVENT_URL, "--headed");
  else pw("open", EVENT_URL);
  // Bubble's landing view — wait for the Tickets button to exist
  await waitFor(`!!document.getElementById('gp-test-tickets-button')`, { label: "landing Tickets button" });
  await jitter();

  console.log("[run-order-03] clicking Tickets");
  clickId("gp-test-tickets-button");
  // Wait for the tickets view — at least one ADD button visible
  await waitFor(`Array.from(document.querySelectorAll('button#add')).some(b => b.offsetParent !== null)`, { label: "tickets view ADD" });
  await jitter();

  // Standard × 3: click the first visible ADD (Standard is idx 0), then +2 on #add-item
  console.log("[run-order-03] adding Standard × 3");
  clickVisibleByIdIndex("add", 0); // activate Standard
  await waitFor(`!!document.getElementById('add-item')`, { label: "Standard add-item widget" });
  await jitter();
  clickVisibleByIdIndex("add-item", 0); // qty 1 → 2
  await jitter();
  clickVisibleByIdIndex("add-item", 0); // qty 2 → 3
  await jitter();

  // Premium × 2: Standard is transitioned, Premium is now the first visible #add button
  console.log("[run-order-03] adding Premium × 2");
  clickVisibleByIdIndex("add", 0); // activate Premium
  // Wait for two add-item widgets to exist (one per active card)
  await waitFor(`Array.from(document.querySelectorAll('#add-item')).filter(e => e.offsetParent !== null).length >= 2`, { label: "both cards' add-item widgets" });
  await jitter();
  clickVisibleByIdIndex("add-item", 1); // Premium is 2nd (idx 1), qty 1 → 2
  await jitter();

  console.log("[run-order-03] clicking PROCEED TO CHECKOUT");
  clickId("gp-test-proceed-to-checkout");
  await waitFor(`!!document.getElementById('main-full-name')`, { timeoutMs: 15000, label: "Step 1 form" });
  await sleep(800); // settle

  console.log("[run-order-03] Step 1 — filling contact info");
  fillBubbleInput("main-full-name", CONTACT_NAME);
  await jitter();
  fillBubbleInput("main-email", CONTACT_EMAIL);
  await jitter();

  console.log("[run-order-03] Step 1 — 'same for all tickets' checkbox");
  clickId("contact-info-same");
  await jitter();

  console.log("[run-order-03] Step 1 — 'authorized cardholder' checkbox (no id, class+text)");
  pwEvalVoid(`
    const el = Array.from(document.querySelectorAll('.clickable-element.bubble-element.Group'))
      .find((e) => e.textContent.includes('authorized cardholder'));
    if (!el) throw new Error('authorized cardholder checkbox not found');
    el.click();
  `);
  await jitter();

  console.log("[run-order-03] CONTINUE AS GUEST");
  clickId("continue-as-guest");
  await waitFor(`!!document.getElementById('toggle-terms') && !!document.getElementById('complete-order-authnet')`, { timeoutMs: 15000, label: "Step 2" });
  await sleep(1200); // toggle needs render time

  console.log("[run-order-03] Step 2 — flipping ionic terms toggle (inner <label>)");
  pwEvalVoid(`
    const el = document.getElementById('toggle-terms');
    const label = el.querySelector('label');
    if (!label) throw new Error('no <label> inside #toggle-terms');
    label.click();
  `);
  await sleep(500);
  const toggleChecked = pwEval(`(() => { const cb = document.querySelector('#toggle-terms input[type=checkbox]'); return cb ? cb.checked : false; })()`);
  if (toggleChecked !== "true") {
    console.log("[run-order-03] toggle didn't flip on first label click — forcing checkbox.click()");
    pwEvalVoid(`
      const cb = document.querySelector('#toggle-terms input[type=checkbox]');
      if (cb && !cb.checked) cb.click();
    `);
    await sleep(500);
  }

  console.log("[run-order-03] PAY NOW → Authorize.net");
  clickId("complete-order-authnet");
  // Now Authorize.net loads. Use run-code for pressSequentially + Pay button.
  await sleep(3000);

  console.log("[run-order-03] filling Authorize.net");
  // Real field names on Authorize.net's hosted payment form:
  //   input#cardNum, input#expiryDate, input#cvv (all type=tel)
  //   input[name="firstName"], input[name="lastName"], input[name="zip"],
  //   input[name="address"], input[name="city"], input[name="state"],
  //   input[name="phoneNumber"]
  //   button matching text "Pay" submits; after success, "Continue" appears.
  const authnetCode = `
    async (page) => {
      await page.waitForSelector('#cardNum', { timeout: 30000, state: 'visible' });
      await page.locator('#cardNum').click();
      await page.locator('#cardNum').pressSequentially(${JSON.stringify(CARD.number)}, { delay: 40 });
      await page.locator('#expiryDate').click();
      await page.locator('#expiryDate').pressSequentially(${JSON.stringify(CARD.exp)}, { delay: 40 });
      await page.locator('#cvv').click();
      await page.locator('#cvv').pressSequentially(${JSON.stringify(CARD.cvv)}, { delay: 40 });
      // Billing — overwrite Last Name (may auto-populate from Step-1), fill the rest.
      const lastName = page.locator('input[name="lastName"]');
      await lastName.click({ clickCount: 3 });
      await lastName.pressSequentially(${JSON.stringify(CARD.lastName)}, { delay: 30 });
      await page.locator('input[name="zip"]').click();
      await page.locator('input[name="zip"]').pressSequentially(${JSON.stringify(CARD.zip)}, { delay: 30 });
      await page.locator('input[name="address"]').click();
      await page.locator('input[name="address"]').pressSequentially(${JSON.stringify(CARD.address)}, { delay: 30 });
      await page.locator('input[name="city"]').click();
      await page.locator('input[name="city"]').pressSequentially(${JSON.stringify(CARD.city)}, { delay: 30 });
      await page.locator('input[name="state"]').click();
      await page.locator('input[name="state"]').pressSequentially(${JSON.stringify(CARD.state)}, { delay: 30 });
      // Submit
      await page.locator('button:has-text("Pay")').first().click();
      // Wait for the post-payment Continue button, then click it to return to Bubble
      await page.waitForSelector('button:has-text("Continue")', { timeout: 45000, state: 'visible' });
      await page.locator('button:has-text("Continue")').first().click();
    }
  `;
  const authnetOut = pw("run-code", authnetCode);
  // playwright-cli's run-code returns exit 0 even when the inner code throws — the error
  // is embedded in the "### Result" section. Detect and escalate.
  if (/"err"\s*:/.test(authnetOut) || /TimeoutError|Error:/.test(authnetOut)) {
    throw new Error("Authorize.net run-code reported an error:\n" + authnetOut.split("\n").slice(0, 20).join("\n"));
  }

  console.log("[run-order-03] waiting for success heading back on Bubble");
  // Debug: print current URL before we start waiting, so we know where Authorize.net's Continue landed us
  try {
    const state = pwEval(`({ url: location.href, title: document.title, sample: (document.body && document.body.innerText || '').slice(0, 300) })`);
    console.log(`  [debug] post-authnet state: ${state}`);
  } catch {}
  await waitFor(
    `!!Array.from(document.querySelectorAll('*')).find(e => /Purchase Completed|Order Confirmed/i.test(e.textContent || ''))`,
    { timeoutMs: 45000, label: "success heading" }
  );

  // Per-order floor to avoid outrunning Bubble's async workflows
  const elapsed = Date.now() - started;
  if (elapsed < MIN_ORDER_MS) {
    const rem = MIN_ORDER_MS - elapsed;
    console.log(`[run-order-03] padding ${rem}ms to hit ${MIN_ORDER_MS}ms floor`);
    await sleep(rem);
  }

  console.log("[run-order-03] closing session");
  try { pw("close"); } catch { /* already closed */ }
  try { pw("delete-data"); } catch {}

  // Reconcile to real Bubble order ID
  console.log("[run-order-03] resolving Bubble order ID by contact email");
  await sleep(8000); // let backend settle before querying
  const order = await queryOrderIdByEmail(CONTACT_EMAIL);
  if (!order) throw new Error(`no gp_order found for email ${CONTACT_EMAIL}`);

  const total = Number(order["Total Order Value"]);
  const wallSec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[run-order-03] SUCCESS`);
  console.log(`  orderId:      ${order._id}`);
  console.log(`  total:        $${total.toFixed(2)} (expected $${EXPECTED_TOTAL.toFixed(2)})`);
  console.log(`  wall time:    ${wallSec}s`);
  if (Math.abs(total - EXPECTED_TOTAL) > 0.02) {
    console.error(`[run-order-03] WARN — total mismatch`);
    process.exit(2);
  }
}

run().catch((err) => {
  console.error("[run-order-03] FAIL:", err.message);
  // Leave the browser open for post-mortem; caller can run `playwright-cli close-all` manually.
  console.error("  (browser left open for inspection; run `playwright-cli close-all` to clean up)");
  process.exit(1);
});
