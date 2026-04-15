const { getThing } = require("../config/bubbleClient");
const { calculateOrder } = require("../lib/orderCalculator");
const { getNum, roundTo2 } = require("../lib/testUtils");
const testResultsLogger = require("../config/testResultsLogger");
const { ORDER_ID, RUN_ORDER_TESTS, TYPES } = require("../testConfig");

let order;
let addOns;
let promotion;
let event;
let eventDetail;
let ticketTypes;
let customFeeTypes;
let orderFees;
let result;

beforeAll(async () => {
  if (!RUN_ORDER_TESTS) return;
  if (!ORDER_ID) {
    throw new Error("Set ORDER_ID in testConfig.js to run this suite");
  }

  order = await getThing(TYPES.GP_ORDER, ORDER_ID);

  // Fetch add-ons from the order's list field
  addOns = await Promise.all(
    (order["Add Ons"] || []).map((id) => getThing(TYPES.GP_ADDON, id))
  );

  // Fetch promotion if linked
  promotion = order["GP_Promotion"]
    ? await getThing(TYPES.GP_PROMOTION, order["GP_Promotion"])
    : null;

  // Fetch event and eventDetail
  event = await getThing(TYPES.EVENT, order["Event"]);
  eventDetail = await getThing(TYPES.GP_EVENTDETAIL, event["GP_EventDetail"]);

  // Build ticketTypes map: { [ticketTypeId]: record }
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
  ticketTypes = Object.fromEntries(ticketTypeEntries);

  // Build customFeeTypes map: { [id]: record }
  const customFeeTypeIds = order["GP_CustomFees"] || [];
  const customFeeEntries = await Promise.all(
    customFeeTypeIds.map((id) => getThing(TYPES.GP_CUSTOMFEES, id).then((r) => [id, r]))
  );
  customFeeTypes = Object.fromEntries(customFeeEntries);

  // Flatten orderFees from each addOn's list, skip 404s
  orderFees = (
    await Promise.all(
      addOns.flatMap((a) =>
        (a["GP_OrderFee"] || []).map((id) =>
          getThing(TYPES.GP_ORDERFEE, id).catch(() => null)
        )
      )
    )
  ).filter(Boolean);

  result = calculateOrder({
    order,
    addOns,
    promotion,
    ticketTypes,
    eventDetail,
    customFeeTypes,
    orderFees
  });
}, 120000);

