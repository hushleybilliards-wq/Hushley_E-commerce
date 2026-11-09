import { isSupabaseConfigured, supabase } from '../lib/supabase.js';

let cartEntries;
try { cartEntries = new Map(JSON.parse(localStorage.getItem('hushley-cart') || '[]')); }
catch { localStorage.removeItem('hushley-cart'); cartEntries = new Map(); }
const items = [...cartEntries.values()];
const itemHost = document.querySelector('#checkout-items');
const gate = document.querySelector('#checkout-gate');
const form = document.querySelector('#checkout-form');
const status = document.querySelector('.form-status');
const currency = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const formatOptions = (options = {}) => Object.entries(options).map(([name, value]) => `${escapeHtml(name)}: ${escapeHtml(value)}`).join(' · ');
function showGate(message) { gate.hidden = false; gate.textContent = message; }
const connection = document.querySelector('#checkout-connection');
function updateConnection() {
  connection.hidden = navigator.onLine;
  connection.textContent = navigator.onLine ? '' : 'You are offline. Reconnect before placing your order; your cart is saved on this device.';
  connection.dataset.kind = 'error';
  if (form) form.querySelector('button[type="submit"]').disabled = !navigator.onLine;
}
window.addEventListener('offline', updateConnection);
window.addEventListener('online', () => {
  connection.hidden = false;
  connection.textContent = 'Connection restored. You can continue checkout.';
  connection.dataset.kind = 'success';
  form.querySelector('button[type="submit"]').disabled = false;
});
updateConnection();

const regionField = form.elements.shipping_region;
const courierField = form.elements.courier;
const shippingNote = document.querySelector('#shipping-note');
// Rates are displayed as guidance; parcel aggregation and destination classification
// must be confirmed by the shop before a charge can be set on the order.
const domesticSmallRates = { Luzon: 75, Visayas: 100, Mindanao: 100 };
function updateShipping() {
  const region = regionField.value;
  const previous = courierField.value;
  const international = region === 'Asia' || region === 'Outside Asia';
  const choices = !region ? [] : international ? [['philpost', 'PhilPost International']] : [ ['j&t', 'J&T Express'], ...(region === 'Luzon' ? [['lalamove', 'Lalamove']] : []) ];
  courierField.innerHTML = '<option value="">Select a courier</option>' + choices.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('');
  if (choices.some(([value]) => value === previous)) courierField.value = previous;
  if (!region) shippingNote.textContent = 'Choose a destination region to see shipping information. The shop confirms your shipping fee before you pay.';
  else if (!courierField.value) shippingNote.textContent = 'Choose a courier to see shipping information. The shop confirms your shipping fee before you pay.';
  else if (courierField.value === 'lalamove') shippingNote.textContent = 'Lalamove: ₱0 delivery fee through the website. Pay the rider directly on delivery. The shop must confirm shipping before payment.';
  else if (international) shippingNote.textContent = `PhilPost estimated rate: ${currency(region === 'Asia' ? 3100 : 4100)}. The shop will confirm the estimate before payment. Actual cost may differ: staff will email the official proof and privately arrange any refund or request payment of the balance outside the website.`;
  else shippingNote.textContent = `J&T rates for ${region}: small items ${currency(domesticSmallRates[region])}; billiard cues ${currency(300)}; ball sets ${currency(500)}. The shop will confirm the fee for your order before payment.`;
}
regionField.addEventListener('change', () => {
  const country = form.elements.country;
  if (['Asia', 'Outside Asia'].includes(regionField.value) && country.value.trim().toLowerCase() === 'philippines') country.value = '';
  updateShipping();
});
courierField.addEventListener('change', updateShipping);

itemHost.innerHTML = items.length ? items.map(({ product, quantity, selected_options, options }) => {
  const choices = selected_options || options || {};
  return `<div class="checkout-item"><span>${escapeHtml(product.name)}<small>QTY ${Number(quantity)}</small>${Object.keys(choices).length ? `<small class="checkout-options">${formatOptions(choices)}</small>` : ''}</span><strong>${product.price !== undefined ? currency(Number(product.price) * quantity) : 'TBC'}</strong></div>`;
}).join('') : '<p class="empty-orders">Your cart is empty.</p>';
const subtotal = items.reduce((sum, line) => sum + (Number(line.product.price) || 0) * line.quantity, 0);
document.querySelector('#checkout-subtotal').textContent = items.every(({ product }) => product.price !== undefined) ? currency(subtotal) : 'PRICE TO BE CONFIRMED';

if (!items.length) {
  showGate('Add gear to your cart before checkout.');
  document.querySelector('#signin-link').hidden = true;
} else if (!isSupabaseConfigured) {
  showGate('The client Supabase project is not connected yet. Checkout will be enabled after the project details are added.');
  document.querySelector('#signin-link').hidden = true;
} else {
  try {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) showGate('Your session may have expired. Sign in again to place this order.');
  else {
    document.querySelector('#signin-link').hidden = true;
    form.hidden = false;
    form.elements.customer_name.value = user.user_metadata?.full_name || '';
    form.elements.email.value = user.email || '';
  }
  } catch (error) {
    showGate(/permission|not authorized/i.test(error.message || '') ? 'Access was denied. Sign in again, then retry checkout.' : `We could not check your sign-in status. ${error.message || 'Please retry by refreshing the page.'}`);
    document.querySelector('#signin-link').hidden = false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = 'Placing your order…';
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.dataset.label = button.textContent;
  button.textContent = 'PLACING ORDER…';
  const slowTimer = setTimeout(() => { status.textContent = 'This is taking longer than usual. Keep this page open while we finish placing your order.'; status.dataset.kind = ''; }, 7000);
  const values = new FormData(form);
  try {
    const payload = {
      p_customer_name: String(values.get('customer_name')).trim(),
      p_email: String(values.get('email')).trim(),
      p_mobile: String(values.get('mobile')).trim(),
      p_address_line: String(values.get('address_line')).trim(),
      p_city: String(values.get('city')).trim(),
      p_province: String(values.get('province')).trim(),
      p_postal_code: String(values.get('postal_code')).trim(),
      p_country: String(values.get('country')).trim(),
      p_courier: String(values.get('courier')),
      p_payment_method: String(values.get('payment_method')),
      p_customer_note: String(values.get('customer_note') || '').trim() || null,
      p_shipping_region: String(values.get('shipping_region')),
      p_items: items.map(({ product, quantity, selected_options, options }) => ({ product_id: product.id, quantity, options: selected_options || options || {} })),
    };
    const { data: orderId, error } = await supabase.rpc('place_order', payload);
    if (error) throw error;
    localStorage.removeItem('hushley-cart');
    window.location.href = `/account.html?placed=${encodeURIComponent(orderId)}`;
  } catch (error) {
    const detail = error.message || 'We could not place your order.';
    status.textContent = /permission|row-level|not authorized/i.test(detail) ? 'Access was denied. Your session may have expired; sign in again and retry.' : /expired|jwt/i.test(detail) ? 'Your session expired. Sign in again and retry checkout.' : `${detail} You can review the details and retry.`;
    status.dataset.kind = 'error';
    button.disabled = !navigator.onLine;
  } finally {
    clearTimeout(slowTimer);
    button.textContent = button.dataset.label;
  }
});
