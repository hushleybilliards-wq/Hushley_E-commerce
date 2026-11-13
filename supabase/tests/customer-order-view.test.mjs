import test from 'node:test';
import assert from 'node:assert/strict';
import { canCancelOrder, matchesOrderFilter, paymentAction } from '../../src/lib/customer-orders.js';

test('order filters distinguish payment, progress, delivery and cancellation', () => {
  for (const status of ['pending_payment', 'payment_rejected']) assert.equal(matchesOrderFilter({ status }, 'to-pay'), true);
  for (const status of ['payment_verification', 'payment_confirmed', 'processing', 'ready_to_ship', 'shipped', 'in_transit']) assert.equal(matchesOrderFilter({ status }, 'in-progress'), true);
  assert.equal(matchesOrderFilter({ status: 'delivered' }, 'completed'), true);
  assert.equal(matchesOrderFilter({ status: 'cancelled' }, 'cancelled'), true);
  assert.equal(matchesOrderFilter({ status: 'cancelled' }, 'to-pay'), false);
});

test('proof upload respects payment scope, shipping confirmation, and expired holds', () => {
  const unpaid = { status:'pending_payment', payment_scope:'products_only', hold_expires_at:'2026-11-14T12:00:00Z' };
  assert.equal(paymentAction(unpaid, Date.parse('2026-11-14T11:00:00Z')), 'upload');
  assert.equal(paymentAction(unpaid, Date.parse('2026-11-14T12:00:00Z')), 'expired');
  assert.equal(paymentAction({ ...unpaid, payment_scope:'order_total', shipping_confirmed:false }, Date.parse('2026-11-14T11:00:00Z')), 'awaiting-shipping');
  assert.equal(paymentAction({ ...unpaid, status:'payment_verification' }), 'none');
  assert.equal(paymentAction({ ...unpaid, status:'payment_rejected' }, Date.parse('2026-11-14T13:00:00Z')), 'upload');
});

test('cancellation appears only before any proof has been submitted', () => {
  assert.equal(canCancelOrder({ status:'pending_payment', payments:[] }), true);
  assert.equal(canCancelOrder({ status:'pending_payment', payments:[{ id:'proof' }] }), false);
  assert.equal(canCancelOrder({ status:'payment_rejected', payments:[] }), false);
  assert.equal(canCancelOrder({ status:'pending_payment' }), false);
});
