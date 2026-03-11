const { getThing, searchThings } = require("../config/bubbleClient");
const { calculateRefundAggregates } = require("../lib/refundCalculator");
const { getNum } = require("../lib/testUtils");
const testResultsLogger = require("../config/testResultsLogger");
const { ORDER_ID, RUN_REPORTING_DAILY_TESTS, TYPES } = require("../testConfig");

let orders = [];
let reportingDailies = [];
let ticketTypeDailies = [];
let customFeeDailies = [];
let allTicketAddOns = [];
let allOrderFees = [];
let allRefundItems = [];

let calc = {};
let reported = {};
let ticketCalc = {};
let ticketReported = {};
let customFeeCalc = {};
let customFeeReported = {};
let refundAgg = {};

beforeAll(async () => {
  if (!RUN_REPORTING_DAILY_TESTS) return;
  if (!ORDER_ID) {
    throw new Error("Set ORDER_ID in testConfig.js to run this suite");
  }

  // Fetch seed order to get date+event
  const seedOrder = await getThing(TYPES.GP_ORDER, ORDER_ID);
  const dateLabel = seedOrder["Date Label"];
  const eventId = seedOrder["Event"];
  if (!dateLabel || !eventId) {
    throw new Error(`Seed order ${ORDER_ID} missing Date Label or Event`);
  }

  // Search for all related records in parallel
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
  if (orders.length === 0) {
    throw new Error(`No paid orders for date="${dateLabel}", event=${eventId}`);
  }

  // For each order, fetch addons, order fees, and refund items
  for (const ord of orders) {
    const addonIds = ord["Add Ons"] || [];
    const addons = (
      await Promise.all(addonIds.map(id => getThing(TYPES.GP_ADDON, id).catch(() => null)))
    ).filter(Boolean);

    for (const addon of addons) {
      if (addon["OS AddOnType"] === "Ticket") {
        allTicketAddOns.push(addon);
      }
      const feeIds = addon["GP_OrderFee"] || [];
      const fees = (
        await Promise.all(feeIds.map(id => getThing(TYPES.GP_ORDERFEE, id).catch(() => null)))
      ).filter(Boolean);
      allOrderFees.push(...fees);
    }

    // Fetch refund transactions and their items
    const refundTxnIds = ord["RefundTransactions"] || [];
    for (const txnId of refundTxnIds) {
      const txn = await getThing(TYPES.GYM_TRANSACTION, txnId).catch(() => null);
      if (!txn) continue;
      const itemIds = txn["RefundItems"] || [];
      const items = (
        await Promise.all(itemIds.map(id => getThing(TYPES.GP_REFUNDITEMS, id).catch(() => null)))
      ).filter(Boolean);
      allRefundItems.push(...items);
    }
  }

  // --- Aggregate order-level sums ---
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

  // Refund aggregation
  refundAgg = calculateRefundAggregates({ refundItems: allRefundItems });

  calc.totalRefunds = refundAgg.totalRefunds;
  calc.totalTicketsRefunded = refundAgg.totalTicketsRefunded;
  calc.donationsRefunded = refundAgg.donationsRefunded;
  calc.serviceFeeRefundAdj = refundAgg.serviceFeeRefundAdj;
  calc.totalFeesRefundAdj = refundAgg.totalFeesRefundAdj;
  calc.processingFeeRevRefundAdj = refundAgg.processingFeeRevRefundAdj;

  // Net formulas (with refund adjustments)
  calc.netServiceFees = calc.grossServiceFees; // GP_Refund_application_fee? is OFF
  calc.grossTotalFees = calc.totalProcessingFeesDeductions + calc.grossServiceFees + totalCustomFees;
  calc.netTotalFees = calc.grossTotalFees - calc.totalFeesRefundAdj;
  calc.netProcessingFeesRevenue = calc.grossProcessingFeesRevenue - calc.processingFeeRevRefundAdj;
  calc.donationsNet = calc.donationsGross - calc.donationsRefunded;
  calc.totalDeductions = calc.netTotalFees + calc.totalDiscounts + calc.totalRefunds;
  calc.netRevenue = calc.totalSales - calc.totalDeductions;

  // --- Sum reporting daily record values ---
  reported.grossSales = 0;
  reported.totalSales = 0;
  reported.netRevenue = 0;
  reported.totalTicketsSold = 0;
  reported.totalTicketSales = 0;
  reported.grossServiceFees = 0;
  reported.netServiceFees = 0;
  reported.grossTotalFees = 0;
  reported.netTotalFees = 0;
  reported.grossProcessingFeesRevenue = 0;
  reported.totalProcessingFeesDeductions = 0;
  reported.netProcessingFeesRevenue = 0;
  reported.donationsGross = 0;
  reported.donationsNet = 0;
  reported.totalDiscounts = 0;
  reported.totalDeductions = 0;
  reported.totalOrdersCount = 0;
  reported.totalRefunds = 0;
  reported.totalTicketsRefunded = 0;
  reported.donationsRefunded = 0;
  reported.serviceFeeRefundAdj = 0;
  reported.totalFeesRefundAdj = 0;
  reported.processingFeeRevRefundAdj = 0;

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
  }

  // --- Ticket type daily aggregates ---
  ticketCalc = { finalSales: 0, grossSales: 0, serviceFees: 0, discounts: 0, ticketsSoldCount: 0 };
  for (const addon of allTicketAddOns) {
    ticketCalc.finalSales += getNum(addon, "Final Price");
    ticketCalc.grossSales += getNum(addon, "Gross Price");
    ticketCalc.serviceFees += getNum(addon, "Service Fee");
    ticketCalc.discounts += getNum(addon, "Discount");
    ticketCalc.ticketsSoldCount += getNum(addon, "Quantity");
  }

  ticketReported = { finalSales: 0, grossSales: 0, serviceFees: 0, discounts: 0, ticketsSoldCount: 0 };
  for (const ttd of ticketTypeDailies) {
    ticketReported.finalSales += getNum(ttd, "Final Sales");
    ticketReported.grossSales += getNum(ttd, "Gross Sales");
    ticketReported.serviceFees += getNum(ttd, "Service Fees");
    ticketReported.discounts += getNum(ttd, "Discounts");
    ticketReported.ticketsSoldCount += getNum(ttd, "Tickets Sold Count");
  }

  // --- Custom fee daily aggregates ---
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
}, 120000);

