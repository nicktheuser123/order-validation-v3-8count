/**
 * Pure calculation for Order Item validation.
 * Subtotal = Quantity × Product.Price (actual_price_number)
 */

const { getNum, roundTo2 } = require("./testUtils");

function calculateOrderItem({ orderItem, product }) {
  const quantity = getNum(orderItem, "quantity", "quantity_number");
  const productPrice = getNum(product, "price", "actual_price_number");
  const subtotal = roundTo2(quantity * productPrice);

  return {
    subtotal
  };
}

module.exports = { calculateOrderItem };
