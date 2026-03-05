const { getThing, searchThings } = require("../bubbleClient");
const { calculateOrderItem } = require("../lib/orderItemCalculator");
const { getNum } = require("../lib/testUtils");
const {
  ORDER_ID,
  ORDER_ITEM_IDS,
  RUN_ORDER_ITEM_TESTS,
  TYPES
} = require("../testConfig");

let orderItems = [];
let results = [];

function getProductId(item) {
  const product = item["product"] ?? item.product_custom_product ?? item.Product;
  if (!product) return null;
  return typeof product === "string" ? product : product._id ?? product.unique_id;
}

beforeAll(async () => {
  if (!RUN_ORDER_ITEM_TESTS) return;
  if (!ORDER_ID && (!ORDER_ITEM_IDS || ORDER_ITEM_IDS.length === 0)) {
    throw new Error(
      "Set ORDER_ID or ORDER_ITEM_IDS in testConfig.js to run this suite"
    );
  }

  if (ORDER_ITEM_IDS && ORDER_ITEM_IDS.length > 0) {
    for (const id of ORDER_ITEM_IDS) {
      const item = await getThing(TYPES.ORDER_ITEM, id);
      orderItems.push(item);
    }
  } else {
    orderItems = await searchThings(TYPES.ORDER_ITEM, [
      { key: "order", constraint_type: "equals", value: ORDER_ID }
    ]);
  }

  results = [];
  for (const item of orderItems) {
    const productId = getProductId(item);
    const product =
      productId != null
        ? await getThing(TYPES.PRODUCT, productId)
        : null;
    const calc = calculateOrderItem({ orderItem: item, product: product || {} });
    results.push(calc);
  }
}, 120000);

(RUN_ORDER_ITEM_TESTS ? describe : describe.skip)("Order Item validation", () => {
  it("has order items to validate", () => {
    expect(orderItems.length).toBeGreaterThan(0);
  });

  it("validates Subtotal for all items", () => {
    orderItems.forEach((item, i) => {
      const actual = getNum(item, "subtotal", "subtotal_number");
      expect(actual).toBeCloseTo(results[i].subtotal, 2);
    });
  });

  it("validates Quantity for all items", () => {
    orderItems.forEach((item, i) => {
      const actual = getNum(item, "quantity", "quantity_number");
      expect(actual).toBeGreaterThanOrEqual(0);
    });
  });

  it("validates Product for all items", () => {
    orderItems.forEach((item, i) => {
      const actual =
        item["product"] ?? item.product_custom_product ?? item.Product;
      expect(actual).toBeDefined();
    });
  });

  it("validates Order for all items", () => {
    orderItems.forEach((item, i) => {
      const actual =
        item["order"] ?? item.order_custom_cart_items ?? item.Order;
      expect(actual).toBeDefined();
    });
  });
});
