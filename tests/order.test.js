const { getThing, searchThings } = require("../config/bubbleClient");
const { calculateOrder } = require("../lib/orderCalculator");
const { getNum } = require("../lib/testUtils");
const testResultsLogger = require("../config/testResultsLogger");
const { ORDER_ID, RUN_ORDER_TESTS, TYPES } = require("../testConfig");

let order;
let addOns;
let tickets;
let orderFees;
let result;

beforeAll(async () => {
  if (!RUN_ORDER_TESTS) return;
  if (!ORDER_ID) {
    throw new Error("Set ORDER_ID in testConfig.js to run this suite");
  }

  order = await getThing(TYPES.GP_ORDER, ORDER_ID);

  // Fetch add-ons linked to this order (try order_custom_gp_order first, fallback to order)
  addOns = await searchThings(TYPES.GP_ADDON, [
    { key: "order_custom_gp_order", constraint_type: "equals", value: ORDER_ID }
  ]);
  if (addOns.length === 0) {
    addOns = await searchThings(TYPES.GP_ADDON, [
      { key: "order", constraint_type: "equals", value: ORDER_ID }
    ]);
  }
  if (addOns.length === 0 && order.add_on_list_custom_gp_addon && Array.isArray(order.add_on_list_custom_gp_addon)) {
    addOns = await Promise.all(
      order.add_on_list_custom_gp_addon.map((id) => getThing(TYPES.GP_ADDON, id))
    );
  }

  // Fetch tickets linked to this order
  tickets = await searchThings(TYPES.GP_TICKETS, [
    { key: "order_custom_gp_order", constraint_type: "equals", value: ORDER_ID }
  ]);
  if (tickets.length === 0) {
    tickets = await searchThings(TYPES.GP_TICKETS, [
      { key: "order", constraint_type: "equals", value: ORDER_ID }
    ]);
  }

  // Fetch order fees linked to this order
  orderFees = await searchThings(TYPES.GP_ORDERFEE, [
    { key: "order_custom_gp_order", constraint_type: "equals", value: ORDER_ID }
  ]);
  if (orderFees.length === 0) {
    orderFees = await searchThings(TYPES.GP_ORDERFEE, [
      { key: "order", constraint_type: "equals", value: ORDER_ID }
    ]);
  }

  result = calculateOrder({
    order,
    addOns,
    tickets,
    orderFees
  });
}, 120000);

