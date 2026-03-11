/**
 * Pure calculation module for refund aggregation.
 * Processes GP_RefundItems and returns expected reporting values.
 * No Bubble API calls.
 */

const { getNum, roundTo2 } = require("./testUtils");

/**
 * Aggregate refund items by type and recoverability.
 *
 * @param {object} params
 * @param {Array} params.refundItems - GP_RefundItems records
 * @returns {object} Aggregated refund values for reporting comparison
 */
function calculateRefundAggregates({ refundItems = [] }) {
  let totalRefunds = 0;
  let totalTicketsRefunded = 0;
  let donationsRefunded = 0;
  let serviceFeeRefundAdj = 0;
  let processingFeeRevRefundAdj = 0;
  let totalFeesRefundAdj = 0;
  let customFeeRefundAdj = 0;

  for (const item of refundItems) {
    const amount = getNum(item, "Amount");
    const type = item["OS RefundItemType"];
    const recoverable = !!item["recoverable?"];

    // Total Refunds: sum of ALL items regardless of type
    totalRefunds += amount;

    switch (type) {
      case "ticket":
        // Total Tickets Refunded: COUNT (not sum) of ticket items
        totalTicketsRefunded += 1;
        break;

      case "donation":
        donationsRefunded += amount;
        break;

      case "service_fee":
        serviceFeeRefundAdj += amount;
        if (recoverable) {
          totalFeesRefundAdj += amount;
        }
        break;

      case "fee":
        // Processing fee refund items
        if (recoverable) {
          processingFeeRevRefundAdj += amount;
        }
        break;

      case "custom_fee":
        customFeeRefundAdj += amount;
        if (recoverable) {
          totalFeesRefundAdj += amount;
        }
        break;
    }
  }

  return {
    totalRefunds: roundTo2(totalRefunds),
    totalTicketsRefunded,
    donationsRefunded: roundTo2(donationsRefunded),
    serviceFeeRefundAdj: roundTo2(serviceFeeRefundAdj),
    processingFeeRevRefundAdj: roundTo2(processingFeeRevRefundAdj),
    totalFeesRefundAdj: roundTo2(totalFeesRefundAdj),
    customFeeRefundAdj: roundTo2(customFeeRefundAdj)
  };
}

module.exports = { calculateRefundAggregates };
