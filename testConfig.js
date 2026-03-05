/**
 * Test configuration - dynamically generated based on test suites.
 * Structure defined in TESTING_GUIDE.md. Add keys when adding new test suites.
 */

/** Base URL for Playwright recording - where codegen opens the browser */
const BASE_URL = "https://8countlogin.com/version-81rkv/event/report-vals-2026"; // e.g. "https://yourapp.bubbleapps.io"

/** Set to false to skip this test suite */
const RUN_ORDER_TESTS = true;

/** Primary entity ID - used to fetch the record(s) this suite validates. Set after placing an order (copy from Bubble DB). */
const ORDER_ID = "";

/** Optional: validate multiple entities. Use empty array if not needed. */
const ORDER_IDS = [];

/** Bubble data type names. Add a key for every type this suite fetches. */
const TYPES = {
  GP_ORDER: "gp_order",
  GP_ADDON: "gp_addon",
  GP_TICKETS: "gp_tickets",
  GP_ORDERFEE: "gp_orderfee",
  GP_PROMOTION: "gp_promotion",
  GP_PROMOTIONUSAGE: "gp_promotionusage",
  GP_CUSTOMFEES: "gp_customfees",
  GP_EVENTDETAIL: "gp_eventdetail",
  EVENT: "event"
};

module.exports = {
  BASE_URL,
  RUN_ORDER_TESTS,
  ORDER_ID,
  ORDER_IDS,
  TYPES
};