// ─── GP_ReportingDaily ──────────────────────────────────────────────────────────

(RUN_REPORTING_DAILY_TESTS ? describe : describe.skip)(
  "GP_ReportingDaily validation",
  () => {
    it("validates Gross Sales", () => {
      testResultsLogger.step("Gross Sales: sum of order Total Order Value", {
        calculated: calc.grossSales,
        reported: reported.grossSales
      });
      expect(reported.grossSales).toBeCloseTo(calc.grossSales, 2);
    });

    it("validates Total Sales", () => {
      testResultsLogger.step("Total Sales: sum of (Total Order Value + Discount Amount)", {
        calculated: calc.totalSales,
        reported: reported.totalSales
      });
      expect(reported.totalSales).toBeCloseTo(calc.totalSales, 2);
    });

    it("validates Net Revenue", () => {
      testResultsLogger.step("Net Revenue: Total Sales - Total Deductions", {
        totalSales: calc.totalSales,
        totalDeductions: calc.totalDeductions,
        calculated: calc.netRevenue,
        reported: reported.netRevenue
      });
      expect(reported.netRevenue).toBeCloseTo(calc.netRevenue, 2);
    });

    it("validates Total Tickets Sold", () => {
      testResultsLogger.step("Total Tickets Sold: sum of order Ticket Count", {
        calculated: calc.totalTicketsSold,
        reported: reported.totalTicketsSold
      });
      expect(reported.totalTicketsSold).toBe(calc.totalTicketsSold);
    });

    it("validates Total Ticket Sales", () => {
      testResultsLogger.step("Total Ticket Sales: sum of ticket addon Gross Price", {
        ticketAddOnCount: allTicketAddOns.length,
        calculated: calc.totalTicketSales,
        reported: reported.totalTicketSales
      });
      expect(reported.totalTicketSales).toBeCloseTo(calc.totalTicketSales, 2);
    });

    it("validates Gross Service Fees", () => {
      testResultsLogger.step("Gross Service Fees: sum of order Fee Service", {
        calculated: calc.grossServiceFees,
        reported: reported.grossServiceFees
      });
      expect(reported.grossServiceFees).toBeCloseTo(calc.grossServiceFees, 2);
    });

    it("validates Net Service Fees", () => {
      testResultsLogger.step("Net Service Fees: equals Gross (GP_Refund_application_fee OFF)", {
        calculated: calc.netServiceFees,
        reported: reported.netServiceFees
      });
      expect(reported.netServiceFees).toBeCloseTo(calc.netServiceFees, 2);
    });

    it("validates Gross Total Fees", () => {
      testResultsLogger.step("Gross Total Fees: Processing Fee Deduction + Fee Service + Custom Fees", {
        processingFeeDeductions: calc.totalProcessingFeesDeductions,
        serviceFees: calc.grossServiceFees,
        customFees: customFeeCalc.grossTotal,
        calculated: calc.grossTotalFees,
        reported: reported.grossTotalFees
      });
      expect(reported.grossTotalFees).toBeCloseTo(calc.grossTotalFees, 2);
    });

    it("validates Net Total Fees", () => {
      testResultsLogger.step("Net Total Fees: Gross Total Fees - Total Fees Refund Adj", {
        grossTotalFees: calc.grossTotalFees,
        totalFeesRefundAdj: calc.totalFeesRefundAdj,
        calculated: calc.netTotalFees,
        reported: reported.netTotalFees
      });
      expect(reported.netTotalFees).toBeCloseTo(calc.netTotalFees, 2);
    });

    it("validates Gross Processing Fees (Revenue)", () => {
      testResultsLogger.step("Gross Processing Fees (Revenue): sum of order Processing Fee Revenue", {
        calculated: calc.grossProcessingFeesRevenue,
        reported: reported.grossProcessingFeesRevenue
      });
      expect(reported.grossProcessingFeesRevenue).toBeCloseTo(calc.grossProcessingFeesRevenue, 2);
    });

    it("validates Total Processing Fees (Deductions)", () => {
      testResultsLogger.step("Total Processing Fees (Deductions): sum of order Processing Fee Deduction", {
        calculated: calc.totalProcessingFeesDeductions,
        reported: reported.totalProcessingFeesDeductions
      });
      expect(reported.totalProcessingFeesDeductions).toBeCloseTo(calc.totalProcessingFeesDeductions, 2);
    });

    it("validates Net Processing Fees (Revenue)", () => {
      testResultsLogger.step("Net Processing Fees (Revenue): Gross - Processing Fees(Rev) Refund Adj", {
        gross: calc.grossProcessingFeesRevenue,
        refundAdj: calc.processingFeeRevRefundAdj,
        calculated: calc.netProcessingFeesRevenue,
        reported: reported.netProcessingFeesRevenue
      });
      expect(reported.netProcessingFeesRevenue).toBeCloseTo(calc.netProcessingFeesRevenue, 2);
    });

    it("validates Donations Gross", () => {
      testResultsLogger.step("Donations Gross: sum of order Donation Amount", {
        calculated: calc.donationsGross,
        reported: reported.donationsGross
      });
      expect(reported.donationsGross).toBeCloseTo(calc.donationsGross, 2);
    });

    it("validates Donations Net", () => {
      testResultsLogger.step("Donations Net: Donations Gross - Donations Refunded", {
        donationsGross: calc.donationsGross,
        donationsRefunded: calc.donationsRefunded,
        calculated: calc.donationsNet,
        reported: reported.donationsNet
      });
      expect(reported.donationsNet).toBeCloseTo(calc.donationsNet, 2);
    });

    it("validates Total Discounts", () => {
      testResultsLogger.step("Total Discounts: sum of order Discount Amount", {
        calculated: calc.totalDiscounts,
        reported: reported.totalDiscounts
      });
      expect(reported.totalDiscounts).toBeCloseTo(calc.totalDiscounts, 2);
    });

    it("validates Total Deductions", () => {
      testResultsLogger.step("Total Deductions: Net Total Fees + Total Discounts + Total Refunds", {
        netTotalFees: calc.netTotalFees,
        totalDiscounts: calc.totalDiscounts,
        totalRefunds: calc.totalRefunds,
        calculated: calc.totalDeductions,
        reported: reported.totalDeductions
      });
      expect(reported.totalDeductions).toBeCloseTo(calc.totalDeductions, 2);
    });

    it("validates Total Refunds", () => {
      testResultsLogger.step("Total Refunds: sum of all refund item amounts", {
        calculated: calc.totalRefunds,
        reported: reported.totalRefunds,
        refundItemCount: allRefundItems.length
      });
      expect(reported.totalRefunds).toBeCloseTo(calc.totalRefunds, 2);
    });

    it("validates Total Tickets Refunded", () => {
      testResultsLogger.step("Total Tickets Refunded: count of ticket-type refund items", {
        calculated: calc.totalTicketsRefunded,
        reported: reported.totalTicketsRefunded
      });
      expect(reported.totalTicketsRefunded).toBe(calc.totalTicketsRefunded);
    });

    it("validates Donations Refunded", () => {
      testResultsLogger.step("Donations Refunded: sum of donation-type refund items", {
        calculated: calc.donationsRefunded,
        reported: reported.donationsRefunded
      });
      expect(reported.donationsRefunded).toBeCloseTo(calc.donationsRefunded, 2);
    });

    it("validates Service Fees Refund Adjustments", () => {
      testResultsLogger.step("Service Fees Refund Adjustments: sum of service_fee-type items", {
        calculated: calc.serviceFeeRefundAdj,
        reported: reported.serviceFeeRefundAdj
      });
      expect(reported.serviceFeeRefundAdj).toBeCloseTo(calc.serviceFeeRefundAdj, 2);
    });

    it("validates Total Fees Refund Adjustments", () => {
      testResultsLogger.step("Total Fees Refund Adjustments: recoverable service_fee + custom_fee items", {
        calculated: calc.totalFeesRefundAdj,
        reported: reported.totalFeesRefundAdj
      });
      expect(reported.totalFeesRefundAdj).toBeCloseTo(calc.totalFeesRefundAdj, 2);
    });

    it("validates Processing Fees(Rev) Refund Adjustments", () => {
      testResultsLogger.step("Processing Fees(Rev) Refund Adjustments: recoverable fee-type items", {
        calculated: calc.processingFeeRevRefundAdj,
        reported: reported.processingFeeRevRefundAdj
      });
      expect(reported.processingFeeRevRefundAdj).toBeCloseTo(calc.processingFeeRevRefundAdj, 2);
    });

    it("validates Total Orders Count", () => {
      testResultsLogger.step("Total Orders Count: number of paid orders", {
        calculated: calc.totalOrdersCount,
        reported: reported.totalOrdersCount
      });
      expect(reported.totalOrdersCount).toBe(calc.totalOrdersCount);
    });
  }
);

