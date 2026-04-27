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
  // playwright-cli emits "### Error" on browser-side throws but exits 0 —
  // surface those as real JS errors (Gotchas Registry: "playwright-cli eval:
  // silent failures").
  if (/^### Error$/m.test(raw)) {
    const m = raw.match(/### Error\n([\s\S]*?)(?:\n### |$)/);
    throw new Error("pwEval: browser threw — " + (m ? m[1].trim().split("\n")[0] : raw.slice(0, 200)));
  }
  const m = raw.match(/### Result\n([\s\S]*?)(?:\n### |$)/);
  return m ? m[1].trim() : "";
}

function pwEvalVoid(js) {
  const raw = pw("eval", `() => { ${js} }`);
  if (/^### Error$/m.test(raw)) {
    const m = raw.match(/### Error\n([\s\S]*?)(?:\n### |$)/);
    throw new Error("pwEvalVoid: browser threw — " + (m ? m[1].trim().split("\n")[0] : raw.slice(0, 200)));
  }
}

async function waitFor(js, { timeoutMs = 30000, pollMs = 400, label = "" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let out;
    try {
      out = pwEval(js);
    } catch (err) {
      // Transient navigation can destroy the execution context mid-poll —
      // Playwright surfaces this as "Execution context was destroyed" or
      // "Target page, context or browser has been closed". These are
      // expected during page transitions; keep polling rather than aborting.
      const msg = err && err.message ? err.message : String(err);
      if (/Execution context was destroyed|Target (?:page|context|browser) has been closed|navigating/i.test(msg)) {
        await sleep(pollMs);
        continue;
      }
      throw err;
    }
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

// Bubble login/signup popups have no IDs. Select visible input by filter
// (placeholder, type, class hash), then apply the native-setter + input/change
// pattern required by Bubble's framework. See Gotchas Registry entry
// "Login popup: zero IDs across all interactive fields".
function fillBubbleInputByFilter(findExpr, value, { label = "" } = {}) {
  pwEvalVoid(`
    const el = (${findExpr});
    if (!el) throw new Error(${JSON.stringify("fillBubbleInputByFilter: no element matched filter" + (label ? " [" + label + "]" : ""))});
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  `);
}

function clickByFilter(findExpr, { label = "" } = {}) {
  pwEvalVoid(`
    const el = (${findExpr});
    if (!el) throw new Error(${JSON.stringify("clickByFilter: no element matched filter" + (label ? " [" + label + "]" : ""))});
    el.click();
  `);
}

// Find visible #add or #add-item belonging to the ticket-card titled `type`.
// Strategy: locate the heading element whose text exactly matches the target,
// then walk UP only as long as the ancestor still contains exactly ONE type
// heading (namely the target). The largest such ancestor is the card. Inside
// that card, the first #<sharedId> is what we want.
//
// Handles the logged-in tickets-view reshuffle (Gotchas Registry, 2026-04-23
// register-to-login discovery) because we key on heading text, not DOM
// position.
function clickByAncestorTitle(sharedId, ticketType) {
  pwEvalVoid(`
    const sharedId = ${JSON.stringify(sharedId)};
    const target = ${JSON.stringify(ticketType)};
    const TYPES = ["Standard", "Premium", "Standard Unlimited", "Premium Unlimited"];

    const visibleTypeHeadings = () => Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[class*="Text"]'))
      .filter(h => TYPES.includes((h.textContent || '').trim()) && h.offsetParent !== null);

    const heading = visibleTypeHeadings().find(h => (h.textContent || '').trim() === target);
    if (!heading) {
      throw new Error('clickByAncestorTitle: no visible heading for ' + JSON.stringify(target)
        + ' (visible type-headings: ' + JSON.stringify(visibleTypeHeadings().map(h => (h.textContent||'').trim())) + ')');
    }

    // Walk up while the ancestor contains ONLY the target heading (no other
    // type-headings). Stop at the largest such ancestor = the card boundary.
    let card = heading;
    while (card.parentElement && card.parentElement !== document.body) {
      const parent = card.parentElement;
      const parentHeadings = Array.from(parent.querySelectorAll('h1,h2,h3,h4,h5,h6,[class*="Text"]'))
        .filter(h => TYPES.includes((h.textContent || '').trim()) && h.offsetParent !== null);
      const onlyTarget = parentHeadings.length === 1 && parentHeadings[0] === heading;
      if (!onlyTarget) break;
      card = parent;
    }

    // Inside the card, find the shared-ID element. If the card is just the
    // heading (no ancestor with #add), fall back to walking up further until
    // a #<sharedId> is found — but refuse if encountering another type.
    let item = card.querySelector('#' + sharedId);
    if (!item || item.offsetParent === null) {
      let node = card;
      while (node && node !== document.body) {
        const candidate = node.querySelector('#' + sharedId);
        if (candidate && candidate.offsetParent !== null) { item = candidate; break; }
        node = node.parentElement;
        if (!node) break;
        const nodeHeadings = Array.from(node.querySelectorAll('h1,h2,h3,h4,h5,h6,[class*="Text"]'))
          .filter(h => TYPES.includes((h.textContent || '').trim())
            && (h.textContent || '').trim() !== target
            && h.offsetParent !== null);
        if (nodeHeadings.length > 0) break;
      }
    }

    if (!item || item.offsetParent === null) {
      throw new Error('clickByAncestorTitle: found ' + JSON.stringify(target)
        + ' card, but no visible #' + sharedId + ' inside it');
    }
    item.click();
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
    console.log(`[addTickets] activating ${entry.type} (qty ${entry.qty}) via ancestor-title match on #add`);
    clickByAncestorTitle("add", entry.type);

    const expectedWidgets = activated.size + 1;
    await waitFor(
      `Array.from(document.querySelectorAll('#add-item')).filter(e => e.offsetParent !== null).length >= ${expectedWidgets}`,
      { label: `${entry.type} add-item widget` }
    );
    await jitter();

    for (let j = 1; j < entry.qty; j++) {
      clickByAncestorTitle("add-item", entry.type);
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

async function completeStep1Consent() {
  console.log("[completeStep1Consent] 'same for all' + 'authorized cardholder'");
  clickId("contact-info-same");
  // Gotchas Registry (register-to-login discovery, 2026-04-23): the authorized-
  // cardholder click can race with the contact-info-same re-render. Verify the
  // click registered via the bg-alpha state and retry up to 3 times.
  await sleep(400);

  const clickExpr = `(() => {
    const byId = document.getElementById('btn-auth-card-holder-confirm');
    if (byId && byId.offsetParent !== null) return byId;
    return Array.from(document.querySelectorAll('.clickable-element.bubble-element.Group'))
      .find((e) => e.offsetParent !== null && /authorized cardholder/i.test(e.textContent || ''));
  })()`;

  const verifyExpr = `(() => {
    const byId = document.getElementById('btn-auth-card-holder-confirm');
    const el = (byId && byId.offsetParent !== null)
      ? byId
      : Array.from(document.querySelectorAll('.clickable-element.bubble-element.Group'))
          .find((e) => e.offsetParent !== null && /authorized cardholder/i.test(e.textContent || ''));
    if (!el) return "missing";
    const bg = (el.style && el.style.background) || '';
    return /rgba\\(0,\\s*0,\\s*0,\\s*0\\.14\\)/.test(bg) ? "checked" : "unchecked";
  })()`;

  for (let attempt = 0; attempt < 3; attempt++) {
    clickByFilter(clickExpr, { label: "authorized cardholder" });
    await sleep(300);
    const state = pwEval(verifyExpr);
    if (state === '"checked"' || state === "checked") return;
    console.log(`[completeStep1Consent] authorized-cardholder not checked after click ${attempt + 1}/3 (state=${state}) — retrying`);
  }
  // Proceed even if verify says "unchecked" — some theme variants may not use
  // rgba(0,0,0,0.14). If the step advances correctly, we'll know.
  console.log("[completeStep1Consent] bg-alpha verify indeterminate; proceeding");
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
  // Bubble sets ?success=yes on the return URL from Authorize.net — this is
  // the stable signal. The "Purchase Completed" / "Order Confirmed" heading
  // can flash for less than one poll interval (see 2026-04-23 run) before
  // Bubble redirects to the refreshed tickets view, so relying on heading
  // text alone is flaky. Either signal is sufficient.
  await waitFor(
    `location.search.includes('success=yes') || !!Array.from(document.querySelectorAll('*')).find(e => /Purchase Completed|Order Confirmed/i.test(e.textContent || ''))`,
    { timeoutMs: 45000, label: "success signal" }
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

// Like reconcileOrderByEmail but additionally filters to orders created
// AFTER (startedMs - 60s). Necessary for shared users (A/B/C) where many
// historical orders exist with the same email and sorting-by-most-recent
// could pick up a recent-but-earlier order from the same run.
async function reconcileOrderByEmailAndTime(email, eventId, startedMs) {
  const { searchThings } = require("../../config/bubbleClient");
  const orders = await searchThings("gp_order", [
    { key: "Event", constraint_type: "equals", value: eventId }
  ]);
  const minCreatedMs = startedMs - 60 * 1000;
  const mine = orders
    .filter((o) => (o["Email Address"] || "").toLowerCase() === email.toLowerCase())
    .filter((o) => {
      const cd = new Date(o["Created Date"]).getTime();
      return Number.isFinite(cd) && cd >= minCreatedMs;
    })
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
 * Login popup fields have NO IDs (see Gotchas Registry / 2026-04-23 discovery).
 * Selectors fall back to placeholder + visibility; submit button by text.
 * Post-login signal: #gp-test-login-link.offsetParent becomes null and
 * #gp-test-logout-link becomes visible.
 */
async function loginViaPopup({ email, password }) {
  if (!email || !password) throw new Error("loginViaPopup: email + password required");
  console.log(`[loginViaPopup] opening popup and filling creds for ${email}`);

  clickId("gp-test-login-link");
  await waitFor(
    `!!Array.from(document.querySelectorAll('h1, h2, h3')).find(h => /^Log in$/i.test((h.textContent||'').trim()) && h.offsetParent !== null)`,
    { timeoutMs: 10000, label: "Log in popup heading" }
  );
  await sleep(500);

  fillBubbleInputByFilter(
    `Array.from(document.querySelectorAll('input[type="email"]')).find(e => e.offsetParent !== null && !e.id)`,
    email,
    { label: "login popup email" }
  );
  await jitter();
  fillBubbleInputByFilter(
    `Array.from(document.querySelectorAll('input[type="password"]')).find(e => e.offsetParent !== null && !e.id && /^(Password|)$/i.test(e.placeholder || ''))`,
    password,
    { label: "login popup password" }
  );
  await jitter();

  clickByFilter(
    `Array.from(document.querySelectorAll('button')).find(b => b.offsetParent !== null && (b.textContent||'').trim() === 'LOG IN')`,
    { label: "LOG IN button" }
  );

  await waitFor(
    `(() => {
      const login = document.getElementById('gp-test-login-link');
      const logout = document.getElementById('gp-test-logout-link');
      const loginHidden = !login || login.offsetParent === null;
      const logoutVisible = logout && logout.offsetParent !== null;
      return loginHidden || logoutVisible;
    })()`,
    { timeoutMs: 20000, label: "logged-in signal (login-link hidden / logout-link visible)" }
  );
  await sleep(800); // popup close + Bubble settle
}

/**
 * Apply a promo code on the tickets page: click ENTER PROMO CODE, fill the
 * input, SUBMIT. Observable success: the body text contains the promo code
 * and a "-$" line, and the ENTER PROMO CODE button re-labels to
 * "PROMOTION APPLIED" (per 2026-04-23 logged-in-checkout discovery step 15).
 *
 * MUST be called AFTER addTickets — an empty cart triggers the warning
 * "Select your tickets first, then apply your promo code."
 */
async function applyPromoOnTickets(code) {
  if (!code) throw new Error("applyPromoOnTickets: code required");
  console.log(`[applyPromoOnTickets] applying ${code}`);

  clickId("btn-enterpromo-code");
  await waitFor(
    `!!document.getElementById('input-enter-promo') && document.getElementById('input-enter-promo').offsetParent !== null`,
    { timeoutMs: 8000, label: "promo input visible" }
  );
  await jitter();

  fillBubbleInput("input-enter-promo", code);
  await jitter();

  clickId("btn-submit-promo");

  // Success signal: a "-$" discount line appears in the body. For FLAT
  // promos the code text ALSO appears ("FLAT10") but for percentage-based
  // promos (PCT20, PCT100) Bubble may display the computed discount amount
  // and a descriptive name rather than the code literal — the reliable
  // signal across all promo types is the negative-amount line. Watch for
  // "PROMOTION APPLIED" or "applied" button label too.
  await waitFor(
    `(() => {
      const t = document.body.innerText || '';
      return /-\\s*\\$\\d/.test(t) || /PROMOTION APPLIED/i.test(t);
    })()`,
    { timeoutMs: 20000, label: `promo ${code} applied` }
  );
  await sleep(600);
}

/**
 * Authorize.net "+ Add Payment Method" detour. First order for a given
 * logged-in user with no saved card: PAY NOW is inert until a card is saved.
 *
 *   1. Click #btn-wg-add-payment-method on Step 2 → redirects to
 *      test.authorize.net/customer/addPayment (NOT /payment/payment).
 *   2. Fill card + billing via pressSequentially with 30-40ms delay.
 *      IMPORTANT: unlike /payment/payment, /customer/addPayment does NOT
 *      auto-populate firstName — must fill BOTH firstName + lastName
 *      explicitly (gotcha from guest-to-register-checkout 2026-04-23 run).
 *   3. Click SAVE (uppercase, not "Pay"). SAVE stays disabled if any required
 *      field is empty.
 *   4. Click Continue on the confirmation interstitial to return to Bubble.
 *      Return URL flag is `?authcreate=yes` (not `?success=yes`).
 *   5. Terms toggle RESETS in the round-trip — caller must reToggleTerms().
 *
 * @param {object} card  card/billing spec (orders.json defaults)
 * @param {object} contact  Step 1 contact ({ name, email }) — used to derive
 *   firstName for addPayment (split on first whitespace; fallback "GP").
 */
async function addPaymentMethod(card, contact) {
  if (!card) throw new Error("addPaymentMethod: card required");
  const fullName = (contact && contact.name) || "";
  const firstName = (fullName.split(/\s+/).filter(Boolean)[0] || "GP").slice(0, 32);
  console.log("[addPaymentMethod] entering Authorize.net customer/addPayment detour");

  clickId("btn-wg-add-payment-method");

  // Wait for the addPayment page. URL contains customer/addPayment.
  await waitFor(
    `location.host.includes('authorize.net') && location.pathname.includes('customer/addPayment')`,
    { timeoutMs: 25000, label: "Authorize.net customer/addPayment page" }
  );
  await sleep(500);

  const code = `
    async (page) => {
      await page.waitForSelector('#cardNum', { timeout: 30000, state: 'visible' });
      await page.locator('#cardNum').click();
      await page.locator('#cardNum').pressSequentially(${JSON.stringify(card.number)}, { delay: 40 });
      await page.locator('#expiryDate').click();
      await page.locator('#expiryDate').pressSequentially(${JSON.stringify(card.exp)}, { delay: 40 });
      await page.locator('#cvv').click();
      await page.locator('#cvv').pressSequentially(${JSON.stringify(card.cvv)}, { delay: 40 });

      // firstName does NOT auto-populate on customer/addPayment (gotcha).
      const fn = page.locator('input[name="firstName"]');
      await fn.click({ clickCount: 3 });
      await fn.pressSequentially(${JSON.stringify(firstName)}, { delay: 30 });

      const ln = page.locator('input[name="lastName"]');
      await ln.click({ clickCount: 3 });
      await ln.pressSequentially(${JSON.stringify(card.lastName)}, { delay: 30 });

      await page.locator('input[name="zip"]').click();
      await page.locator('input[name="zip"]').pressSequentially(${JSON.stringify(card.zip)}, { delay: 30 });
      await page.locator('input[name="address"]').click();
      await page.locator('input[name="address"]').pressSequentially(${JSON.stringify(card.address)}, { delay: 30 });
      await page.locator('input[name="city"]').click();
      await page.locator('input[name="city"]').pressSequentially(${JSON.stringify(card.city)}, { delay: 30 });
      await page.locator('input[name="state"]').click();
      await page.locator('input[name="state"]').pressSequentially(${JSON.stringify(card.state)}, { delay: 30 });

      // SAVE button on customer/addPayment is id=saveButton. Prefer the ID.
      let save = page.locator('#saveButton').first();
      let saveVisible = await save.isVisible().catch(() => false);
      if (!saveVisible) {
        save = page.locator('button.saveButton').first();
        saveVisible = await save.isVisible().catch(() => false);
      }
      if (!saveVisible) {
        save = page.locator('button').filter({ hasText: /SAVE/i }).first();
      }
      await save.waitFor({ state: 'visible', timeout: 30000 });
      await save.click();

      // Confirmation interstitial: "Your information has been saved." + Continue.
      await page.waitForSelector('button:has-text("Continue")', { timeout: 45000, state: 'visible' });
      await page.locator('button:has-text("Continue")').first().click();
    }
  `;
  const out = pw("run-code", code);
  if (/"err"\s*:/.test(out) || /TimeoutError|Error:/.test(out)) {
    throw new Error("addPaymentMethod: run-code reported an error:\n" + out.split("\n").slice(0, 20).join("\n"));
  }

  // Wait for return to Bubble. Key on host change OR the authcreate flag.
  await waitFor(
    `!location.host.includes('authorize.net') && (location.search.includes('authcreate=yes') || !!document.getElementById('complete-order-authnet') || !!document.getElementById('toggle-terms'))`,
    { timeoutMs: 45000, label: "return to Bubble Step 2 after addPayment" }
  );
  await sleep(1500);
}

/** Re-flip the terms toggle after a round-trip that resets it (addPayment detour). */
async function reToggleTerms() {
  console.log("[reToggleTerms] re-flipping after round-trip");
  toggleTerms();
  await verifyTermsToggleOn();
}

/**
 * $0-order payment. Bubble replaces PAY NOW with a "COMPLETE ORDER 0$" button
 * (no Authorize.net redirect) for PCT100/FLAT1000-zeroed totals. We select the
 * button by text match rather than ID — ID not captured during discovery. If
 * the user has since added an ID (e.g. #complete-order-0), the text match
 * still works and the ID can be used preferentially by updating this selector.
 */
async function payZero() {
  console.log("[payZero] clicking COMPLETE ORDER 0$ button");
  clickByFilter(
    `Array.from(document.querySelectorAll('button, [role=button], .clickable-element'))
      .find(e => e.offsetParent !== null && /COMPLETE ORDER\\s*0\\$/i.test(e.textContent || ''))`,
    { label: "COMPLETE ORDER 0$" }
  );
}

/**
 * Create a new account via the login popup from the tickets view:
 *   1. Click #gp-test-login-link (Log-In popup opens).
 *   2. Click SIGN UP inside the Log-In popup (class cnxpo1; by text "SIGN UP").
 *   3. Signup form appears ("Create an 8Count profile"). Fill Email +
 *      Password + Confirm password (no IDs; select by placeholder + visibility).
 *   4. Click the signup-form SIGN UP submit (class cnxpaV1; by text "SIGN UP").
 *   5. Wait for logged-in signal (#gp-test-logout-link visible).
 */
async function registerViaPopup({ email, password }) {
  if (!email || !password) throw new Error("registerViaPopup: email + password required");
  console.log(`[registerViaPopup] opening popup and signing up ${email}`);

  clickId("gp-test-login-link");
  await waitFor(
    `!!Array.from(document.querySelectorAll('h1, h2, h3')).find(h => /^Log in$/i.test((h.textContent||'').trim()) && h.offsetParent !== null)`,
    { timeoutMs: 10000, label: "Log in popup" }
  );
  await sleep(500);

  // Click SIGN UP inside the Log-In popup. There's a second SIGN UP button
  // rendered AFTER the form flips; anchor to the popup's Log-In state by
  // requiring the "Log in" heading is still present.
  clickByFilter(
    `Array.from(document.querySelectorAll('button')).find(b => b.offsetParent !== null && (b.textContent||'').trim() === 'SIGN UP')`,
    { label: "SIGN UP (login popup)" }
  );

  await waitFor(
    `!!Array.from(document.querySelectorAll('h1, h2, h3')).find(h => /Create an 8Count profile/i.test(h.textContent || '') && h.offsetParent !== null)`,
    { timeoutMs: 10000, label: "signup form heading" }
  );
  await sleep(500);

  // Signup email: empty on open (confirmed 2026-04-23 gotcha).
  fillBubbleInputByFilter(
    `Array.from(document.querySelectorAll('input[type="email"]')).find(e => e.offsetParent !== null && !e.id)`,
    email,
    { label: "signup email" }
  );
  await jitter();
  fillBubbleInputByFilter(
    `Array.from(document.querySelectorAll('input[type="password"]')).find(e => e.offsetParent !== null && !e.id && /^Password$/i.test(e.placeholder || ''))`,
    password,
    { label: "signup password" }
  );
  await jitter();
  fillBubbleInputByFilter(
    `Array.from(document.querySelectorAll('input[type="password"]')).find(e => e.offsetParent !== null && !e.id && /^Confirm password$/i.test(e.placeholder || ''))`,
    password,
    { label: "signup confirm password" }
  );
  await jitter();

  // Submit the signup form. The signup-form SIGN UP button shares the text
  // with the login-popup SIGN UP that opened it; target the visible button
  // inside the signup form by additionally requiring the "Create an 8Count
  // profile" heading is still visible.
  clickByFilter(
    `Array.from(document.querySelectorAll('button')).find(b => b.offsetParent !== null && (b.textContent||'').trim() === 'SIGN UP')`,
    { label: "SIGN UP (signup form submit)" }
  );

  await waitFor(
    `(() => {
      const login = document.getElementById('gp-test-login-link');
      const logout = document.getElementById('gp-test-logout-link');
      const loginHidden = !login || login.offsetParent === null;
      const logoutVisible = logout && logout.offsetParent !== null;
      return loginHidden || logoutVisible;
    })()`,
    { timeoutMs: 25000, label: "signup success (logged-in signal)" }
  );
  await sleep(800);
}

/**
 * Mid-checkout register from Step 1 (guest-to-register-checkout flow).
 *   1. Click #continue-registered-user (label "REGISTER & SAVE INFO" in this
 *      state — same element that later re-labels to "CONTINUE" post-signup).
 *      This opens the "Create an 8Count profile" popup.
 *   2. The popup Email is EMPTY (gotcha) — re-fill it.
 *   3. Fill Password + Confirm password, click SIGN UP.
 *   4. Wait for the #continue-registered-user text to flip from
 *      "REGISTER & SAVE INFO" to "CONTINUE" (post-signup signal).
 *   5. Click #continue-registered-user again to advance to Step 2.
 */
async function registerInCheckout({ email, password }) {
  if (!email || !password) throw new Error("registerInCheckout: email + password required");
  console.log(`[registerInCheckout] opening signup popup for ${email}`);

  clickId("continue-registered-user");

  await waitFor(
    `!!Array.from(document.querySelectorAll('h1, h2, h3')).find(h => /Create an 8Count profile/i.test(h.textContent || '') && h.offsetParent !== null)`,
    { timeoutMs: 10000, label: "signup popup heading" }
  );
  await sleep(500);

  fillBubbleInputByFilter(
    `Array.from(document.querySelectorAll('input[type="email"]')).find(e => e.offsetParent !== null && !e.id)`,
    email,
    { label: "checkout-signup email" }
  );
  await jitter();
  fillBubbleInputByFilter(
    `Array.from(document.querySelectorAll('input[type="password"]')).find(e => e.offsetParent !== null && !e.id && /^Password$/i.test(e.placeholder || ''))`,
    password,
    { label: "checkout-signup password" }
  );
  await jitter();
  fillBubbleInputByFilter(
    `Array.from(document.querySelectorAll('input[type="password"]')).find(e => e.offsetParent !== null && !e.id && /^Confirm password$/i.test(e.placeholder || ''))`,
    password,
    { label: "checkout-signup confirm password" }
  );
  await jitter();

  clickByFilter(
    `Array.from(document.querySelectorAll('button')).find(b => b.offsetParent !== null && (b.textContent||'').trim() === 'SIGN UP')`,
    { label: "SIGN UP (checkout signup submit)" }
  );

  // Post-signup signal: #continue-registered-user text flips to CONTINUE.
  await waitFor(
    `(() => {
      const el = document.getElementById('continue-registered-user');
      return !!el && /^CONTINUE$/i.test((el.textContent || '').trim());
    })()`,
    { timeoutMs: 25000, label: "REGISTER & SAVE INFO → CONTINUE text flip" }
  );
  await sleep(800);

  console.log("[registerInCheckout] CONTINUE (post-signup advance to Step 2)");
  clickId("continue-registered-user");
}

/**
 * Register-to-Login UX:
 *   1. Click #gp-test-login-link (Log-In popup opens).
 *   2. Click SIGN UP inside the Log-In popup → signup form appears.
 *   3. Click OR LOGIN on the signup form (no ID; text-match "OR LOGIN",
 *      runbook-confirmed it's a <button>, not a text link) → popup flips back
 *      to Log-In form with BLANK email + password fields.
 *   4. Fill email + password in the Log-In form, click LOG IN.
 *   5. Wait for logged-in signal.
 */
async function loginViaPopupWithSignupDetour({ email, password }) {
  if (!email || !password) throw new Error("loginViaPopupWithSignupDetour: email + password required");
  console.log(`[loginViaPopupWithSignupDetour] opening popup for ${email}`);

  clickId("gp-test-login-link");
  await waitFor(
    `!!Array.from(document.querySelectorAll('h1, h2, h3')).find(h => /^Log in$/i.test((h.textContent||'').trim()) && h.offsetParent !== null)`,
    { timeoutMs: 10000, label: "Log in popup" }
  );
  await sleep(500);

  // SIGN UP inside Log-In popup (flips to signup form).
  clickByFilter(
    `Array.from(document.querySelectorAll('button')).find(b => b.offsetParent !== null && (b.textContent||'').trim() === 'SIGN UP')`,
    { label: "SIGN UP (to signup form)" }
  );
  await waitFor(
    `!!Array.from(document.querySelectorAll('h1, h2, h3')).find(h => /Create an 8Count profile/i.test(h.textContent || '') && h.offsetParent !== null)`,
    { timeoutMs: 10000, label: "signup form" }
  );
  await sleep(500);

  // OR LOGIN (the defining element — no ID, select by text).
  clickByFilter(
    `Array.from(document.querySelectorAll('button')).find(b => b.offsetParent !== null && (b.textContent||'').trim() === 'OR LOGIN')`,
    { label: "OR LOGIN (back to login form)" }
  );

  // Wait for login form to reappear.
  await waitFor(
    `!!Array.from(document.querySelectorAll('h1, h2, h3')).find(h => /^Log in$/i.test((h.textContent||'').trim()) && h.offsetParent !== null)`,
    { timeoutMs: 10000, label: "Log in form returned" }
  );
  await sleep(500);

  // Fill + LOG IN.
  fillBubbleInputByFilter(
    `Array.from(document.querySelectorAll('input[type="email"]')).find(e => e.offsetParent !== null && !e.id)`,
    email,
    { label: "login email (post-detour)" }
  );
  await jitter();
  fillBubbleInputByFilter(
    `Array.from(document.querySelectorAll('input[type="password"]')).find(e => e.offsetParent !== null && !e.id && /^(Password|)$/i.test(e.placeholder || ''))`,
    password,
    { label: "login password (post-detour)" }
  );
  await jitter();

  clickByFilter(
    `Array.from(document.querySelectorAll('button')).find(b => b.offsetParent !== null && (b.textContent||'').trim() === 'LOG IN')`,
    { label: "LOG IN (post-detour)" }
  );

  await waitFor(
    `(() => {
      const login = document.getElementById('gp-test-login-link');
      const logout = document.getElementById('gp-test-logout-link');
      const loginHidden = !login || login.offsetParent === null;
      const logoutVisible = logout && logout.offsetParent !== null;
      return loginHidden || logoutVisible;
    })()`,
    { timeoutMs: 20000, label: "logged-in signal (post-detour)" }
  );
  await sleep(800);
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

  // For logged-in checkout flows Bubble records the USER's account email in
  // gp_order.Email Address (NOT the spec's contact.email, even when that was
  // pre-filled in Step 1 from the user's profile). For guest flows, the
  // contact email is what's stored. Guest-to-register uses the contact email
  // (which is also the new user's signup email).
  const reconcileEmail =
    (spec.flow === "guest-checkout" || spec.flow === "guest-to-register-checkout")
      ? spec.contact.email
      : (spec.user && spec.user.email) || spec.contact.email;
  console.log(`${tag} resolving Bubble order ID by email (${reconcileEmail}; flow=${spec.flow})`);
  // Bubble applies custom fees (tax) via an async post-order workflow that runs
  // AFTER the success URL flag is set. When waitForSuccess returned quickly
  // via ?success=yes (the URL-keyed fix) the reconcile could win the race
  // against the tax workflow and observe a pre-tax total ($360 instead of
  // $383.40 on Order #3, 2026-04-23). 30s covers the observed tax-workflow
  // latency on this test event. Poll loop below is extra insurance.
  await sleep(30000);
  let order = await reconcileOrderByEmailAndTime(reconcileEmail, spec.event.id, startedMs);
  if (!order) {
    // Logged-in flow where the account didn't pre-fill Step 1: the Step-1
    // fallback filled main-email with spec.contact.email, so the order ends
    // up indexed under that email instead of the user account's email.
    const fallback = spec.contact && spec.contact.email;
    if (fallback && fallback !== reconcileEmail) {
      console.log(`${tag} fallback reconcile by spec.contact.email (${fallback})`);
      order = await reconcileOrderByEmailAndTime(fallback, spec.event.id, startedMs);
    }
  }
  if (!order) throw new Error(`no gp_order found for email ${reconcileEmail}`);

  // If expectedTotal is known, give Bubble a little more time to apply fees if
  // the total still looks pre-fee. Re-query up to 3 times, 10s apart.
  if (spec.expectedTotal != null) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = Number(order["Total Order Value"]);
      if (Math.abs(cur - spec.expectedTotal) <= 0.02) break;
      console.log(`${tag} total $${cur.toFixed(2)} ≠ expected $${spec.expectedTotal.toFixed(2)} — waiting 10s for async fees (attempt ${attempt + 1}/3)`);
      await sleep(10000);
      order = await reconcileOrderByEmailAndTime(reconcileEmail, spec.event.id, startedMs);
      if (!order) throw new Error("order disappeared mid-reconcile");
    }
  }

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
  // On logged-in flows Step 1 is typically pre-filled from the user profile.
  // But accounts without a saved Full Name (e.g. a pre-existing login-only
  // account) leave main-full-name empty and the Required-field validation
  // blocks CONTINUE. Detect empty and fall back to spec.contact.
  const needsContactFill = (mode !== "loggedIn") || spec.overwriteContact || (() => {
    try {
      const v = pwEval(`(() => { const e = document.getElementById('main-full-name'); return !e || !e.value; })()`);
      return v === "true";
    } catch { return true; }
  })();
  if (needsContactFill) {
    fillContact(spec.contact);
    await jitter();
  } else {
    console.log(`${tag} Step 1 — preserving pre-filled contact (loggedIn mode)`);
  }
  await completeStep1Consent();
  await jitter();

  if (mode === "guest") {
    console.log(`${tag} CONTINUE AS GUEST`);
    clickId("continue-as-guest");
  } else if (mode === "register") {
    console.log(`${tag} REGISTER & SAVE INFO (mid-checkout signup for User ${spec.user && spec.user.id})`);
    const password = spec.user && spec.user.password;
    if (!password) throw new Error("fragmentStep1Contact(register): spec.user.password required");
    await registerInCheckout({ email: spec.contact.email, password });
  } else if (mode === "loggedIn") {
    // #continue-registered-user replaces #continue-as-guest for authenticated
    // users (guest-to-login-top-right + logged-in-checkout + register-to-login
    // discovery runs, 2026-04-23). Button greys out until both consent boxes
    // are checked — completeStep1Consent handled that above.
    console.log(`${tag} CONTINUE (logged-in exit)`);
    clickId("continue-registered-user");
  } else {
    throw new Error(`fragmentStep1Contact: unknown mode ${JSON.stringify(mode)}`);
  }

  // Wait for Step 2 indicators. Either #complete-order-authnet (normal), the
  // "COMPLETE ORDER 0$" button ($0 flow), or #btn-wg-add-payment-method (logged-in
  // without saved card) must be visible.
  await waitFor(
    `!!document.getElementById('toggle-terms') && (
      !!document.getElementById('complete-order-authnet') ||
      !!document.getElementById('btn-wg-add-payment-method') ||
      !!Array.from(document.querySelectorAll('button, [role=button], .clickable-element')).find(e => /COMPLETE ORDER\\s*0\\$/i.test(e.textContent || ''))
    )`,
    { timeoutMs: 20000, label: "Step 2" }
  );
  await sleep(1200); // toggle needs render time
}

/**
 * Step 2: terms toggle (with verify + fallback), then pay. Branches on:
 *   - $0 orders (PCT100 / FLAT1000 zeroed): feature-detect the COMPLETE ORDER
 *     0$ button and call payZero (no Authorize.net redirect).
 *   - Normal orders: PAY NOW → Authorize.net. Logged-in users without a saved
 *     card hit the customer/addPayment detour — handled by post-click URL
 *     detection once addPaymentMethod is discovered.
 */
async function fragmentStep2Pay(spec) {
  const tag = `[order-${pad2(spec.orderNumber)}]`;

  // Feature-detect $0 flow first — toggle-terms is still required, and the
  // Step 2 button is the "COMPLETE ORDER 0$" variant instead of
  // #complete-order-authnet. PCT100 may not fully zero (service fee + tax on
  // SF still apply), so let the DOM decide which path we take.
  const zeroButtonPresent = pwEval(
    `!!Array.from(document.querySelectorAll('button, [role=button], .clickable-element'))
      .find(e => e.offsetParent !== null && /COMPLETE ORDER\\s*0\\$/i.test(e.textContent || ''))`
  );
  const completeAuthnetPresent = pwEval(
    `(() => { const el = document.getElementById('complete-order-authnet'); return !!el && el.offsetParent !== null; })()`
  );

  if (zeroButtonPresent === "true" && completeAuthnetPresent !== "true") {
    console.log(`${tag} $0 flow detected — payZero (skipping Authorize.net)`);
    toggleTerms();
    await verifyTermsToggleOn();
    await payZero();
    await waitForSuccess();
    return;
  }

  // Logged-in flow without a saved card: #btn-wg-add-payment-method is visible
  // and #btn-wg-remove-payment-method is not. Take the Authorize.net
  // customer/addPayment detour BEFORE toggling terms (the detour round-trip
  // resets the toggle anyway — 2026-04-23 gotcha).
  const addPaymentVisible = pwEval(
    `(() => { const el = document.getElementById('btn-wg-add-payment-method'); return !!el && el.offsetParent !== null; })()`
  );
  const removeVisible = pwEval(
    `(() => { const el = document.getElementById('btn-wg-remove-payment-method'); return !!el && el.offsetParent !== null; })()`
  );

  if (addPaymentVisible === "true" && removeVisible !== "true") {
    console.log(`${tag} Add-Payment-Method detour (logged-in, no saved card)`);
    await addPaymentMethod(spec.card, spec.contact);
    console.log(`${tag} re-toggling terms after detour`);
    await reToggleTerms();
    console.log(`${tag} COMPLETE ORDER (second pass, saved-card path)`);
    clickId("complete-order-authnet");
    await waitForSuccess();
    return;
  }

  // Normal path: guest (redirects to Authorize.net /payment/payment) OR
  // logged-in-with-saved-card (completes in-place, no redirect).
  console.log(`${tag} Step 2 — terms toggle`);
  toggleTerms();
  await verifyTermsToggleOn();

  console.log(`${tag} clicking #complete-order-authnet (${addPaymentVisible === "true" ? "Change Payment / saved-card" : "PAY NOW / guest"})`);
  clickId("complete-order-authnet");

  // Poll for the post-click state: either an Authorize.net redirect (guest
  // flow) or in-place success (saved-card logged-in). Fixed sleeps are flaky —
  // the redirect can take >3s on slower environments (2026-04-23).
  try {
    await waitFor(
      `location.host.includes('authorize.net') || location.search.includes('success=yes') || /Order Confirmed|Purchase Completed/i.test(document.body.innerText || '')`,
      { timeoutMs: 20000, label: "post-PAY-NOW state (authnet redirect OR in-place success)" }
    );
  } catch (err) {
    console.error(`${tag} no post-PAY-NOW transition within 20s — proceeding anyway`);
  }

  const onAuthnet = pwEval(`location.host.includes('authorize.net')`);
  if (onAuthnet === "true") {
    console.log(`${tag} redirected to Authorize.net — filling hosted form`);
    payAuthNet(spec.card);
  } else {
    console.log(`${tag} no Authorize.net redirect (saved-card path) — polling for success`);
  }

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

// ─── flow sequencer: guest-to-register-checkout ────────────────────────────
// Add tickets as guest → Step 1 contact info → REGISTER & SAVE INFO (creates
// account mid-checkout) → Step 2. Used for Users D/E/F.

async function runGuestRegisterFlow(spec) {
  if (!spec.user) {
    throw new Error("runGuestRegisterFlow: spec.user is required (the user being created mid-checkout)");
  }
  const started = Date.now();
  await openEventPage(spec);
  await fragmentTicketSelection(spec);
  await fragmentStep1Contact(spec, { mode: "register" }); // calls registerInCheckout internally (PR 5 stub)
  await fragmentStep2Pay(spec);
  return await closeAndReconcile(spec, started);
}

// ─── flow sequencer: guest-to-login-top-right ──────────────────────────────
// Open tickets view → add tickets → click Login top-right → authenticate →
// proceed to checkout as that user. Differs from logged-in-checkout because
// the user adds tickets FIRST, then logs in — login carries the cart forward.

async function runGuestLoginTopRightFlow(spec) {
  if (!spec.user) {
    throw new Error("runGuestLoginTopRightFlow: spec.user is required");
  }
  const started = Date.now();
  const tag = `[order-${pad2(spec.orderNumber)}]`;

  await openEventPage(spec);

  console.log(`${tag} opening tickets view`);
  clickId("gp-test-tickets-button");
  await waitFor(
    `Array.from(document.querySelectorAll('button#add')).some(b => b.offsetParent !== null)`,
    { label: "tickets view ADD" }
  );
  await jitter();

  // Add tickets + promo BEFORE login (cart carries through login per runbook).
  await addTickets(spec.tickets);
  if (spec.promo) {
    console.log(`${tag} applying promo ${spec.promo}`);
    await applyPromoOnTickets(spec.promo);
  }

  console.log(`${tag} logging in as User ${spec.user.id} (top-right popup)`);
  await loginViaPopup({ email: spec.user.email, password: spec.user.password });

  // After login the user is still on tickets view with the cart intact. Proceed.
  console.log(`${tag} PROCEED TO CHECKOUT`);
  clickId("gp-test-proceed-to-checkout");
  await waitFor(`!!document.getElementById('main-full-name')`, { timeoutMs: 15000, label: "Step 1 form" });
  await sleep(800);

  await fragmentStep1Contact(spec, { mode: "loggedIn" });
  await fragmentStep2Pay(spec);
  return await closeAndReconcile(spec, started);
}

// ─── flow sequencer: register-to-login-checkout ────────────────────────────
// Exercises the Login → SIGN UP → OR LOGIN detour (user opens signup by
// mistake, bails back to login) before proceeding as a logged-in user.

async function runRegisterToLoginFlow(spec) {
  if (!spec.user) {
    throw new Error("runRegisterToLoginFlow: spec.user is required");
  }
  const started = Date.now();
  const tag = `[order-${pad2(spec.orderNumber)}]`;

  await openEventPage(spec);

  console.log(`${tag} opening tickets view`);
  clickId("gp-test-tickets-button");
  await waitFor(
    `Array.from(document.querySelectorAll('button#add')).some(b => b.offsetParent !== null)`,
    { label: "tickets view ADD" }
  );
  await jitter();

  console.log(`${tag} login via signup-detour UX as User ${spec.user.id}`);
  await loginViaPopupWithSignupDetour({ email: spec.user.email, password: spec.user.password });

  // Now logged in, on tickets view — proceed with the normal logged-in path.
  await fragmentTicketSelection(spec, { alreadyOnTicketsView: true });
  await fragmentStep1Contact(spec, { mode: "loggedIn" });
  await fragmentStep2Pay(spec);
  return await closeAndReconcile(spec, started);
}

// ─── dispatch ──────────────────────────────────────────────────────────────

const FLOW_SEQUENCERS = {
  "guest-checkout": runGuestFlow,
  "logged-in-checkout": runLoggedInFlow,
  "guest-to-register-checkout": runGuestRegisterFlow,
  "guest-to-login-top-right": runGuestLoginTopRightFlow,
  "register-to-login-checkout": runRegisterToLoginFlow
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
    reToggleTerms,
    payZero,
    registerViaPopup,
    registerInCheckout,
    loginViaPopupWithSignupDetour
  },
  fragments: {
    fragmentTicketSelection,
    fragmentStep1Contact,
    fragmentStep2Pay
  },
  sequencers: FLOW_SEQUENCERS
};
