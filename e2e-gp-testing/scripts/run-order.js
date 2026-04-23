#!/usr/bin/env node
/**
 * Spec-driven deterministic runner. Reads orders.json, resolves the order by
 * --order N (or a free-form --spec file), enriches it with runtime state from
 * e2e-state.json, and dispatches to the sequencer named by spec.flow.
 *
 * Usage:
 *   node scripts/run-order.js --order 3
 *   node scripts/run-order.js --spec path/to/ad-hoc-spec.json
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// ─── runtime state (set by runOrder before any helper runs) ────────────────
let SESSION = null;
const HEADED = process.env.HEADED !== "false";
const VIEWPORT_WIDTH = parseInt(process.env.VIEWPORT_WIDTH || "1440", 10);
const VIEWPORT_HEIGHT = parseInt(process.env.VIEWPORT_HEIGHT || "900", 10);
const MIN_ORDER_MS = 25000;

const CANONICAL_TICKET_ORDER = [
  "Standard",
  "Premium",
  "Standard Unlimited",
  "Premium Unlimited"
];

// ─── low-level helpers ─────────────────────────────────────────────────────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function jitter() { return sleep(200 + Math.floor(Math.random() * 400)); }

function pw(...args) {
  if (!SESSION) throw new Error("pw() called before SESSION initialised — runOrder must set it from spec.session");
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
  const raw = pw("eval", `() => { return (${js}); }`);
  const m = raw.match(/### Result\n([\s\S]*?)(?:\n### |$)/);
  return m ? m[1].trim() : "";
}

function pwEvalVoid(js) {
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

// ─── primitives (flow-agnostic) ────────────────────────────────────────────

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

    const widgetIdx = activated.size;
    for (let j = 1; j < entry.qty; j++) {
      clickVisibleByIdIndex("add-item", widgetIdx);
      await jitter();
    }
    activated.add(entry.type);
  }
}

function fillContact({ name, email }) {
  console.log(`[fillContact] name=${name} email=${email}`);
  fillBubbleInput("main-full-name", name);
  fillBubbleInput("main-email", email);
}

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

function toggleTerms() {
  console.log("[toggleTerms] clicking inner <label>");
  pwEvalVoid(`
    const el = document.getElementById('toggle-terms');
    const label = el.querySelector('label');
    if (!label) throw new Error('no <label> inside #toggle-terms');
    label.click();
  `);
}

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

// ─── primitives awaiting discovery (stubs) ─────────────────────────────────
// These primitives have documented business logic in runbook.md (Phase 2 flow
// descriptions + Gotchas Registry) but their specific element IDs and selectors
// have not been captured by a discovery run yet. They throw with clear pointers
// so the failure mode is "run discovery", not "debug mystery silent no-op".

/**
 * Open the login popup from the tickets-view header (the Login link does NOT
 * appear on the landing view — runbook § Login & Signup), fill email + password,
 * click LOG IN, wait for the popup to close and logged-in state to settle.
 * Caller must already be on the tickets view when this is invoked.
 *
 * Needs discovery: top-right Login link selector; popup email/password field
 * IDs; LOG IN button ID; post-login state signal (Login link gone? Avatar?).
 */
async function loginViaPopup(/* creds */) {
  throw new Error(
    "loginViaPopup: not implemented — selectors need discovery. " +
    "Run the Phase 0 discovery agent for logged-in-checkout (see runbook § Phase 0), " +
    "populate discovery-logged-in-checkout.json, then fill in this primitive."
  );
}

/**
 * Apply a promo code on the tickets page — runbook line 242:
 *   "click ENTER PROMO CODE at the bottom → enter code → submit/apply".
 * Called from fragmentTicketSelection when spec.promo is set, BEFORE
 * PROCEED TO CHECKOUT.
 *
 * Needs discovery: ENTER PROMO CODE link ID; promo input field ID; submit
 * button ID; how the cart subtotal updates (what to wait on).
 */
async function applyPromoOnTickets(/* code */) {
  throw new Error(
    "applyPromoOnTickets: not implemented — selectors need discovery. " +
    "This primitive is shared across every flow that uses a promo (orders " +
    "#6-10, #11, #12, #14, #15, #17, #18, #19, #20). Discover once from any of " +
    "those flows' Phase 0 run and this primitive lights up for all of them."
  );
}

/**
 * Authorize.net "+ Add Payment Method" detour. First order for a given
 * logged-in user with no saved card: PAY NOW is inert. See Gotchas Registry
 * "Authorize.net: Add Payment Method detour...". The detour:
 *   1. Click + Add Payment Method on Step 2 (needs discovery for its ID).
 *   2. Redirected to Authorize.net customer/addPayment (not payment/payment).
 *   3. Fill card + billing with pressSequentially — same pattern as payAuthNet.
 *   4. Click SAVE (not Pay) — selector very likely button:has-text("Save").
 *   5. Return to Step 2. Terms toggle RESETS — caller must reToggleTerms().
 *
 * Needs discovery: + Add Payment Method button ID on Step 2.
 */
