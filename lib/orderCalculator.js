/**
 * Pure calculation module for GP_Order validation.
 * Replicates backend logic from Buildprint workflows. No Bubble API calls.
 */

const { roundTo2 } = require("./testUtils");

/** Payment provider processing fee rates */
const PAYMENT_PROVIDERS = {
  stripe: { pct: 0.029, fixed: 0.30 },
  authorize_net: { pct: 0, fixed: 0.05 }
};

/**
 * Calculate expected order values from fetched data.
 *
 * @param {object} params
 * @param {object} params.order - GP_Order record from API
 * @param {Array}  params.addOns - GP_AddOn records (from order.add_on_list_custom_gp_addon)
 * @param {object} params.ticketTypes - { [ticketTypeId]: GP_TicketType record } map
 * @param {object} params.customFeeTypes - { [id]: GP_CustomFeeType record } map
 * @param {object|null} params.promotion - GP_Promotion record or null
 * @param {object} params.eventDetail - GP_EventDetail record
 * @param {Array}  params.orderFees - GP_OrderFee records (flattened from all addOns)
 */
function calculateOrder({
  order,
  addOns = [],
  ticketTypes = {},
  customFeeTypes = {},
  promotion = null,
  eventDetail = {},
  orderFees = []
}) {
  // --- Step 0: total eligible gross for discount proration (ticket price only, no service fee) ---
  let totalEligibleGross = 0;
  if (promotion && promotion["OS GP Promotion Type"] === "Discount Amount") {
    const eligibleTypes = promotion["ApplicableAddOns"] || [];
    if (eligibleTypes.includes("Ticket")) {
      for (const addon of addOns) {
        if (addon["OS AddOnType"] !== "Ticket") continue;
        const ticketType = ticketTypes[addon["GP_TicketType"]];
        const ticketPrice = ticketType ? Number(ticketType["Price"]) || 0 : 0;
        const qty = Number(addon["Quantity"]) || 1;
        totalEligibleGross += ticketPrice * qty;
      }
    }
  }

  // --- Step 1: per-addOn loop ---
  // grossAmount = sum of ticket prices only (no service fee)
  // discountTotal = full promo discount (not capped at gross)
  // totalServiceFee = service fee charged to customer (0 if addon fully covered by discount)
  // finalAmount = what customer pays for tickets (gross - discount, floored at 0)
  // totalGrossTicketBase = sum of ticket prices (for custom fee percentage base)
  let ticketCount = 0;
  let grossAmount = 0;
  let totalServiceFee = 0;
  let discountTotal = 0;
  let donationTotal = 0;
  let finalAmount = 0;
  let totalGrossTicketBase = 0;
  let hasTicketAddons = false;

  for (const addon of addOns) {
    const type = addon["OS AddOnType"];

    if (type !== "Ticket" && type !== "Donation") continue;

    if (type === "Donation") {
      const donAmt = Number(addon["Final Price"]) || Number(addon["Gross Price"]) || 0;
      donationTotal += donAmt;
      continue;
    }

    // ticket addon
    const qty = Number(addon["Quantity"]) || 1;
    const ticketType = ticketTypes[addon["GP_TicketType"]];
    const ticketPrice = ticketType ? Number(ticketType["Price"]) || 0 : 0;
    const grossTicketTotal = ticketPrice * qty;

    // service fee: from ticket type, then event detail, then default $2
    const tsSF = ticketType ? ticketType["Service Fee"] : undefined;
    const edSF = eventDetail ? eventDetail["Service Fee"] : undefined;
    const sfRate = ticketPrice === 0 ? 0 : (
      tsSF != null ? Number(tsSF) : (edSF != null ? Number(edSF) : 2)
    );
    const serviceFee = roundTo2(sfRate * qty);
    const addonGross = grossTicketTotal + serviceFee;

    ticketCount += qty;
    grossAmount += grossTicketTotal;
    totalGrossTicketBase += grossTicketTotal;
    hasTicketAddons = true;

    // discount: cap at ticket gross for `discountTotal` (matches Bubble's stored Discount Amount).
    // Keep the uncapped value for the addonNet absorb check so service fees still zero out
    // correctly when a FLAT discount exceeds the ticket price.
    let discount = 0;
    if (promotion) {
      const eligibleTypes = promotion["ApplicableAddOns"] || [];
      const promoType = promotion["OS GP Promotion Type"];
      if (eligibleTypes.includes("Ticket")) {
        if (promoType === "Discount Amount") {
          const discountAmt = Number(promotion["DiscountAmt"]) || 0;
          if (totalEligibleGross > 0) {
            discount = roundTo2((grossTicketTotal / totalEligibleGross) * discountAmt);
          }
        } else if (promoType === "Discount Percentage") {
          const discountPct = Number(promotion["DiscountPct"]) || 0;
          discount = roundTo2(grossTicketTotal * discountPct);
        }
      }
    }

    discountTotal += Math.min(discount, grossTicketTotal);

    // addon net: if discount covers full addon gross, service fee is also not charged
    const addonNet = addonGross - discount;
    if (addonNet <= 0) {
      finalAmount += 0;
      // service fee absorbed by discount — not charged
    } else {
      totalServiceFee += serviceFee;
      finalAmount += roundTo2(addonNet);
    }
  }

  donationTotal = roundTo2(donationTotal);
  discountTotal = roundTo2(discountTotal);
  totalServiceFee = roundTo2(totalServiceFee);
  grossAmount = roundTo2(grossAmount);
  finalAmount = roundTo2(finalAmount);

  // --- Step 2: custom fees ---
  // Percentage fees: applied to net payable amount (finalAmount already = gross + SF - discount, floored at 0 per addon)
  // Fixed fees: flat amount if any ticket addons exist
  let totalCustomFees = 0;

  for (const customFeeType of Object.values(customFeeTypes)) {
    const feeType = customFeeType["Type"];
    const feeAmt = Number(customFeeType["Fee Amount"]) || 0;

    if (feeType === "Fixed") {
      if (hasTicketAddons) {
        totalCustomFees += feeAmt;
      }
    } else if (feeType === "Percentage") {
      totalCustomFees += roundTo2(finalAmount * feeAmt);
    }
  }
  totalCustomFees = roundTo2(totalCustomFees);

  // --- Step 3: processing fees ---
  const providerKey = ((order["OS Payment Provider"] || "").toLowerCase().replace(/[.\s]/g, "_"));
  const provider = PAYMENT_PROVIDERS[providerKey] || PAYMENT_PROVIDERS.stripe;
  const pfdPct = provider.pct;
  const pfdFixed = provider.fixed;

  const noProcessingFee = !!(eventDetail && eventDetail["No Processing Fee"]);
  const pfrPct = Number((eventDetail && eventDetail["Processing Fee %"]) || 0);
  const pfrFixed = Number((eventDetail && eventDetail["Processing Fee $"]) || 0);

  let totalOrderValue, processingFeeRevenue, stripeDeduction;

  const totalPayable = finalAmount + donationTotal + totalCustomFees;

  if (totalPayable < 0.01) {
    // truly zero-value order
    totalOrderValue = 0;
    processingFeeRevenue = 0;
    stripeDeduction = 0;
  } else if (noProcessingFee) {
    totalOrderValue = roundTo2(finalAmount + donationTotal + totalCustomFees);
    stripeDeduction = roundTo2(roundTo2(totalOrderValue * pfdPct) + pfdFixed);
    processingFeeRevenue = 0;
  } else {
    const combinedPct = pfdPct + pfrPct;
    const combinedFixed = pfdFixed + pfrFixed;
    const donationFee = roundTo2((donationTotal / (1 - pfdPct)) * pfdPct);
    const base = (finalAmount + combinedFixed + totalCustomFees) / (1 - combinedPct);
    const totalProcessingFee = roundTo2(base * combinedPct + combinedFixed + donationFee);
    totalOrderValue = roundTo2(finalAmount + totalProcessingFee + donationTotal + totalCustomFees);
    stripeDeduction = roundTo2(roundTo2(totalOrderValue * pfdPct) + pfdFixed);
    processingFeeRevenue = roundTo2(totalProcessingFee - stripeDeduction);
  }

  return {
    ticketCount,
    grossAmount,
    totalServiceFee,
    donationTotal,
    totalCustomFees,
    discountTotal,
    processingFeeRevenue,
    stripeDeduction,
    totalOrderValue
  };
}

module.exports = { calculateOrder };