(RUN_ORDER_TESTS && ORDER_ID ? describe : describe.skip)("Order validation", () => {
  it("validates gross amount equals sum of add-on and ticket line items", () => {
    testResultsLogger.step("Fetched Order and line items", {
      orderId: order._id,
      addOnCount: addOns.length,
      ticketCount: tickets.length
    });
    testResultsLogger.step("Calculated gross from line items", {
      formula: "Sum of (quantity × price) for add-ons and tickets",
      addOnSubtotals: result.addOnSubtotals.map((s) => s.subtotal),
      ticketSubtotals: result.ticketSubtotals.map((s) => s.price),
      result: result.grossAmount
    });
    testResultsLogger.step("Compared with Bubble field", {
      expected: result.grossAmount,
      actual: getNum(order, "gross_amount_number")
    });
    expect(getNum(order, "gross_amount_number")).toBeCloseTo(result.grossAmount, 2);
  });

  it("validates each add-on subtotal equals quantity × unit price", () => {
    testResultsLogger.step("Fetched order add-ons", {
      itemCount: addOns.length,
      itemIds: addOns.map((a) => a._id)
    });
    addOns.forEach((addon, i) => {
      const price = getNum(addon, "price_number", "fee_amount_number", "fee___number");
      const qty = getNum(addon, "quantity_number") || 1;
      const expectedSubtotal = result.addOnSubtotals[i]?.subtotal ?? Math.round((price * qty) * 100) / 100;
      testResultsLogger.step("Validated add-on subtotal", {
        itemId: addon._id,
        storedPrice: price,
        quantity: qty,
        calculatedSubtotal: expectedSubtotal
      });
      expect(price * qty).toBeCloseTo(expectedSubtotal, 2);
    });
    testResultsLogger.step("Verified line items exist", {
      addOnCount: addOns.length,
      ticketCount: tickets.length
    });
    expect(addOns.length + tickets.length).toBeGreaterThan(0);
  });

  it("validates order total (total order value)", () => {
    testResultsLogger.step("Calculated total order value", {
      formula: "grossAmount + fees - discount",
      grossAmount: result.grossAmount,
      feeRegistration: result.feeRegistration,
      feeService: result.feeService,
      platformFee: result.platformFee,
      discountValue: result.discountValue,
      result: result.totalOrderValue
    });
    testResultsLogger.step("Compared with Bubble field", {
      expected: result.totalOrderValue,
      actual: getNum(order, "total_order_value_number")
    });
    expect(getNum(order, "total_order_value_number")).toBeCloseTo(result.totalOrderValue, 2);
  });

  it("validates total due now", () => {
    testResultsLogger.step("Calculated total due now", {
      formula: "totalOrderValue - creditApplied - deposit",
      totalOrderValue: result.totalOrderValue,
      creditApplied: result.creditApplied,
      deposit: result.deposit,
      result: result.totalDueNow
    });
    testResultsLogger.step("Compared with Bubble field", {
      expected: result.totalDueNow,
      actual: getNum(order, "total_due_now_number")
    });
    expect(getNum(order, "total_due_now_number")).toBeCloseTo(result.totalDueNow, 2);
  });

  it("validates discount amount when promotion applied", () => {
    const storedDiscount = getNum(order, "discount_value_number");
    testResultsLogger.step("Checked discount amount", {
      orderId: order._id,
      storedDiscount,
      calculatedDiscount: result.discountValue
    });
    expect(storedDiscount).toBeCloseTo(result.discountValue, 2);
  });

  it("validates donation amount when donations present", () => {
    testResultsLogger.step("Calculated donation from add-ons", {
      formula: "Sum of add-ons where type = donation",
      result: result.donationAmount
    });
    testResultsLogger.step("Compared with Bubble field", {
      expected: result.donationAmount,
      actual: getNum(order, "donation_amount_number")
    });
    expect(getNum(order, "donation_amount_number")).toBeCloseTo(result.donationAmount, 2);
  });

  it("validates processing fee when enabled", () => {
    const storedFee = getNum(order, "processing_fee_number");
    testResultsLogger.step("Checked processing fee", {
      orderId: order._id,
      storedProcessingFee: storedFee,
      note: "Processing fee is 0 when disabled; backend calculates when enabled"
    });
    expect(storedFee).toBeGreaterThanOrEqual(0);
  });

  it("validates processing fee deduction when applicable", () => {
    const storedDeduction = getNum(order, "_processing_fee_deduction_number");
    testResultsLogger.step("Checked processing fee deduction", {
      orderId: order._id,
      storedDeduction,
      note: "Empty/0 for orders without processing fees"
    });
    expect(storedDeduction).toBeGreaterThanOrEqual(0);
  });

  it("validates processing fee revenue when applicable", () => {
    const storedRevenue = getNum(order, "_processing_fee_revenue_number");
    testResultsLogger.step("Checked processing fee revenue", {
      orderId: order._id,
      storedRevenue,
      note: "Empty/0 for orders without processing fees"
    });
    expect(storedRevenue).toBeGreaterThanOrEqual(0);
  });

  it("validates order has order_status set", () => {
    const status = order.order_status_option_os_orderstatus || order.order_status;
    const statusVal = typeof status === "object" ? (status && status.option_value) : status;
    testResultsLogger.step("Checked order_status field", {
      orderId: order._id,
      status: statusVal
    });
    expect(statusVal != null && statusVal !== "").toBe(true);
  });

  it("validates order has payment_method set", () => {
    const method = order.payment_method_option_os_payment_type0 || order.payment_method;
    const methodVal = typeof method === "object" ? (method && method.option_value) : method;
    testResultsLogger.step("Checked payment_method field", {
      orderId: order._id,
      paymentMethod: methodVal
    });
    expect(methodVal != null && methodVal !== "").toBe(true);
  });

  it("validates order has user or guest checkout", () => {
    const hasUser = !!order.user_user;
    const isGuest = !!order.guest_checkout_boolean;
    testResultsLogger.step("Checked user or guest checkout", {
      orderId: order._id,
      hasUser,
      isGuest
    });
    expect(hasUser || isGuest).toBe(true);
  });

  it("validates order has order_id_text set", () => {
    const orderIdText = order.order_id_text_text || order.order_id_text;
    testResultsLogger.step("Checked order_id_text field", {
      orderId: order._id,
      orderIdDisplay: orderIdText
    });
    expect(orderIdText != null && orderIdText !== "").toBe(true);
  });

  it("validates order has event linked", () => {
    const eventId = order.event_custom_event;
    testResultsLogger.step("Checked event link", {
      orderId: order._id,
      eventId: eventId || "(none)"
    });
    expect(eventId != null && eventId !== "").toBe(true);
  });

  it("validates order items count matches fetched add-ons and tickets", () => {
    const orderAddOnIds = order.add_on_list_custom_gp_addon || [];
    const orderAddOnCount = Array.isArray(orderAddOnIds) ? orderAddOnIds.length : 0;
    const fetchedCount = addOns.length + tickets.length;
    testResultsLogger.step("Compared item counts", {
      orderId: order._id,
      fetchedAddOnCount: addOns.length,
      fetchedTicketCount: tickets.length,
      orderLinkedAddOnCount: orderAddOnCount
    });
    expect(fetchedCount).toBeGreaterThan(0);
    if (orderAddOnCount > 0) {
      expect(addOns.length).toBe(orderAddOnCount);
    }
  });

  it("validates fee registration when set", () => {
    const storedFee = getNum(order, "fee_registration_number");
    testResultsLogger.step("Checked fee registration", {
      orderId: order._id,
      storedFee,
      calculatedFee: result.feeRegistration
    });
    expect(storedFee).toBeCloseTo(result.feeRegistration, 2);
  });

  it("validates fee service when set", () => {
    const storedFee = getNum(order, "fee_service_number");
    testResultsLogger.step("Checked fee service", {
      orderId: order._id,
      storedFee,
      calculatedFee: result.feeService
    });
    expect(storedFee).toBeCloseTo(result.feeService, 2);
  });

  it("validates sales tax when applicable", () => {
    const storedTax = getNum(order, "sales_tax_number");
    testResultsLogger.step("Checked sales tax", {
      orderId: order._id,
      storedTax,
      calculatedTax: result.salesTax
    });
    expect(storedTax).toBeCloseTo(result.salesTax, 2);
  });

  it("validates credit applied when applicable", () => {
    const storedCredit = getNum(order, "creditapplied_number");
    testResultsLogger.step("Checked credit applied", {
      orderId: order._id,
      storedCredit,
      calculatedCredit: result.creditApplied
    });
    expect(storedCredit).toBeCloseTo(result.creditApplied, 2);
  });

  it("validates deposit when applicable", () => {
    const storedDeposit = getNum(order, "deposit_number");
    testResultsLogger.step("Checked deposit", {
      orderId: order._id,
      storedDeposit,
      calculatedDeposit: result.deposit
    });
    expect(storedDeposit).toBeCloseTo(result.deposit, 2);
  });
});