async function addPaymentMethod(/* card */) {
  throw new Error(
    "addPaymentMethod: not implemented — the '+ Add Payment Method' button on " +
    "Step 2 needs its ID captured via discovery. Body can reuse payAuthNet's " +
    "pressSequentially pattern (Authorize.net fields are identical on the " +
    "customer/addPayment page); SAVE replaces Pay."
  );
}

/** Re-flip the terms toggle after a round-trip that resets it (addPayment detour). */
async function reToggleTerms() {
  console.log("[reToggleTerms] re-flipping after round-trip");
  toggleTerms();
  await verifyTermsToggleOn();
}

// ─── setup / teardown primitives (shared by all flows) ─────────────────────

/**
 * Clean the session, open the event URL with a pinned viewport, and wait for
 * the landing view's Tickets button to exist. See Gotchas Registry
 * "Browser session: headless needs an explicit viewport".
 */
async function openEventPage(spec) {
  const tag = `[order-${pad2(spec.orderNumber)}]`;
  console.log(`${tag} cleaning session`);
  try { pw("delete-data"); } catch { /* first-run no-op */ }

  console.log(`${tag} opening event page (${HEADED ? "headed" : "headless"}) at ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`);
  if (HEADED) pw("open", spec.event.url, "--headed");
  else pw("open", spec.event.url);
  try { pw("resize", String(VIEWPORT_WIDTH), String(VIEWPORT_HEIGHT)); } catch { /* resize can fail on some platforms */ }
  pw("run-code", `async (page) => { await page.setViewportSize({ width: ${VIEWPORT_WIDTH}, height: ${VIEWPORT_HEIGHT} }); }`);

  await waitFor(`!!document.getElementById('gp-test-tickets-button')`, { label: "landing Tickets button" });
  await jitter();
}

/**
 * After success: hold for the Bubble async-workflow floor, close the session,
 * then query the Bubble Data API for the resulting gp_order.
 */
async function closeAndReconcile(spec, startedMs) {
  const tag = `[order-${pad2(spec.orderNumber)}]`;
  const elapsed = Date.now() - startedMs;
  if (elapsed < MIN_ORDER_MS) {
    const rem = MIN_ORDER_MS - elapsed;
    console.log(`${tag} padding ${rem}ms to hit ${MIN_ORDER_MS}ms floor`);
    await sleep(rem);
  }

  console.log(`${tag} closing session`);
  try { pw("close"); } catch { /* already closed */ }
  try { pw("delete-data"); } catch {}

  console.log(`${tag} resolving Bubble order ID by contact email`);
  await sleep(8000); // let backend settle before querying
  const order = await reconcileOrderByEmail(spec.contact.email, spec.event.id);
  if (!order) throw new Error(`no gp_order found for email ${spec.contact.email}`);
  return { order, wallMs: Date.now() - startedMs };
}

// ─── fragments (reusable mid-level compositions) ───────────────────────────

/**
 * Tickets view: open (unless caller is already there), add the ticket mix,
 * apply promo if any, proceed to Step 1. Shared by every flow that drives a
 * purchase — guest, logged-in, register-in-checkout, etc.
 *
 * @param {object} spec - the order spec
 * @param {object} opts
 * @param {boolean} opts.alreadyOnTicketsView - caller already navigated to
 *   the tickets view (e.g. logged-in flows login from the tickets-view header).
 */
async function fragmentTicketSelection(spec, { alreadyOnTicketsView = false } = {}) {
  const tag = `[order-${pad2(spec.orderNumber)}]`;

  if (!alreadyOnTicketsView) {
    console.log(`${tag} opening tickets view`);
    clickId("gp-test-tickets-button");
    await waitFor(
      `Array.from(document.querySelectorAll('button#add')).some(b => b.offsetParent !== null)`,
      { label: "tickets view ADD" }
    );
    await jitter();
  }

  await addTickets(spec.tickets);

  if (spec.promo) {
    console.log(`${tag} applying promo ${spec.promo}`);
    await applyPromoOnTickets(spec.promo);
  }

  console.log(`${tag} PROCEED TO CHECKOUT`);
  clickId("gp-test-proceed-to-checkout");
  await waitFor(`!!document.getElementById('main-full-name')`, { timeoutMs: 15000, label: "Step 1 form" });
  await sleep(800); // settle
}

