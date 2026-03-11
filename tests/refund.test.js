const { getThing } = require("../config/bubbleClient");
const { calculateRefundAggregates } = require("../lib/refundCalculator");
const { getNum } = require("../lib/testUtils");
const testResultsLogger = require("../config/testResultsLogger");
const { REFUND_TRANSACTION_ID, REFUND_ORDER_ID, RUN_REFUND_TESTS, TYPES } = require("../testConfig");

let order;
let transaction;
let refundItems;
let payIntent;
let refundAgg;

beforeAll(async () => {
  if (!RUN_REFUND_TESTS) return;
  if (!REFUND_TRANSACTION_ID || !REFUND_ORDER_ID) {
    throw new Error("Set REFUND_TRANSACTION_ID and REFUND_ORDER_ID in testConfig.js");
  }

  // Fetch order, transaction, and payIntent in parallel
  [order, transaction] = await Promise.all([
    getThing(TYPES.GP_ORDER, REFUND_ORDER_ID),
    getThing(TYPES.GYM_TRANSACTION, REFUND_TRANSACTION_ID)
  ]);

  // Fetch refund items from transaction
  const refundItemIds = transaction["RefundItems"] || [];
  if (refundItemIds.length === 0) {
    throw new Error(`Transaction ${REFUND_TRANSACTION_ID} has no RefundItems`);
  }
  refundItems = await Promise.all(
    refundItemIds.map((id) => getThing(TYPES.GP_REFUNDITEMS, id))
  );

  // Fetch payIntent from transaction
  const payIntentId = transaction["PayIntent"];
  payIntent = payIntentId ? await getThing(TYPES.PAYINTENT, payIntentId) : null;

  // Calculate aggregates
  refundAgg = calculateRefundAggregates({ refundItems });
}, 120000);

// ─── GYM_Transaction refund validation ──────────────────────────────────────────

(RUN_REFUND_TESTS && REFUND_TRANSACTION_ID ? describe : describe.skip)(
  "GYM_Transaction refund validation",
  () => {
    it("validates transaction type is Refund", () => {
      const type = transaction["OS GYM Transaction Type"];
      testResultsLogger.step("Transaction type", {
        transactionId: transaction._id,
        type
      });
      expect(type).toBe("Refund");
    });

    it("validates Credit/Debit is Credit", () => {
      const creditDebit = transaction["Credit/Debit"];
      testResultsLogger.step("Credit/Debit", {
        transactionId: transaction._id,
        creditDebit
      });
      expect(creditDebit).toBe("Credit");
    });

    it("validates Net Amount equals sum of refund item amounts", () => {
      const netAmount = getNum(transaction, "Net Amount");
      testResultsLogger.step("Net Amount vs sum of refund items", {
        transactionId: transaction._id,
        netAmount,
        sumOfItems: refundAgg.totalRefunds
      });
      expect(netAmount).toBeCloseTo(refundAgg.totalRefunds, 2);
    });

    it("validates Refund Date is populated", () => {
      const refundDate = transaction["Refund Date"];
      testResultsLogger.step("Refund Date", {
        transactionId: transaction._id,
        refundDate
      });
      expect(refundDate != null && refundDate !== "").toBe(true);
    });

    it("validates RefundItems list is not empty", () => {
      const itemCount = (transaction["RefundItems"] || []).length;
      testResultsLogger.step("RefundItems count", {
        transactionId: transaction._id,
        itemCount
      });
      expect(itemCount).toBeGreaterThan(0);
    });

    it("validates Order links back to the order", () => {
      const linkedOrder = transaction["Order"];
      testResultsLogger.step("Order back-link", {
        transactionId: transaction._id,
        linkedOrder,
        expectedOrder: REFUND_ORDER_ID
      });
      expect(linkedOrder).toBe(REFUND_ORDER_ID);
    });
  }
);

// ─── GP_RefundItems validation ──────────────────────────────────────────────────

(RUN_REFUND_TESTS && REFUND_TRANSACTION_ID ? describe : describe.skip)(
  "GP_RefundItems validation",
  () => {
    it("validates each item has Amount >= 0 and OS RefundItemType set", () => {
      refundItems.forEach((item) => {
        const amount = getNum(item, "Amount");
        const type = item["OS RefundItemType"];
        testResultsLogger.step("RefundItem basics", {
          itemId: item._id,
          amount,
          type
        });
        expect(amount).toBeGreaterThanOrEqual(0);
        expect(type != null && type !== "").toBe(true);
      });
    });

    it("validates ticket items have ticket and ticketType linked", () => {
      const ticketItems = refundItems.filter((i) => i["OS RefundItemType"] === "ticket");
      ticketItems.forEach((item) => {
        testResultsLogger.step("Ticket refund item links", {
          itemId: item._id,
          ticket: item["ticket"],
          ticketType: item["ticketType"]
        });
        expect(item["ticket"] != null && item["ticket"] !== "").toBe(true);
        expect(item["ticketType"] != null && item["ticketType"] !== "").toBe(true);
      });
    });

    it("validates each item has Transaction back-ref set", () => {
      refundItems.forEach((item) => {
        testResultsLogger.step("RefundItem Transaction back-ref", {
          itemId: item._id,
          transaction: item["Transaction"]
        });
        expect(item["Transaction"]).toBe(REFUND_TRANSACTION_ID);
      });
    });

    it("validates sum of item amounts equals transaction Net Amount", () => {
      const sumAmounts = refundItems.reduce((sum, item) => sum + getNum(item, "Amount"), 0);
      const netAmount = getNum(transaction, "Net Amount");
      testResultsLogger.step("Sum of item amounts vs Net Amount", {
        sumAmounts,
        netAmount,
        itemCount: refundItems.length
      });
      expect(sumAmounts).toBeCloseTo(netAmount, 2);
    });
  }
);

// ─── PayIntent refund validation ────────────────────────────────────────────────

(RUN_REFUND_TESTS && REFUND_TRANSACTION_ID ? describe : describe.skip)(
  "PayIntent refund validation",
  () => {
    it("validates PayIntentStatus is success", () => {
      testResultsLogger.step("PayIntent status", {
        payIntentId: payIntent._id,
        status: payIntent["PayIntentStatus"]
      });
      expect(payIntent["PayIntentStatus"]).toBe("Success");
    });

    it("validates AmountPay matches transaction Net Amount", () => {
      const amountPay = getNum(payIntent, "AmountPay");
      const netAmount = getNum(transaction, "Net Amount");
      testResultsLogger.step("PayIntent AmountPay vs transaction Net Amount", {
        payIntentId: payIntent._id,
        amountPay,
        netAmount
      });
      expect(amountPay).toBeCloseTo(netAmount, 2);
    });

    it("validates PayIntent links back to the order", () => {
      const linkedOrder = payIntent["GP_Order"];
      testResultsLogger.step("PayIntent order link", {
        payIntentId: payIntent._id,
        linkedOrder,
        expectedOrder: REFUND_ORDER_ID
      });
      expect(linkedOrder).toBe(REFUND_ORDER_ID);
    });
  }
);
