require('ts-node/register');
const { BotCart } = require('../../src/messaging/core/cart');
const { checkoutPaymentSnapshot } = require('../../src/messaging/core/checkoutSnapshot');
const { createCheckoutIntentRequest, newCheckoutIntentId } = require('../../src/messaging/checkout/checkoutIdempotency');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function session() {
  const context = { restaurant_id: id(1), session_id: id(2), channel: 'whatsapp' };
  const cart = new BotCart(); cart.add({ productId: id(3), productName: 'Pizza', quantity: 2, unitPrice: '10.01', variantId: id(5), variantName: 'Grande', optionIds: [id(6), id(7)] });
  const phone = { phone: '5577999999999', source: 'senderPn' };
  const checkout = { step: 'ORDER_REVIEW', cart, customerId: id(4), whatsappPhone: { ...phone }, fulfillmentMode: 'PICKUP', paymentMethod: 'PIX',
    pickupConfirmed: true, pickupAddress: { restaurantId: id(1), name: 'Loja', street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'Cidade' } };
  checkout.paymentContext = checkoutPaymentSnapshot(checkout, id(1));
  return { context, sender: { channel: 'whatsapp', account_id: 'account', subject_id: 'opaque@lid' }, identityRevision: 0, transportIdentity: phone, checkout };
}
function request(intentId = newCheckoutIntentId()) { return createCheckoutIntentRequest(session(), intentId); }
module.exports = { id, session, request };
