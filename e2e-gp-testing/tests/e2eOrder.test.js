/**
 * E2E Order Validation Suite
 *
 * Reads order IDs from e2e-state.json (populated by browser automation agents)
 * and validates every order against orderCalculator + reportingDaily aggregates.
 *
 * Run: npm test -- e2e-gp-testing/tests/e2eOrder.test.js
 */

const fs = require("fs");
const path = require("path");
const { getThing, searchThings } = require("../../config/bubbleClient");
const { calculateOrder } = require("../../lib/orderCalculator");
const { calculateRefundAggregates } = require("../../lib/refundCalculator");
const { getNum, roundTo2 } = require("../../lib/testUtils");
const testResultsLogger = require("../../config/testResultsLogger");
const { TYPES } = require("../../testConfig");

const STATE_PATH = path.join(__dirname, "..", "e2e-state.json");
const SETTINGS_PATH = path.join(__dirname, "..", "settings.json");

function loadState() {
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

function loadSettings() {
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Per-Order Validation ──────────────────────────────────────────────────────

describe("E2E Order Validation", () => {
  let state;
  let settings;
  let orderData = []; // { order, addOns, promotion, event, eventDetail, ticketTypes, customFeeTypes, orderFees, result }

  beforeAll(async () => {
    state = loadState();
    settings = loadSettings();

    if (!state.orders || state.orders.length === 0) {
      throw new Error("No orders in e2e-state.json — run purchase agents first");
    }

    const waitMs = settings.verification?.waitAfterOrderMs || 30000;

    for (const orderEntry of state.orders) {
      const orderId = typeof orderEntry === "string" ? orderEntry : orderEntry.orderId;
      if (!orderId) continue;

      let order = await getThing(TYPES.GP_ORDER, orderId);

      // If order looks incomplete, wait and retry once
      if (!order["Total Order Value"] && order["Total Order Value"] !== 0) {
        await sleep(waitMs);
        order = await getThing(TYPES.GP_ORDER, orderId);
      }

      const addOns = (
        await Promise.all(
          (order["Add Ons"] || []).map((id) => getThing(TYPES.GP_ADDON, id).catch(() => null))
        )
      ).filter(Boolean);

      const promotion = order["GP_Promotion"]
        ? await getThing(TYPES.GP_PROMOTION, order["GP_Promotion"])
        : null;

      const event = await getThing(TYPES.EVENT, order["Event"]);
      const eventDetail = await getThing(TYPES.GP_EVENTDETAIL, event["GP_EventDetail"]);

      const ticketTypeIds = [
        ...new Set(
          addOns
            .filter((a) => a["OS AddOnType"] === "Ticket")
            .map((a) => a["GP_TicketType"])
            .filter(Boolean)
        )
      ];
      const ticketTypeEntries = await Promise.all(
        ticketTypeIds.map((id) => getThing(TYPES.GP_TICKETTYPE, id).then((r) => [id, r]))
      );
      const ticketTypes = Object.fromEntries(ticketTypeEntries);

      const customFeeTypeIds = order["GP_CustomFees"] || [];
      const customFeeEntries = await Promise.all(
        customFeeTypeIds.map((id) => getThing(TYPES.GP_CUSTOMFEES, id).then((r) => [id, r]))
      );
      const customFeeTypes = Object.fromEntries(customFeeEntries);

      const orderFees = (
        await Promise.all(
          addOns.flatMap((a) =>
            (a["GP_OrderFee"] || []).map((id) =>
              getThing(TYPES.GP_ORDERFEE, id).catch(() => null)
            )
          )
        )
      ).filter(Boolean);

      const result = calculateOrder({
        order,
        addOns,
        promotion,
        ticketTypes,
        eventDetail,
        customFeeTypes,
        orderFees
      });

      orderData.push({
        orderId,
        order,
        addOns,
        promotion,
        event,
        eventDetail,
        ticketTypes,
        customFeeTypes,
        orderFees,
        result
      });
    }

    if (orderData.length === 0) {
      throw new Error("No valid orders could be fetched");
    }
  }, 600000); // 10 min — fetching 20 orders with all related records

  it("validates per-addon gross price for all orders", () => {
    for (const { orderId, addOns, ticketTypes } of orderData) {
      const ticketAddOns = addOns.filter((a) => a["OS AddOnType"] === "Ticket");
      ticketAddOns.forEach((addon) => {
        const ticketType = ticketTypes[addon["GP_TicketType"]];
        const ticketPrice = ticketType ? Number(ticketType["Price"]) || 0 : 0;
        const qty = Number(addon["Quantity"]) || 1;
        const expectedGross = roundTo2(ticketPrice * qty);
        const storedGross = Number(addon["Gross Price"]) || 0;
        testResultsLogger.step("Per-addon gross price", { orderId, addonId: addon._id, ticketPrice, qty, expected: expectedGross, stored: storedGross });
        expect(storedGross).toBeCloseTo(expectedGross, 2);
      });
    }
  });

  it("validates order gross amount for all orders", () => {
    for (const { orderId, order, addOns } of orderData) {
      const ticketAddOns = addOns.filter((a) => a["OS AddOnType"] === "Ticket");
      const sumAddonGross = roundTo2(ticketAddOns.reduce((sum, a) => sum + (Number(a["Gross Price"]) || 0), 0));
      const storedOrderGross = Number(order["Gross Amount"]) || 0;
      testResultsLogger.step("Order gross amount", { orderId, addonCount: ticketAddOns.length, sumAddonGross, storedOrderGross });
      expect(storedOrderGross).toBeCloseTo(sumAddonGross, 2);
    }
  });

  it("validates ticket count for all orders", () => {
    for (const { orderId, order, result } of orderData) {
      testResultsLogger.step("Ticket count", { orderId, calculated: result.ticketCount, stored: order["Ticket Count"] });
      expect(order["Ticket Count"]).toBe(result.ticketCount);
    }
  });

  it("validates total service fee for all orders", () => {
    for (const { orderId, order, result } of orderData) {
      testResultsLogger.step("Total service fee", { orderId, calculated: result.totalServiceFee, stored: order["Fee Service"] });
      expect(order["Fee Service"]).toBeCloseTo(result.totalServiceFee, 2);
    }
  });

  it("validates discount amount for all orders", () => {
    const failures = [];
    for (const { orderId, order, result, promotion } of orderData) {
      const stored = Number(order["Discount Amount"]) || 0;
      testResultsLogger.step("Discount amount", { orderId, promotion: promotion ? promotion._id : null, calculated: result.discountTotal, stored });
      if (Math.abs(stored - result.discountTotal) > 0.005) {
        failures.push(`  ${orderId}: stored=${stored}, calc=${result.discountTotal}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length}/${orderData.length} orders failed discount amount:\n${failures.join("\n")}`);
    }
  });

  it("validates donation amount for all orders", () => {
    for (const { orderId, order, result } of orderData) {
      testResultsLogger.step("Donation total", { orderId, calculated: result.donationTotal, stored: order["Donation Amount"] || 0 });
      expect(order["Donation Amount"] || 0).toBeCloseTo(result.donationTotal, 2);
    }
  });

  it("validates total order value for all orders", () => {
    const failures = [];
    for (const { orderId, order, result } of orderData) {
      const stored = Number(order["Total Order Value"]) || 0;
      testResultsLogger.step("Total order value", { orderId, calculated: result.totalOrderValue, stored });
      if (Math.abs(stored - result.totalOrderValue) > 0.005) {
        failures.push(`  ${orderId}: stored=${stored}, calc=${result.totalOrderValue}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length}/${orderData.length} orders failed total order value:\n${failures.join("\n")}`);
    }
  });

  it("validates processing fee revenue for all orders", () => {
    for (const { orderId, order, result } of orderData) {
      // Bubble omits this field entirely on $0 orders — treat missing as 0
      const stored = Number(order["Processing Fee Revenue"]) || 0;
      testResultsLogger.step("Processing fee revenue", { orderId, calculated: result.processingFeeRevenue, stored });
      expect(stored).toBeCloseTo(result.processingFeeRevenue, 2);
    }
  });

  it("validates processing fee deduction for all orders", () => {
    for (const { orderId, order, result } of orderData) {
      const stored = Number(order["Processing Fee Deduction"]) || 0;
      testResultsLogger.step("Processing fee deduction (stripe)", { orderId, calculated: result.stripeDeduction, stored });
      expect(stored).toBeCloseTo(result.stripeDeduction, 2);
    }
  });

  it("validates custom fees for all orders", () => {
    const failures = [];
    for (const { orderId, orderFees, result } of orderData) {
      const storedCustomFees = roundTo2(orderFees.reduce((sum, f) => sum + roundTo2(Number(f["GP_OrderFee Amt"]) || 0), 0));
      testResultsLogger.step("Custom fees", { orderId, orderFeeCount: orderFees.length, storedSum: storedCustomFees, calculated: result.totalCustomFees });
      if (Math.abs(storedCustomFees - result.totalCustomFees) > 0.005) {
        failures.push(`  ${orderId}: stored=${storedCustomFees}, calc=${result.totalCustomFees}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length}/${orderData.length} orders failed custom fees:\n${failures.join("\n")}`);
    }
  });

  it("validates order status is set for all orders", () => {
    for (const { orderId, order } of orderData) {
      const statusVal = order["Order Status"];
      testResultsLogger.step("Order status", { orderId, status: statusVal });
      expect(statusVal != null && statusVal !== "").toBe(true);
    }
  });

  it("validates payment method is set for all orders", () => {
    for (const { orderId, order } of orderData) {
      const methodVal = order["Payment Method"];
      testResultsLogger.step("Payment method", { orderId, paymentMethod: methodVal });
      expect(methodVal != null && methodVal !== "").toBe(true);
    }
  });

  it("validates user or guest checkout for all orders", () => {
    for (const { orderId, order } of orderData) {
      const hasUser = !!order["User"];
      const isGuest = !!order["Guest Checkout"];
      testResultsLogger.step("User or guest checkout", { orderId, hasUser, isGuest });
      expect(hasUser || isGuest).toBe(true);
    }
  });

  it("validates order ID text is set for all orders", () => {
    for (const { orderId, order } of orderData) {
      const orderIdText = order["Order ID Text"];
      testResultsLogger.step("Order ID text", { orderId, orderIdDisplay: orderIdText });
      expect(orderIdText != null && orderIdText !== "").toBe(true);
    }
  });

  it("validates event is linked for all orders", () => {
    for (const { orderId, order } of orderData) {
      const eventId = order["Event"];
      testResultsLogger.step("Event link", { orderId, eventId: eventId || "(none)" });
      expect(eventId != null && eventId !== "").toBe(true);
    }
  });
});

// ─── Reporting Daily Validation ────────────────────────────────────────────────

describe("E2E Reporting Daily Validation", () => {
  let state;
  let orders = [];
  let reportingDailies = [];
  let ticketTypeDailies = [];
  let customFeeDailies = [];
  let allTicketAddOns = [];
  let allOrderFees = [];
  let calc = {};
  let reported = {};
  let ticketCalc = {};
  let ticketReported = {};
  let customFeeCalc = {};
  let customFeeReported = {};

  beforeAll(async () => {
    state = loadState();

    if (!state.orders || state.orders.length === 0) {
      throw new Error("No orders in e2e-state.json — run purchase agents first");
    }

    // Use first order as seed to get date label + event
    const firstOrderId = typeof state.orders[0] === "string" ? state.orders[0] : state.orders[0].orderId;
    const seedOrder = await getThing(TYPES.GP_ORDER, firstOrderId);
    const dateLabel = seedOrder["Date Label"];
    const eventId = seedOrder["Event"];

    if (!dateLabel || !eventId) {
      throw new Error(`Seed order ${firstOrderId} missing Date Label or Event`);
    }

    const dateEventConstraints = [
      { key: "Date Label", constraint_type: "equals", value: dateLabel },
      { key: "Event", constraint_type: "equals", value: eventId }
    ];

    const [rdResults, ttdResults, cfdResults, orderResults] = await Promise.all([
      searchThings(TYPES.GP_REPORTINGDAILY, dateEventConstraints).catch(() => []),
      searchThings(TYPES.GP_REPORTINGTICKETTYPEDAILY, dateEventConstraints).catch(() => []),
      searchThings(TYPES.GP_REPORTINGCUSTOMFEEDAILY, dateEventConstraints).catch(() => []),
      searchThings(TYPES.GP_ORDER, [
        ...dateEventConstraints,
        { key: "Order Status", constraint_type: "equals", value: "Paid" }
      ])
    ]);

    reportingDailies = rdResults;
    ticketTypeDailies = ttdResults;
    customFeeDailies = cfdResults;
    orders = orderResults;

    if (reportingDailies.length === 0) {
      throw new Error(`No GP_ReportingDaily records for date="${dateLabel}", event=${eventId}`);
    }

    // Fetch addons and order fees for all orders
    for (const ord of orders) {
      const addonIds = ord["Add Ons"] || [];
      const addons = (
        await Promise.all(addonIds.map((id) => getThing(TYPES.GP_ADDON, id).catch(() => null)))
      ).filter(Boolean);

      for (const addon of addons) {
        if (addon["OS AddOnType"] === "Ticket") {
          allTicketAddOns.push(addon);
        }
        const feeIds = addon["GP_OrderFee"] || [];
        const fees = (
          await Promise.all(feeIds.map((id) => getThing(TYPES.GP_ORDERFEE, id).catch(() => null)))
        ).filter(Boolean);
        allOrderFees.push(...fees);
      }
    }

    // Aggregate order-level sums
    let totalCustomFees = 0;
    for (const fee of allOrderFees) {
      totalCustomFees += getNum(fee, "GP_OrderFee Amt");
    }

    calc.grossSales = 0;
    calc.totalSales = 0;
    calc.totalTicketsSold = 0;
    calc.totalTicketSales = 0;
    calc.grossServiceFees = 0;
    calc.grossProcessingFeesRevenue = 0;
    calc.totalProcessingFeesDeductions = 0;
    calc.donationsGross = 0;
    calc.totalDiscounts = 0;
    calc.totalOrdersCount = orders.length;

    for (const ord of orders) {
      calc.grossSales += getNum(ord, "Total Order Value");
      calc.totalSales += getNum(ord, "Total Order Value") + getNum(ord, "Discount Amount");
      calc.totalTicketsSold += getNum(ord, "Ticket Count");
      calc.grossServiceFees += getNum(ord, "Fee Service");
      calc.grossProcessingFeesRevenue += getNum(ord, "Processing Fee Revenue");
      calc.totalProcessingFeesDeductions += getNum(ord, "Processing Fee Deduction");
      calc.donationsGross += getNum(ord, "Donation Amount");
      calc.totalDiscounts += getNum(ord, "Discount Amount");
    }

    for (const addon of allTicketAddOns) {
      calc.totalTicketSales += getNum(addon, "Gross Price");
    }

    // Ticket type daily reported values
    ticketReported = {
      finalSales: 0, grossSales: 0, serviceFees: 0, discounts: 0, ticketsSoldCount: 0,
      netSales: 0, totalRefunds: 0, ticketsRefundedCount: 0, serviceFeeRefunds: 0,
      ticketsLive: 0, ticketsVoided: 0, ticketsVoidedAmount: 0
    };
    for (const ttd of ticketTypeDailies) {
      ticketReported.finalSales += getNum(ttd, "Final Sales");
      ticketReported.grossSales += getNum(ttd, "Gross Sales");
      ticketReported.serviceFees += getNum(ttd, "Service Fees");
      ticketReported.discounts += getNum(ttd, "Discounts");
      ticketReported.ticketsSoldCount += getNum(ttd, "Tickets Sold Count");
      ticketReported.netSales += getNum(ttd, "?Net Sales");
      ticketReported.totalRefunds += getNum(ttd, "Total Refunds");
      ticketReported.ticketsRefundedCount += getNum(ttd, "Tickets Refunded Count");
      ticketReported.serviceFeeRefunds += getNum(ttd, "Service Fee Refunds");
      ticketReported.ticketsLive += getNum(ttd, "Tickets Live");
      ticketReported.ticketsVoided += getNum(ttd, "Tickets Voided");
      ticketReported.ticketsVoidedAmount += getNum(ttd, "Total Tickets Voided Amount");
    }

    // No refunds in fresh E2E — all zero
    const refundAgg = calculateRefundAggregates({ refundItems: [] });

    calc.totalRefunds = ticketReported.totalRefunds;
    calc.totalTicketsRefunded = ticketReported.ticketsRefundedCount;
    calc.donationsRefunded = refundAgg.donationsRefunded;
    calc.serviceFeeRefundAdj = refundAgg.serviceFeeRefundAdj;
    calc.totalFeesRefundAdj = refundAgg.totalFeesRefundAdj;
    calc.processingFeeRevRefundAdj = refundAgg.processingFeeRevRefundAdj;
    calc.totalTicketsVoided = 0;
    calc.totalTicketsVoidedAmount = 0;

    calc.netServiceFees = calc.grossServiceFees;
    calc.grossTotalFees = calc.totalProcessingFeesDeductions + calc.grossServiceFees + totalCustomFees;
    calc.netTotalFees = calc.grossTotalFees - calc.totalFeesRefundAdj;
    calc.netProcessingFeesRevenue = calc.grossProcessingFeesRevenue - calc.processingFeeRevRefundAdj;
    calc.donationsNet = calc.donationsGross - calc.donationsRefunded;
    calc.totalDeductions = calc.netTotalFees + calc.totalDiscounts + calc.totalRefunds;
    calc.netRevenue = calc.totalSales - calc.totalDeductions;
    calc.totalLiveTickets = calc.totalTicketsSold - calc.totalTicketsRefunded;

    // Sum reporting daily records
    reported = {
      grossSales: 0, totalSales: 0, netRevenue: 0, totalTicketsSold: 0, totalTicketSales: 0,
      grossServiceFees: 0, netServiceFees: 0, grossTotalFees: 0, netTotalFees: 0,
      grossProcessingFeesRevenue: 0, totalProcessingFeesDeductions: 0, netProcessingFeesRevenue: 0,
      donationsGross: 0, donationsNet: 0, totalDiscounts: 0, totalDeductions: 0,
      totalOrdersCount: 0, totalRefunds: 0, totalTicketsRefunded: 0, donationsRefunded: 0,
      serviceFeeRefundAdj: 0, totalFeesRefundAdj: 0, processingFeeRevRefundAdj: 0,
      totalLiveTickets: 0, totalTicketsVoided: 0, totalTicketsVoidedAmount: 0
    };

    for (const rd of reportingDailies) {
      reported.grossSales += getNum(rd, "Gross Sales");
      reported.totalSales += getNum(rd, "Total Sales");
      reported.netRevenue += getNum(rd, "Net Revenue");
      reported.totalTicketsSold += getNum(rd, "Total Tickets Sold");
      reported.totalTicketSales += getNum(rd, "Total Ticket Sales");
      reported.grossServiceFees += getNum(rd, "Gross Service Fees");
      reported.netServiceFees += getNum(rd, "Net Service Fees");
      reported.grossTotalFees += getNum(rd, "Gross Total Fees");
      reported.netTotalFees += getNum(rd, "Net Total Fees");
      reported.grossProcessingFeesRevenue += getNum(rd, "Gross Processing Fees (Revenue)");
      reported.totalProcessingFeesDeductions += getNum(rd, "Total Processing Fees (Deductions)");
      reported.netProcessingFeesRevenue += getNum(rd, "Net Processing Fees (Revenue)");
      reported.donationsGross += getNum(rd, "Donations Gross");
      reported.donationsNet += getNum(rd, "Donations Net");
      reported.totalDiscounts += getNum(rd, "Total Discounts");
      reported.totalDeductions += getNum(rd, "Total Deductions");
      reported.totalOrdersCount += getNum(rd, "Total Orders Count");
      reported.totalRefunds += getNum(rd, "Total Refunds");
      reported.totalTicketsRefunded += getNum(rd, "Total Tickets Refunded");
      reported.donationsRefunded += getNum(rd, "Donations Refunded");
      reported.serviceFeeRefundAdj += getNum(rd, "Service Fees Refund Adjustments");
      reported.totalFeesRefundAdj += getNum(rd, "Total Fees Refund Adjustments");
      reported.processingFeeRevRefundAdj += getNum(rd, "Processing Fees(Rev) Refund Adjustments");
      reported.totalLiveTickets += getNum(rd, "Total Live Tickets");
      reported.totalTicketsVoided += getNum(rd, "Total Tickets Voided");
      reported.totalTicketsVoidedAmount += getNum(rd, "Total Tickets Voided Amount");
    }

    // Ticket type calc from addons
    ticketCalc = { finalSales: 0, grossSales: 0, serviceFees: 0, discounts: 0, ticketsSoldCount: 0 };
    for (const addon of allTicketAddOns) {
      ticketCalc.finalSales += getNum(addon, "Final Price");
      ticketCalc.grossSales += getNum(addon, "Gross Price");
      ticketCalc.serviceFees += getNum(addon, "Service Fee");
      ticketCalc.discounts += getNum(addon, "Discount");
      ticketCalc.ticketsSoldCount += getNum(addon, "Quantity");
    }
    ticketCalc.totalRefunds = ticketReported.totalRefunds;
    ticketCalc.ticketsRefundedCount = ticketReported.ticketsRefundedCount;
    ticketCalc.serviceFeeRefunds = ticketReported.serviceFeeRefunds;
    ticketCalc.netSales = ticketCalc.finalSales - ticketCalc.serviceFees - ticketCalc.totalRefunds;
    ticketCalc.ticketsLive = ticketCalc.ticketsSoldCount - ticketCalc.ticketsRefundedCount;
    ticketCalc.ticketsVoided = 0;
    ticketCalc.ticketsVoidedAmount = 0;

    // Custom fee daily
    customFeeReported = { grossTotal: 0, netTotal: 0, refundsTotal: 0 };
    for (const cfd of customFeeDailies) {
      customFeeReported.grossTotal += getNum(cfd, "Gross Total");
      customFeeReported.netTotal += getNum(cfd, "Net Total");
      customFeeReported.refundsTotal += getNum(cfd, "Refunds Total");
    }
    customFeeCalc = {
      grossTotal: totalCustomFees,
      refundsTotal: refundAgg.customFeeRefundAdj,
      netTotal: totalCustomFees - refundAgg.customFeeRefundAdj
    };
  }, 300000);

  // GP_ReportingDaily assertions
  it("validates Gross Sales", () => {
    testResultsLogger.step("Gross Sales", { calculated: calc.grossSales, reported: reported.grossSales });
    expect(reported.grossSales).toBeCloseTo(calc.grossSales, 2);
  });

  it("validates Total Sales", () => {
    testResultsLogger.step("Total Sales", { calculated: calc.totalSales, reported: reported.totalSales });
    expect(reported.totalSales).toBeCloseTo(calc.totalSales, 2);
  });

  it("validates Net Revenue", () => {
    testResultsLogger.step("Net Revenue", { calculated: calc.netRevenue, reported: reported.netRevenue });
    expect(reported.netRevenue).toBeCloseTo(calc.netRevenue, 2);
  });

  it("validates Total Tickets Sold", () => {
    testResultsLogger.step("Total Tickets Sold", { calculated: calc.totalTicketsSold, reported: reported.totalTicketsSold });
    expect(reported.totalTicketsSold).toBe(calc.totalTicketsSold);
  });

  it("validates Total Ticket Sales", () => {
    testResultsLogger.step("Total Ticket Sales", { calculated: calc.totalTicketSales, reported: reported.totalTicketSales });
    expect(reported.totalTicketSales).toBeCloseTo(calc.totalTicketSales, 2);
  });

  it("validates Gross Service Fees", () => {
    testResultsLogger.step("Gross Service Fees", { calculated: calc.grossServiceFees, reported: reported.grossServiceFees });
    expect(reported.grossServiceFees).toBeCloseTo(calc.grossServiceFees, 2);
  });

  it("validates Net Service Fees", () => {
    testResultsLogger.step("Net Service Fees", { calculated: calc.netServiceFees, reported: reported.netServiceFees });
    expect(reported.netServiceFees).toBeCloseTo(calc.netServiceFees, 2);
  });

  it("validates Gross Total Fees", () => {
    testResultsLogger.step("Gross Total Fees", { calculated: calc.grossTotalFees, reported: reported.grossTotalFees });
    expect(reported.grossTotalFees).toBeCloseTo(calc.grossTotalFees, 2);
  });

  it("validates Net Total Fees", () => {
    testResultsLogger.step("Net Total Fees", { calculated: calc.netTotalFees, reported: reported.netTotalFees });
    expect(reported.netTotalFees).toBeCloseTo(calc.netTotalFees, 2);
  });

  it("validates Gross Processing Fees (Revenue)", () => {
    testResultsLogger.step("Gross Processing Fees (Revenue)", { calculated: calc.grossProcessingFeesRevenue, reported: reported.grossProcessingFeesRevenue });
    expect(reported.grossProcessingFeesRevenue).toBeCloseTo(calc.grossProcessingFeesRevenue, 2);
  });

  it("validates Total Processing Fees (Deductions)", () => {
    testResultsLogger.step("Total Processing Fees (Deductions)", { calculated: calc.totalProcessingFeesDeductions, reported: reported.totalProcessingFeesDeductions });
    expect(reported.totalProcessingFeesDeductions).toBeCloseTo(calc.totalProcessingFeesDeductions, 2);
  });

  it("validates Net Processing Fees (Revenue)", () => {
    testResultsLogger.step("Net Processing Fees (Revenue)", { calculated: calc.netProcessingFeesRevenue, reported: reported.netProcessingFeesRevenue });
    expect(reported.netProcessingFeesRevenue).toBeCloseTo(calc.netProcessingFeesRevenue, 2);
  });

  it("validates Donations Gross", () => {
    testResultsLogger.step("Donations Gross", { calculated: calc.donationsGross, reported: reported.donationsGross });
    expect(reported.donationsGross).toBeCloseTo(calc.donationsGross, 2);
  });

  it("validates Donations Net", () => {
    testResultsLogger.step("Donations Net", { calculated: calc.donationsNet, reported: reported.donationsNet });
    expect(reported.donationsNet).toBeCloseTo(calc.donationsNet, 2);
  });

  it("validates Total Discounts", () => {
    testResultsLogger.step("Total Discounts", { calculated: calc.totalDiscounts, reported: reported.totalDiscounts });
    expect(reported.totalDiscounts).toBeCloseTo(calc.totalDiscounts, 2);
  });

  it("validates Total Deductions", () => {
    testResultsLogger.step("Total Deductions", { calculated: calc.totalDeductions, reported: reported.totalDeductions });
    expect(reported.totalDeductions).toBeCloseTo(calc.totalDeductions, 2);
  });

  it("validates Total Refunds", () => {
    testResultsLogger.step("Total Refunds", { calculated: calc.totalRefunds, reported: reported.totalRefunds });
    expect(reported.totalRefunds).toBeCloseTo(calc.totalRefunds, 2);
  });

  it("validates Total Orders Count", () => {
    testResultsLogger.step("Total Orders Count", { calculated: calc.totalOrdersCount, reported: reported.totalOrdersCount });
    expect(reported.totalOrdersCount).toBe(calc.totalOrdersCount);
  });

  it("validates Total Live Tickets", () => {
    testResultsLogger.step("Total Live Tickets", { calculated: calc.totalLiveTickets, reported: reported.totalLiveTickets });
    expect(reported.totalLiveTickets).toBe(calc.totalLiveTickets);
  });

  // GP_ReportingTicketTypeDaily assertions
  it("validates Ticket Type Final Sales", () => {
    testResultsLogger.step("Ticket Type Final Sales", { calculated: ticketCalc.finalSales, reported: ticketReported.finalSales });
    expect(ticketReported.finalSales).toBeCloseTo(ticketCalc.finalSales, 2);
  });

  it("validates Ticket Type Gross Sales", () => {
    testResultsLogger.step("Ticket Type Gross Sales", { calculated: ticketCalc.grossSales, reported: ticketReported.grossSales });
    expect(ticketReported.grossSales).toBeCloseTo(ticketCalc.grossSales, 2);
  });

  it("validates Ticket Type Service Fees", () => {
    testResultsLogger.step("Ticket Type Service Fees", { calculated: ticketCalc.serviceFees, reported: ticketReported.serviceFees });
    expect(ticketReported.serviceFees).toBeCloseTo(ticketCalc.serviceFees, 2);
  });

  it("validates Ticket Type Discounts", () => {
    testResultsLogger.step("Ticket Type Discounts", { calculated: ticketCalc.discounts, reported: ticketReported.discounts });
    expect(ticketReported.discounts).toBeCloseTo(ticketCalc.discounts, 2);
  });

  it("validates Ticket Type Tickets Sold Count", () => {
    testResultsLogger.step("Ticket Type Tickets Sold Count", { calculated: ticketCalc.ticketsSoldCount, reported: ticketReported.ticketsSoldCount });
    expect(ticketReported.ticketsSoldCount).toBe(ticketCalc.ticketsSoldCount);
  });

  // GP_ReportingCustomFeeDaily assertions
  it("validates Custom Fee Gross Total", () => {
    testResultsLogger.step("Custom Fee Gross Total", { calculated: customFeeCalc.grossTotal, reported: customFeeReported.grossTotal });
    expect(customFeeReported.grossTotal).toBeCloseTo(customFeeCalc.grossTotal, 2);
  });

  it("validates Custom Fee Refunds Total", () => {
    testResultsLogger.step("Custom Fee Refunds Total", { calculated: customFeeCalc.refundsTotal, reported: customFeeReported.refundsTotal });
    expect(customFeeReported.refundsTotal).toBeCloseTo(customFeeCalc.refundsTotal, 2);
  });

  it("validates Custom Fee Net Total", () => {
    testResultsLogger.step("Custom Fee Net Total", { calculated: customFeeCalc.netTotal, reported: customFeeReported.netTotal });
    expect(customFeeReported.netTotal).toBeCloseTo(customFeeCalc.netTotal, 2);
  });
});
