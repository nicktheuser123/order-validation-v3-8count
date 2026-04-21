/**
 * Test configuration for the Jest validation suites.
 * Flip RUN_* flags to control which suites execute on `npm test`.
 */

/** Set to false to skip single-order validation (tests/order.test.js) */
const RUN_ORDER_TESTS = true;

/** Set to false to skip reporting daily aggregates (tests/reportingDaily.test.js) */
const RUN_REPORTING_DAILY_TESTS = true;

/** Set to false to skip refund validation (tests/refund.test.js) */
const RUN_REFUND_TESTS = false;

/** Primary GP_Order ID validated by tests/order.test.js. */
const ORDER_ID = "1776427559524x812385691512864800";

/** GYM_Transaction ID for refund validation */
const REFUND_TRANSACTION_ID = "1774065658466x817743924321321000";

/** GP_Order ID linked to the refund transaction */
const REFUND_ORDER_ID = "1774065658466x817743924321321000";

/** Optional: validate multiple orders. Empty array = use ORDER_ID only. */
const ORDER_IDS = [];

/** Bubble Data API type names. Editor display name, lowercased, spaces removed. */
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
  RUN_ORDER_TESTS,
  RUN_REPORTING_DAILY_TESTS,
  RUN_REFUND_TESTS,
  ORDER_ID,
  ORDER_IDS,
  REFUND_TRANSACTION_ID,
  REFUND_ORDER_ID,
  TYPES
};
