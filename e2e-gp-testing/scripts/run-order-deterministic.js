#!/usr/bin/env node
/**
 * Backward-compat shim — delegates to the spec-driven `run-order.js` with
 * `--order 3`. Preserves `npm run e2e:run-order` behaviour (Order #3) while
 * the canonical entry point is the spec-driven runner.
 *
 * For any other order, invoke run-order.js directly:
 *   node e2e-gp-testing/scripts/run-order.js --order <N>
 */

const { runOrder, loadSpec } = require("./run-order");

const spec = loadSpec({ order: 3 });
runOrder(spec).catch((err) => {
  console.error(`[order-03] FAIL:`, err.message);
  console.error("  (browser left open for inspection; run `playwright-cli close-all` to clean up)");
  process.exit(1);
});