/**
 * Step 1: fill contact, flip both consent checkboxes, then exit via the mode-
 * specific button. Mode selects the Step-1 exit: "guest" → CONTINUE AS GUEST,
 * "register" → REGISTER & SAVE INFO (signup sub-form, PR 4+), "loggedIn" →
 * form may pre-fill; flow still needs consent + CONTINUE (PR 4).
 */
async function fragmentStep1Contact(spec, { mode }) {
  const tag = `[order-${pad2(spec.orderNumber)}]`;
  console.log(`${tag} Step 1 — contact + consent (mode=${mode})`);
  fillContact(spec.contact);
  await jitter();
  completeStep1Consent();
  await jitter();

  if (mode === "guest") {
    console.log(`${tag} CONTINUE AS GUEST`);
    clickId("continue-as-guest");
  } else if (mode === "register") {
    throw new Error("fragmentStep1Contact: mode=register not yet implemented (PR 4+)");
  } else if (mode === "loggedIn") {
    throw new Error("fragmentStep1Contact: mode=loggedIn not yet implemented (PR 4)");
  } else {
    throw new Error(`fragmentStep1Contact: unknown mode ${JSON.stringify(mode)}`);
  }

  await waitFor(
    `!!document.getElementById('toggle-terms') && !!document.getElementById('complete-order-authnet')`,
    { timeoutMs: 15000, label: "Step 2" }
  );
  await sleep(1200); // toggle needs render time
}

/**
 * Step 2: terms toggle (with verify + fallback), then pay. For the current
 * guest-checkout-no-promo scope this always goes through payAuthNet. Branches
 * for $0 orders (COMPLETE ORDER 0$) and the first-order-per-logged-in-user
 * addPaymentMethod detour land in PR 4+.
 */
async function fragmentStep2Pay(spec) {
  const tag = `[order-${pad2(spec.orderNumber)}]`;
  console.log(`${tag} Step 2 — terms toggle`);
  toggleTerms();
  await verifyTermsToggleOn();

  // TODO($0, PR 4+): detect zero-order button → payZero() instead of PAY NOW + authnet.
  console.log(`${tag} PAY NOW → Authorize.net`);
  clickId("complete-order-authnet");
  await sleep(3000);

  // TODO(addPayment, PR 4): detect customer/addPayment landing → addPaymentMethod + reToggleTerms + retry.
  payAuthNet(spec.card);

  console.log(`${tag} waiting for success heading`);
  await waitForSuccess();
}

// ─── flow sequencer: guest-checkout ────────────────────────────────────────

async function runGuestFlow(spec) {
  const started = Date.now();
  await openEventPage(spec);
  await fragmentTicketSelection(spec);
  await fragmentStep1Contact(spec, { mode: "guest" });
  await fragmentStep2Pay(spec);
  return await closeAndReconcile(spec, started);
}

// ─── flow sequencer: logged-in-checkout ────────────────────────────────────
// Scaffolded; requires discovery for loginViaPopup, applyPromoOnTickets,
// addPaymentMethod, and the loggedIn-mode exit of fragmentStep1Contact.

async function runLoggedInFlow(spec) {
  if (!spec.user) {
    throw new Error("runLoggedInFlow: spec.user is required (string id 'A'/'B'/'C' resolved to guestUsers entry in enrichSpec)");
  }
  const started = Date.now();
  const tag = `[order-${pad2(spec.orderNumber)}]`;

  await openEventPage(spec);

  // The Login link only appears inside the tickets view (runbook § Login & Signup).
  console.log(`${tag} opening tickets view (for login link)`);
  clickId("gp-test-tickets-button");
  await waitFor(
    `Array.from(document.querySelectorAll('button#add')).some(b => b.offsetParent !== null)`,
    { label: "tickets view ADD" }
  );
  await jitter();

  console.log(`${tag} logging in as User ${spec.user.id} (${spec.user.email})`);
  await loginViaPopup({ email: spec.user.email, password: spec.user.password });

  // Already on tickets view — skip the Tickets-button click in the fragment.
  await fragmentTicketSelection(spec, { alreadyOnTicketsView: true });
  await fragmentStep1Contact(spec, { mode: "loggedIn" });
  await fragmentStep2Pay(spec); // handles the addPaymentMethod detour internally

  return await closeAndReconcile(spec, started);
}

// ─── dispatch ──────────────────────────────────────────────────────────────

const FLOW_SEQUENCERS = {
  "guest-checkout": runGuestFlow,
  "logged-in-checkout": runLoggedInFlow
};