(RUN_ORDER_TESTS && ORDER_ID ? describe : describe.skip)("Order validation", () => {
  it("validates per-addon gross price", () => {
    const ticketAddOns = addOns.filter((a) => a["OS AddOnType"] === "Ticket");
    ticketAddOns.forEach((addon) => {
      const ticketType = ticketTypes[addon["GP_TicketType"]];
      const ticketPrice = ticketType ? Number(ticketType["Price"]) || 0 : 0;
      const qty = Number(addon["Quantity"]) || 1;
      const expectedGross = roundTo2(ticketPrice * qty);
      const storedGross = Number(addon["Gross Price"]) || 0;
      testResultsLogger.step("Per-addon gross price", {
        addonId: addon._id,
        ticketPrice,
        qty,
        expected: expectedGross,
        stored: storedGross
      });
      expect(storedGross).toBeCloseTo(expectedGross, 2);
    });
  });

  it("validates order gross amount equals sum of addon gross prices", () => {
    const ticketAddOns = addOns.filter((a) => a["OS AddOnType"] === "Ticket");
    const sumAddonGross = roundTo2(
      ticketAddOns.reduce((sum, a) => sum + (Number(a["Gross Price"]) || 0), 0)
    );
    const storedOrderGross = Number(order["Gross Amount"]) || 0;
    testResultsLogger.step("Order gross amount vs sum of addon gross prices", {
      orderId: order._id,
      addonCount: ticketAddOns.length,
      sumAddonGross,
      storedOrderGross
    });
    expect(storedOrderGross).toBeCloseTo(sumAddonGross, 2);
  });

  it("validates ticket count", () => {
    testResultsLogger.step("Calculated ticket count", {
      orderId: order._id,
      calculated: result.ticketCount,
      stored: order["Ticket Count"]
    });
    expect(order["Ticket Count"]).toBe(result.ticketCount);
  });

  it("validates total service fee", () => {
    testResultsLogger.step("Calculated total service fee", {
      orderId: order._id,
      calculated: result.totalServiceFee,
      stored: order["Fee Service"]
    });
    expect(order["Fee Service"]).toBeCloseTo(result.totalServiceFee, 2);
  });

  it("validates discount amount", () => {
    testResultsLogger.step("Calculated discount", {
      orderId: order._id,
      promotion: promotion ? promotion._id : null,
      calculated: result.discountTotal,
      stored: order["Discount Amount"]
    });
    expect(order["Discount Amount"]).toBeCloseTo(result.discountTotal, 2);
  });

  it("validates donation amount", () => {
    testResultsLogger.step("Calculated donation total", {
      orderId: order._id,
      calculated: result.donationTotal,
      stored: order["Donation Amount"] || 0
    });
    expect(order["Donation Amount"] || 0).toBeCloseTo(result.donationTotal, 2);
  });

  it("validates total order value", () => {
    testResultsLogger.step("Calculated total order value", {
      orderId: order._id,
      calculated: result.totalOrderValue,
      stored: order["Total Order Value"]
    });
    expect(order["Total Order Value"]).toBeCloseTo(result.totalOrderValue, 2);
  });

  it("validates processing fee revenue", () => {
    testResultsLogger.step("Calculated processing fee revenue", {
      orderId: order._id,
      calculated: result.processingFeeRevenue,
      stored: order["Processing Fee Revenue"]
    });
    expect(order["Processing Fee Revenue"]).toBeCloseTo(result.processingFeeRevenue, 2);
  });

  it("validates processing fee deduction", () => {
    testResultsLogger.step("Calculated processing fee deduction (stripe)", {
      orderId: order._id,
      calculated: result.stripeDeduction,
      stored: order["Processing Fee Deduction"]
    });
    expect(order["Processing Fee Deduction"]).toBeCloseTo(result.stripeDeduction, 2);
  });

  it("validates custom fees", () => {
    const storedCustomFees = roundTo2(orderFees.reduce(
      (sum, f) => sum + roundTo2(Number(f["GP_OrderFee Amt"]) || 0),
      0
    ));
    testResultsLogger.step("Summed order fees vs calculated custom fees", {
      orderId: order._id,
      orderFeeCount: orderFees.length,
      storedSum: storedCustomFees,
      calculated: result.totalCustomFees
    });
    expect(storedCustomFees).toBeCloseTo(result.totalCustomFees, 2);
  });

  it("validates order has order_status set", () => {
    const statusVal = order["Order Status"];
    testResultsLogger.step("Checked order_status field", {
      orderId: order._id,
      status: statusVal
    });
    expect(statusVal != null && statusVal !== "").toBe(true);
  });

  it("validates order has payment_method set", () => {
    const methodVal = order["Payment Method"];
    testResultsLogger.step("Checked payment_method field", {
      orderId: order._id,
      paymentMethod: methodVal
    });
    expect(methodVal != null && methodVal !== "").toBe(true);
  });

  it("validates order has user or guest checkout", () => {
    const hasUser = !!order["User"];
    const isGuest = !!order["Guest Checkout"];
    testResultsLogger.step("Checked user or guest checkout", {
      orderId: order._id,
      hasUser,
      isGuest
    });
    expect(hasUser || isGuest).toBe(true);
  });

  it("validates order has order_id_text set", () => {
    const orderIdText = order["Order ID Text"];
    testResultsLogger.step("Checked order_id_text field", {
      orderId: order._id,
      orderIdDisplay: orderIdText
    });
    expect(orderIdText != null && orderIdText !== "").toBe(true);
  });

  it("validates order has event linked", () => {
    const eventId = order["Event"];
    testResultsLogger.step("Checked event link", {
      orderId: order._id,
      eventId: eventId || "(none)"
    });
    expect(eventId != null && eventId !== "").toBe(true);
  });
});
