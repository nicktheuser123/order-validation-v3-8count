/**
 * Pure calculation module for GP_Order validation.
 * Replicates backend logic from Buildprint workflows. No Bubble API calls.
 */

const { getNum, roundTo2 } = require("./testUtils");

/** Option value for donation add-on type */
const ADDON_TYPE_DONATION = "donation";

/**
 * Calculate expected order values from fetched data.
 * Mirrors backend workflow logic for gross_amount, total_order_value, total_due_now, etc.
 *
 * @param {object} params
 * @param {object} params.order - GP_Order record from API
 * @param {Array} params.addOns - GP_AddOn records linked to order
 * @param {Array} params.tickets - GP_Tickets records linked to order
 * @param {Array} params.orderFees - GP_OrderFee records linked to order
 * @param {object} [params.eventDetail] - GP_EventDetail for event (optional, for processing fee config)
 */
function calculateOrder({ order, addOns = [], tickets = [], orderFees = [], eventDetail = {} }) {
  // Gross: sum of add-on (price × quantity) + sum of ticket final prices
  let addOnGross = 0;
  const addOnSubtotals = [];
  for (const addon of addOns) {
    const price = getNum(addon, "price_number", "fee_amount_number", "fee___number");
    const qty = getNum(addon, "quantity_number") || 1;
    const subtotal = roundTo2(price * qty);
    addOnSubtotals.push({ price, qty, subtotal });
    addOnGross += subtotal;
  }

  let ticketGross = 0;
  const ticketSubtotals = [];
  for (const ticket of tickets) {
    const price = getNum(ticket, "price_number", "gross_price_number");
    ticketSubtotals.push({ price });
    ticketGross += price;
  }

  const grossAmount = roundTo2(addOnGross + ticketGross);

  // Donation amount: sum of add-ons where type = donation
  let donationAmount = 0;
  for (const addon of addOns) {
    const type = addon.os_addontype_option_os_addontype || addon.type_option_os_addontype || addon.os_addontype_option_os_gp_addontype;
    const typeVal = typeof type === "string" ? type : (type && type.option_value) || "";
    if (String(typeVal).toLowerCase() === ADDON_TYPE_DONATION) {
      const price = getNum(addon, "price_number", "fee_amount_number");
      const qty = getNum(addon, "quantity_number") || 1;
      donationAmount += roundTo2(price * qty);
    }
  }
  donationAmount = roundTo2(donationAmount);

  // Fees from order record (backend writes these)
  const feeRegistration = getNum(order, "fee_registration_number");
  const feeService = getNum(order, "fee_service_number");
  const platformFee = getNum(order, "platform_fee_number");
  const salesTax = getNum(order, "sales_tax_number");
  const discountValue = getNum(order, "discount_value_number");
  const creditApplied = getNum(order, "creditapplied_number");
  const deposit = getNum(order, "deposit_number");

  // Sum order fees (GP_OrderFee) for custom fees
  let orderFeesTotal = 0;
  for (const ofee of orderFees) {
    orderFeesTotal += getNum(ofee, "fee_amount_number", "fee___number");
  }
  orderFeesTotal = roundTo2(orderFeesTotal);

  // Total order value: gross + fees - discount (VOT = [Price + Deposit + Reg Fee] - Disc)
  const totalOrderValue = roundTo2(
    grossAmount + feeRegistration + feeService + platformFee + orderFeesTotal + salesTax - discountValue
  );

  // Total due now: total - credit - deposit
  const totalDueNow = roundTo2(Math.max(0, totalOrderValue - creditApplied - deposit));

  // Processing fee: from order (backend calculates; 0 when disabled)
  const processingFee = getNum(order, "processing_fee_number");
  const processingFeeDeduction = getNum(order, "_processing_fee_deduction_number");
  const processingFeeRevenue = getNum(order, "_processing_fee_revenue_number");

  return {
    grossAmount,
    addOnGross,
    ticketGross,
    addOnSubtotals,
    ticketSubtotals,
    donationAmount,
    discountValue,
    feeRegistration,
    feeService,
    platformFee,
    orderFeesTotal,
    salesTax,
    creditApplied,
    deposit,
    totalOrderValue,
    totalDueNow,
    processingFee,
    processingFeeDeduction,
    processingFeeRevenue
  };
}

module.exports = { calculateOrder };
