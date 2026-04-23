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
// Headless Chromium's default viewport is too small for Bubble's ticket-card
// transitions — the #add-item widget stays offsetParent=null. Force a desktop
// viewport in both modes so layout is deterministic. Override via env.
const VIEWPORT_WIDTH = parseInt(process.env.VIEWPORT_WIDTH || "1440", 10);
const VIEWPORT_HEIGHT = parseInt(process.env.VIEWPORT_HEIGHT || "900", 10);

// Canonical DOM order of ticket-type cards on the event page. addTickets() sorts
// the caller's mix by this order so its "first visible #add" walk correctly
// identifies each type even when a mix skips earlier types (e.g. Premium-only).
const CANONICAL_TICKET_ORDER = [
  "Standard",
  "Premium",
  "Standard Unlimited",
  "Premium Unlimited"
];

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

// ─── primitives (flow-agnostic building blocks) ────────────────────────────

/**
 * Add a mix of tickets to the cart. Each entry: { type, qty }.
 * Relies on the shared-ID disambiguation pattern (Gotchas Registry):
 *   - #add is shared by the per-type ADD buttons; activating one transitions
 *     that card to a quantity widget, removing its #add from the visible set.
 *   - Visible #add buttons stay in canonical DOM order (Standard → Premium →
 *     Std Unlimited → Prem Unlimited), so the target type's index among
 *     remaining #add buttons is (canonical_not_yet_activated).indexOf(type).
 *   - Once activated, the card's #add-item widget appears at the end of the
 *     visible #add-item list (DOM order follows canonical order).
 */
async function addTickets(mix) {
  const sorted = [...mix].sort(
    (a, b) => CANONICAL_TICKET_ORDER.indexOf(a.type) - CANONICAL_TICKET_ORDER.indexOf(b.type)
  );
  for (const entry of sorted) {
    if (CANONICAL_TICKET_ORDER.indexOf(entry.type) < 0) {
      throw new Error(`addTickets: unknown ticket type ${JSON.stringify(entry.type)}`);
    }
  }

  const activated = new Set();
  for (const entry of sorted) {
    const stillAvailable = CANONICAL_TICKET_ORDER.filter((t) => !activated.has(t));
    const addIdx = stillAvailable.indexOf(entry.type);

    console.log(`[addTickets] activating ${entry.type} (qty ${entry.qty}) via visible #add idx ${addIdx}`);
    clickVisibleByIdIndex("add", addIdx);

    const expectedWidgets = activated.size + 1;
    await waitFor(
      `Array.from(document.querySelectorAll('#add-item')).filter(e => e.offsetParent !== null).length >= ${expectedWidgets}`,
      { label: `${entry.type} add-item widget` }
    );
    await jitter();

    // The newly-activated card's #add-item is at the tail of the visible list
    // in canonical DOM order — i.e. at index = (number of cards already active
    // before this one) = activated.size.
    const widgetIdx = activated.size;
    for (let j = 1; j < entry.qty; j++) {
      clickVisibleByIdIndex("add-item", widgetIdx);
      await jitter();
    }

    activated.add(entry.type);
  }
}

/** Fill Step 1 contact info (Full Name + Email) using the Bubble native-setter pattern. */
function fillContact({ name, email }) {
  console.log(`[fillContact] name=${name} email=${email}`);
  fillBubbleInput("main-full-name", name);
  fillBubbleInput("main-email", email);
}

/**
 * Step 1 requires BOTH: #contact-info-same AND the "authorized cardholder"
 * consent checkbox (no id — class+text fallback). CONTINUE AS GUEST stays inert
 * if either is missed, so this primitive always flips them together.
 */
function completeStep1Consent() {
  console.log("[completeStep1Consent] 'same for all' + 'authorized cardholder'");
  clickId("contact-info-same");
  pwEvalVoid(`
    const el = Array.from(document.querySelectorAll('.clickable-element.bubble-element.Group'))
      .find((e) => e.textContent.includes('authorized cardholder'));
    if (!el) throw new Error('authorized cardholder checkbox not found');
    el.click();
  `);
}

/** Click the inner <label> of the #toggle-terms ionic toggle. Does not verify. */
function toggleTerms() {
  console.log("[toggleTerms] clicking inner <label>");
  pwEvalVoid(`
    const el = document.getElementById('toggle-terms');
    const label = el.querySelector('label');
    if (!label) throw new Error('no <label> inside #toggle-terms');
    label.click();
  `);
}

/**
 * Verify the terms toggle is flipped on. Ionic toggle sometimes no-ops on the
 * label click; fall back to clicking the inner checkbox directly. Returns true
 * once confirmed checked, throws if both paths fail.
 */
async function verifyTermsToggleOn() {
  await sleep(500);
  const first = pwEval(`(() => { const cb = document.querySelector('#toggle-terms input[type=checkbox]'); return cb ? cb.checked : false; })()`);
  if (first === "true") return;

  console.log("[verifyTermsToggleOn] toggle didn't flip on label — forcing checkbox.click()");
  pwEvalVoid(`
    const cb = document.querySelector('#toggle-terms input[type=checkbox]');
    if (cb && !cb.checked) cb.click();
  `);
  await sleep(500);
  const second = pwEval(`(() => { const cb = document.querySelector('#toggle-terms input[type=checkbox]'); return cb ? cb.checked : false; })()`);
  if (second !== "true") {
    throw new Error("verifyTermsToggleOn: terms toggle refused to flip via <label> and direct checkbox.click()");
  }
}

/**
 * Fill the Authorize.net hosted payment form, submit, and click Continue back
 * to Bubble. Runs entirely inside `playwright-cli run-code` because Angular
 * validation requires keystroke events (pressSequentially, not fill()).
 */