// ─── GP_ReportingTicketTypeDaily ─────────────────────────────────────────────────

(RUN_REPORTING_DAILY_TESTS ? describe : describe.skip)(
  "GP_ReportingTicketTypeDaily validation",
  () => {
    it("validates Final Sales", () => {
      testResultsLogger.step("Final Sales: sum of ticket addon Final Price", {
        ticketAddOnCount: allTicketAddOns.length,
        calculated: ticketCalc.finalSales,
        reported: ticketReported.finalSales
      });
      expect(ticketReported.finalSales).toBeCloseTo(ticketCalc.finalSales, 2);
    });

    it("validates Gross Sales", () => {
      testResultsLogger.step("Gross Sales: sum of ticket addon Gross Price", {
        calculated: ticketCalc.grossSales,
        reported: ticketReported.grossSales
      });
      expect(ticketReported.grossSales).toBeCloseTo(ticketCalc.grossSales, 2);
    });

    it("validates Service Fees", () => {
      testResultsLogger.step("Service Fees: sum of ticket addon Service Fee", {
        calculated: ticketCalc.serviceFees,
        reported: ticketReported.serviceFees
      });
      expect(ticketReported.serviceFees).toBeCloseTo(ticketCalc.serviceFees, 2);
    });

    it("validates Discounts", () => {
      testResultsLogger.step("Discounts: sum of ticket addon Discount", {
        calculated: ticketCalc.discounts,
        reported: ticketReported.discounts
      });
      expect(ticketReported.discounts).toBeCloseTo(ticketCalc.discounts, 2);
    });

    it("validates Tickets Sold Count", () => {
      testResultsLogger.step("Tickets Sold Count: sum of ticket addon Quantity", {
        calculated: ticketCalc.ticketsSoldCount,
        reported: ticketReported.ticketsSoldCount
      });
      expect(ticketReported.ticketsSoldCount).toBe(ticketCalc.ticketsSoldCount);
    });
  }
);