async function runOrder(spec) {
  if (!spec.session) throw new Error("runOrder: spec.session missing (loadSpec sets this)");
  SESSION = spec.session;

  const flow = FLOW_SEQUENCERS[spec.flow];
  if (!flow) {
    throw new Error(`no sequencer for flow ${JSON.stringify(spec.flow)} (known: ${Object.keys(FLOW_SEQUENCERS).join(", ")})`);
  }

  const { order, wallMs } = await flow(spec);

  const total = Number(order["Total Order Value"]);
  const wallSec = (wallMs / 1000).toFixed(1);
  const tag = `[order-${pad2(spec.orderNumber)}]`;
  console.log(`${tag} SUCCESS`);
  console.log(`  orderId:      ${order._id}`);
  if (spec.expectedTotal == null) {
    console.log(`  total:        $${total.toFixed(2)} (spec.expectedTotal is null — first run; copy this value back into orders.json)`);
  } else {
    console.log(`  total:        $${total.toFixed(2)} (expected $${spec.expectedTotal.toFixed(2)})`);
  }
  console.log(`  wall time:    ${wallSec}s`);
  if (spec.expectedTotal != null && Math.abs(total - spec.expectedTotal) > 0.02) {
    console.error(`${tag} WARN — total mismatch`);
    process.exit(2);
  }
  return { order, total, wallMs };
}

// ─── spec loading ──────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, "0"); }

function substituteTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function enrichSpec(rawSpec, { defaults = {}, state = null } = {}) {
  if (typeof rawSpec.orderNumber !== "number") throw new Error("spec: orderNumber must be a number");
  const T = Date.now();
  const N = pad2(rawSpec.orderNumber);

  const card = rawSpec.card || defaults.card || null;
  if (!card) throw new Error("spec: missing card (no spec.card and no defaults.card)");

  const event = (state && state.event) || rawSpec.event;
  if (!event || !event.url || !event.id) {
    throw new Error("spec: missing event info — expected state.event or spec.event with { url, id }");
  }

  if (!rawSpec.contact || !rawSpec.contact.name || !rawSpec.contact.email) {
    throw new Error("spec: contact.name and contact.email are required");
  }

  // Resolve user reference (string id like "A") against state.guestUsers.
  let user = rawSpec.user;
  if (typeof user === "string") {
    const found = state && Array.isArray(state.guestUsers)
      ? state.guestUsers.find((g) => g.id === user)
      : null;
    if (!found) {
      throw new Error(`spec: user '${user}' not found in state.guestUsers (required for ${rawSpec.flow})`);
    }
    user = found;
  }

  return {
    ...rawSpec,
    session: `gp-order-${N}`,
    event,
    card,
    contact: {
      name: substituteTemplate(rawSpec.contact.name, { N, T }),
      email: substituteTemplate(rawSpec.contact.email, { N, T })
    },
    user
  };
}

function loadSpec({ order, specPath } = {}) {
  const root = path.join(__dirname, "..");

  if (specPath) {
    const raw = JSON.parse(fs.readFileSync(specPath, "utf8"));
    // ad-hoc spec file: no defaults/state merging by convention, caller provides a complete spec
    return enrichSpec(raw, {});
  }

  const ordersPath = path.join(root, "orders.json");
  const statePath = path.join(root, "e2e-state.json");
  const orders = JSON.parse(fs.readFileSync(ordersPath, "utf8"));
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const raw = orders.orders.find((o) => o.orderNumber === order);
  if (!raw) throw new Error(`no spec for order #${order} in ${ordersPath}`);
  return enrichSpec(raw, { defaults: orders.defaults || {}, state });
}

// ─── CLI ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { order: null, spec: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--order") args.order = parseInt(argv[++i], 10);
    else if (argv[i] === "--spec") args.spec = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("usage: run-order.js --order <N>");
      console.log("       run-order.js --spec <path-to-json>");
      process.exit(0);
    }
  }
  if (args.order == null && !args.spec) {
    throw new Error("usage: run-order.js --order <N> | --spec <path>");
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const spec = loadSpec({ order: args.order, specPath: args.spec });
  runOrder(spec).catch((err) => {
    console.error(`[order-${pad2(spec.orderNumber)}] FAIL:`, err.message);
    console.error("  (browser left open for inspection; run `playwright-cli close-all` to clean up)");
    process.exit(1);
  });
}

module.exports = {
  runOrder,
  loadSpec,
  primitives: {
    addTickets,
    fillContact,
    completeStep1Consent,
    toggleTerms,
    verifyTermsToggleOn,
    payAuthNet,
    waitForSuccess,
    reconcileOrderByEmail,
    openEventPage,
    closeAndReconcile,
    // Scaffolded (discovery pending)
    loginViaPopup,
    applyPromoOnTickets,
    addPaymentMethod,
    reToggleTerms
  },
  fragments: {
    fragmentTicketSelection,
    fragmentStep1Contact,
    fragmentStep2Pay
  },
  sequencers: FLOW_SEQUENCERS
};