function payAuthNet(card) {
  console.log("[payAuthNet] filling hosted form");
  const code = `
    async (page) => {
      await page.waitForSelector('#cardNum', { timeout: 30000, state: 'visible' });
      await page.locator('#cardNum').click();
      await page.locator('#cardNum').pressSequentially(${JSON.stringify(card.number)}, { delay: 40 });
      await page.locator('#expiryDate').click();
      await page.locator('#expiryDate').pressSequentially(${JSON.stringify(card.exp)}, { delay: 40 });
      await page.locator('#cvv').click();
      await page.locator('#cvv').pressSequentially(${JSON.stringify(card.cvv)}, { delay: 40 });
      // Billing — overwrite Last Name (may auto-populate from Step-1), fill the rest.
      const lastName = page.locator('input[name="lastName"]');
      await lastName.click({ clickCount: 3 });
      await lastName.pressSequentially(${JSON.stringify(card.lastName)}, { delay: 30 });
      await page.locator('input[name="zip"]').click();
      await page.locator('input[name="zip"]').pressSequentially(${JSON.stringify(card.zip)}, { delay: 30 });
      await page.locator('input[name="address"]').click();
      await page.locator('input[name="address"]').pressSequentially(${JSON.stringify(card.address)}, { delay: 30 });
      await page.locator('input[name="city"]').click();
      await page.locator('input[name="city"]').pressSequentially(${JSON.stringify(card.city)}, { delay: 30 });
      await page.locator('input[name="state"]').click();
      await page.locator('input[name="state"]').pressSequentially(${JSON.stringify(card.state)}, { delay: 30 });
      await page.locator('button:has-text("Pay")').first().click();
      await page.waitForSelector('button:has-text("Continue")', { timeout: 45000, state: 'visible' });
      await page.locator('button:has-text("Continue")').first().click();
    }
  `;
  const out = pw("run-code", code);
  if (/"err"\s*:/.test(out) || /TimeoutError|Error:/.test(out)) {
    throw new Error("payAuthNet: run-code reported an error:\n" + out.split("\n").slice(0, 20).join("\n"));
  }
}

/** Poll for the Bubble success heading (Purchase Completed | Order Confirmed). */
async function waitForSuccess() {
  try {
    const state = pwEval(`({ url: location.href, title: document.title, sample: (document.body && document.body.innerText || '').slice(0, 300) })`);
    console.log(`[waitForSuccess] post-authnet state: ${state}`);
  } catch { /* debug-only */ }
  await waitFor(
    `!!Array.from(document.querySelectorAll('*')).find(e => /Purchase Completed|Order Confirmed/i.test(e.textContent || ''))`,
    { timeoutMs: 45000, label: "success heading" }
  );
}

/** Query the Bubble Data API for the most-recent gp_order with this email on this event. */
async function reconcileOrderByEmail(email, eventId) {
  const { searchThings } = require("../../config/bubbleClient");
  const orders = await searchThings("gp_order", [
    { key: "Event", constraint_type: "equals", value: eventId }
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

  console.log(`[run-order-03] opening event page (${HEADED ? "headed" : "headless"}) at ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`);
  if (HEADED) pw("open", EVENT_URL, "--headed");
  else pw("open", EVENT_URL);
  // Pin the window and the Playwright viewport. setViewportSize is what drives
  // CSS/layout in headless; resize keeps the headed window consistent too.
  try { pw("resize", String(VIEWPORT_WIDTH), String(VIEWPORT_HEIGHT)); } catch { /* resize can fail on some platforms; viewport below is the critical one */ }
  pw("run-code", `async (page) => { await page.setViewportSize({ width: ${VIEWPORT_WIDTH}, height: ${VIEWPORT_HEIGHT} }); }`);
  // Bubble's landing view — wait for the Tickets button to exist
  await waitFor(`!!document.getElementById('gp-test-tickets-button')`, { label: "landing Tickets button" });
  await jitter();

  console.log("[run-order-03] clicking Tickets");
  clickId("gp-test-tickets-button");
  // Wait for the tickets view — at least one ADD button visible
  await waitFor(`Array.from(document.querySelectorAll('button#add')).some(b => b.offsetParent !== null)`, { label: "tickets view ADD" });
  await jitter();

  await addTickets([
    { type: "Standard", qty: 3 },
    { type: "Premium", qty: 2 }
  ]);

  console.log("[run-order-03] clicking PROCEED TO CHECKOUT");
  clickId("gp-test-proceed-to-checkout");
  await waitFor(`!!document.getElementById('main-full-name')`, { timeoutMs: 15000, label: "Step 1 form" });
  await sleep(800); // settle

  console.log("[run-order-03] Step 1 — contact info + consent");
  fillContact({ name: CONTACT_NAME, email: CONTACT_EMAIL });
  await jitter();
  completeStep1Consent();
  await jitter();

  console.log("[run-order-03] CONTINUE AS GUEST");
  clickId("continue-as-guest");
  await waitFor(`!!document.getElementById('toggle-terms') && !!document.getElementById('complete-order-authnet')`, { timeoutMs: 15000, label: "Step 2" });
  await sleep(1200); // toggle needs render time

  console.log("[run-order-03] Step 2 — terms toggle");
  toggleTerms();
  await verifyTermsToggleOn();

  console.log("[run-order-03] PAY NOW → Authorize.net");
  clickId("complete-order-authnet");
  await sleep(3000);

  payAuthNet(CARD);

  console.log("[run-order-03] waiting for success heading back on Bubble");
  await waitForSuccess();

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
  const order = await reconcileOrderByEmail(CONTACT_EMAIL, EVENT_ID);
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
