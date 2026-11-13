const groups = {
  'to-pay': ['pending_payment', 'payment_rejected'],
  'in-progress': ['payment_verification', 'payment_confirmed', 'processing', 'ready_to_ship', 'shipped', 'in_transit'],
  completed: ['delivered'],
  cancelled: ['cancelled'],
};

export function matchesOrderFilter(order, filter) {
  return filter === 'all' || Boolean(groups[filter]?.includes(order.status));
}

export function paymentAction(order, now = Date.now()) {
  if (!['pending_payment', 'payment_rejected'].includes(order.status)) return 'none';
  if (order.status === 'pending_payment' && order.hold_expires_at && new Date(order.hold_expires_at).getTime() <= now) return 'expired';
  if (order.payment_scope !== 'products_only' && !order.shipping_confirmed) return 'awaiting-shipping';
  return 'upload';
}

export function canCancelOrder(order) {
  return order.status === 'pending_payment' && Array.isArray(order.payments) && order.payments.length === 0;
}