// ─── GP_ReportingCustomFeeDaily ──────────────────────────────────────────────────

(RUN_REPORTING_DAILY_TESTS ? describe : describe.skip)(
  "GP_ReportingCustomFeeDaily validation",
  () => {
    it("validates Gross Total", () => {
      testResultsLogger.step("Gross Total: sum of GP_OrderFee amounts", {
        orderFeeCount: allOrderFees.length,
        calculated: customFeeCalc.grossTotal,
        reported: customFeeReported.grossTotal
      });
      expect(customFeeReported.grossTotal).toBeCloseTo(customFeeCalc.grossTotal, 2);
    });

    it("validates Refunds Total", () => {
      testResultsLogger.step("Refunds Total: sum of custom_fee refund items", {
        calculated: customFeeCalc.refundsTotal,
        reported: customFeeReported.refundsTotal
      });
      expect(customFeeReported.refundsTotal).toBeCloseTo(customFeeCalc.refundsTotal, 2);
    });

    it("validates Net Total", () => {
      testResultsLogger.step("Net Total: Gross Total - Refunds Total", {
        grossTotal: customFeeCalc.grossTotal,
        refundsTotal: customFeeCalc.refundsTotal,
        calculated: customFeeCalc.netTotal,
        reported: customFeeReported.netTotal
      });
      expect(customFeeReported.netTotal).toBeCloseTo(customFeeCalc.netTotal, 2);
    });
  }
);
