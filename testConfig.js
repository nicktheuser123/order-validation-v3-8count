/**
 * Test configuration - dynamically generated based on test suites.
 * Structure defined in TESTING_GUIDE.md. Add keys when adding new test suites.
 */

/** Base URL for Playwright recording - where codegen opens the browser */
const BASE_URL = "https://8countlogin.com/version-81rkv/event/test-event-v81rkv-2026"; // e.g. "https://yourapp.bubbleapps.io"

/** Set to false to skip this test suite */
const RUN_ORDER_TESTS = true;

/** Set to false to skip reporting daily tests */
const RUN_REPORTING_DAILY_TESTS = true;

/** Set to false to skip refund tests */
const RUN_REFUND_TESTS = false;

/** Set to false to skip E2E GP portal tests */
const RUN_E2E_TESTS = true;

/** Primary entity ID - used to fetch the record(s) this suite validates. Set after placing an order (copy from Bubble DB). */
const ORDER_ID = "1775018761897x109834756373872640";

/** GYM_Transaction ID for refund validation */
const REFUND_TRANSACTION_ID = "1774065658466x817743924321321000";

/** GP_Order ID linked to the refund transaction */
const REFUND_ORDER_ID = "1774065658466x817743924321321000";

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
  GP_CUSTOMFEES: "gp_customfeetype",
  GP_EVENTDETAIL: "gp_eventdetail",
  GP_TICKETTYPE: "gp_tickettype",
  GP_REPORTINGDAILY: "gp_reportingdaily",
  GP_REPORTINGTICKETTYPEDAILY: "gp_reportingtickettypedaily",
  GP_REPORTINGCUSTOMFEEDAILY: "gp_reportingcustomfeedaily",
  EVENT: "event",
  GYM_TRANSACTION: "gym_transaction",
  GP_REFUNDITEMS: "gp_refunditems",
  PAYINTENT: "payintent"
};


module.exports = {
  BASE_URL,
  RUN_ORDER_TESTS,
  RUN_REPORTING_DAILY_TESTS,
  RUN_REFUND_TESTS,
  RUN_E2E_TESTS,
  ORDER_ID,
  ORDER_IDS,
  REFUND_TRANSACTION_ID,
  REFUND_ORDER_ID,
  TYPES
};
