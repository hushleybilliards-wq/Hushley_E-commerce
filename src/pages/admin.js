import { notifyActivity } from '../lib/activity-island.js';
import { createStaffVerificationClient, isSupabaseConfigured, supabase } from '../lib/supabase.js';

const $ = (selector, root = document) => root.querySelector(selector);
const gate = $('#admin-gate');
const layout = $('#admin-layout');
const gateMessage = $('#gate-message');
const adminStatus = $('#admin-status');
let categories = [];
let ordersCache = [];
let ordersLoaded = false;
let productsCache = [];
let productsLoaded = false;
let productsLoadFailed = false;
let ordersLoadFailed = false;
let catalogCategory = '';
let profilesCache = [];
let profilesLoaded = false;
let selectedOrderId = null;
let overviewPreviewVersion = 0;
let currentAdminView = 'overview';
let authorized = false;
let isStaff = false;
let notificationUserId = null;
let notificationEvents = [];
let notificationRefreshing = false;
let adminAutoRefreshing = false;
let adminOrderRequest = 0;
let adminProductRequest = 0;
const backgroundFailures = new Set();
let notificationBaselineReady = false;
const activityReadFallback = {};
const currency = (amount) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(amount || 0));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const safeSlug = (value) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const orderStatusLabel = (status) => ({ pending_payment: 'To pay', payment_verification: 'Payment under review', payment_rejected: 'Payment needs attention', payment_confirmed: 'Preparing', processing: 'Preparing', ready_to_ship: 'Preparing', shipped: 'Shipped', in_transit: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' }[status] || String(status || '').replaceAll('_', ' '));
const shippingClasses = new Map([['small_items', 'Small items'], ['cue', 'Billiard cue'], ['ball_set', 'Billiard ball set']]);
async function uploadProductImage(image) {
  if (!image) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type)) throw new Error('Product image must be JPG, PNG, or WebP.');
  const path = `catalog/${crypto.randomUUID()}-${safeSlug(image.name)}`;
  const { error } = await supabase.storage.from('product-images').upload(path, image, { upsert: false });
  if (error) throw error;
  return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
}
let adminStatusTimer;
function say(message, kind = '') { clearTimeout(adminStatusTimer); adminStatus.textContent = message; adminStatus.dataset.kind = kind; if (message && kind !== 'error') adminStatusTimer = setTimeout(() => { adminStatus.textContent = ''; }, 6000); }
function parseProductConfiguration(optionsText, specificationsText, shippingClassValue) {
  let options; let specifications;
  try { options = JSON.parse(optionsText); }
  catch { throw new Error('Product options must be valid JSON.'); }
  if (!Array.isArray(options)) throw new Error('Product options must be a JSON array.');
  const optionNames = new Set();
  options = options.map((option, index) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) throw new Error(`Option ${index + 1} must be an object.`);
    const name = typeof option.name === 'string' ? option.name.trim() : '';
    if (!name) throw new Error(`Option ${index + 1} needs a name.`);
    if (optionNames.has(name)) throw new Error(`Option name “${name}” is repeated.`);
    optionNames.add(name);
    if (!Array.isArray(option.values) || !option.values.length || option.values.some((value) => typeof value !== 'string' || !value.trim())) {
      throw new Error(`“${name}” needs one or more non-empty text values.`);
    }
    const values = option.values.map((value) => value.trim());
    if (new Set(values).size !== values.length) throw new Error(`“${name}” has a repeated value.`);
    if (option.required !== undefined && typeof option.required !== 'boolean') throw new Error(`“${name}” required must be true or false.`);
    return { name, values, required: option.required ?? true };
  });
  try { specifications = JSON.parse(specificationsText); }
  catch { throw new Error('Specifications must be valid JSON.'); }
  if (!specifications || typeof specifications !== 'object' || Array.isArray(specifications)) {
    throw new Error('Specifications must be a JSON object, such as {"material":"Carbon fiber"}.');
  }
  const shippingClass = shippingClassValue || null;
  if (shippingClass && !shippingClasses.has(shippingClass)) throw new Error('Choose a valid shipping class or leave it unclassified.');
  return { options, specifications, shipping_class: shippingClass };
}
function failureMessage(error, area) {
  if (!navigator.onLine) return `${area} could not load while offline. Your changes are not confirmed; reconnect and retry.`;
  const message = error?.message || 'Unexpected error.';
  if (/permission|row-level|not authorized|admin/i.test(message)) return `Access denied while loading ${area}. Your administrator role may need a fresh sign-in.`;
  return `${area} could not load: ${message}. Retry when the connection is available.`;
}
function rowMessage(host, columns, message, retry = '') {
  host.innerHTML = `<tr><td colspan="${columns}" class="table-message">${escapeHtml(message)}${retry ? ` <button class="text-action" data-retry="${retry}">RETRY</button>` : ''}</td></tr>`;
}

if (!isSupabaseConfigured) {
  gateMessage.textContent = 'The client project is not connected. Add the Supabase URL and publishable key to .env.';
  $('#admin-config').hidden = false;
} else {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) gateMessage.textContent = 'Your session may have expired. Sign in again with your administrator account.';
  else if (!['admin', 'staff'].includes(user.app_metadata?.role)) gateMessage.textContent = 'Permission denied. This account has no administrator role. Ask the project owner to assign it, then sign in again.';
  else {
    isStaff = user.app_metadata?.role === 'staff';
    const staffAccess = isStaff ? await supabase.rpc('staff_current_access') : null;
    if (isStaff && (staffAccess.error || !staffAccess.data)) {
      gateMessage.textContent = 'Staff access is unavailable or disabled. Contact the shop owner.';
    } else {
    authorized = true;
    document.body.classList.toggle('staff-session', isStaff);
    notificationUserId = user.id;
    gate.hidden = true;
    layout.hidden = false;
    $('#admin-email').textContent = user.email;
    $('#today-date').textContent = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' });
    setConnection(navigator.onLine);
    await loadCategories();
    await Promise.all([loadMetrics(), loadOrders(), loadProducts(), loadInventory(), ...(isStaff ? [] : [loadProfiles()])]);
    }
  }
}

function setConnection(online, reconnected = false) {
  const indicator = $('#connection-state');
  if (!indicator) return;
  indicator.textContent = online ? (reconnected ? 'RECONNECTED' : 'ONLINE') : 'OFFLINE';
  indicator.dataset.state = online ? 'online' : 'offline';
  if (reconnected) say('Connection restored. The dashboard will update automatically.', 'success');
}
window.addEventListener('offline', () => setConnection(false));
window.addEventListener('online', () => setConnection(true, true));
if (supabase?.auth) supabase.auth.onAuthStateChange((event, session) => {
  if (authorized && (!session || event === 'SIGNED_OUT')) {
    authorized = false;
    layout.hidden = true;
    gate.hidden = false;
    gateMessage.textContent = 'Your administrator session expired. Sign in again to continue.';
  }
});

// Supabase caps each response. Fetch bounded pages so older records are included.
async function fetchAll(makeQuery) {
  const rows = []; const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await makeQuery().range(offset, offset + pageSize - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return { data: rows, error: null };
  }
}

function adminIsEditing() {
  if (document.querySelector('dialog[open]')) return true;
  const host = $('#orders-body');
  if (!host) return false;
  if (host.contains(document.activeElement)) return true;
  return [...host.querySelectorAll('input, select, textarea')].some((field) => {
    if (field.type === 'checkbox') return field.checked !== field.defaultChecked;
    if (field.tagName === 'SELECT') {
      const defaults = [...field.options].filter((option) => option.defaultSelected);
      return defaults.length ? !field.selectedOptions[0]?.defaultSelected : field.selectedIndex > 0;
    }
    return field.value !== field.defaultValue;
  });
}
function backgroundFailure(key) {
  if (!backgroundFailures.has(key)) say('Automatic updates are temporarily unavailable. Your existing data is still shown.', 'warning');
  backgroundFailures.add(key);
}
async function loadMetrics(options = {}) {
  const started = Date.now();
  if (isStaff) {
    const [orders, payments, stock] = await Promise.all([
      supabase.from('orders').select('id', { count: 'exact', head: true }).not('status', 'in', '(delivered,cancelled)'),
      supabase.from('payments').select('id,orders!inner(status)', { count: 'exact', head: true }).eq('status', 'pending').eq('orders.status', 'payment_verification'),
      fetchAll(() => supabase.from('products').select('id,stock_quantity,reserved_quantity,low_stock_threshold').eq('is_active', true).order('id')),
    ]);
    const error = orders.error || payments.error || stock.error;
    if (error) { if (options.background) backgroundFailure('metrics'); else say(failureMessage(error, 'Dashboard'), 'error'); return; }
    $('#metric-orders').textContent = orders.count ?? '0';
    $('#metric-payments').textContent = payments.count ?? '0';
    $('#metric-low-stock').textContent = stock.data.filter((row) => row.stock_quantity - row.reserved_quantity <= row.low_stock_threshold).length;
    return;
  }
  const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - 6);
  const queries = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true }).not('status', 'in', '(delivered,cancelled)'),
    supabase.from('payments').select('id,orders!inner(status)', { count: 'exact', head: true }).eq('status', 'pending').eq('orders.status', 'payment_verification'),
    fetchAll(() => supabase.from('products').select('id,stock_quantity,reserved_quantity,low_stock_threshold').eq('is_active', true).order('id')),
    fetchAll(() => supabase.from('payments').select('id,amount').eq('status', 'approved').order('id')),
    fetchAll(() => supabase.from('payments').select('id,amount,reviewed_at').eq('status', 'approved').gte('reviewed_at', weekStart.toISOString()).order('id')),
  ]);
  const error = queries.find((item) => item.error)?.error;
  if (error) { if (options.background) { backgroundFailure('metrics'); return; } say(failureMessage(error, 'Dashboard metrics'), 'error'); return; }
  backgroundFailures.delete('metrics');
  const [orders, payments, lowStock, sales, salesWeek] = queries;
  $('#metric-sales').textContent = currency((sales.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0));
  $('#metric-orders').textContent = orders.count ?? '0';
  $('#metric-payments').textContent = payments.count ?? '0';
  document.querySelector('.admin-notice').hidden = !payments.count;
  $('#metric-low-stock').textContent = lowStock.data.filter((row) => row.stock_quantity - row.reserved_quantity <= row.low_stock_threshold).length;
  renderSalesChart(salesWeek.data || []);
  if (Date.now() - started > 5000) say('Metrics loaded over a slow connection.', 'warning');
}

function renderSalesChart(payments) {
  const host = $('#sales-chart');
  const dataList = $('#sales-chart-data');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const points = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today); date.setDate(today.getDate() - (6 - index));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const amount = payments.reduce((sum, payment) => {
      const paidAt = new Date(payment.reviewed_at);
      const paidKey = `${paidAt.getFullYear()}-${String(paidAt.getMonth() + 1).padStart(2, '0')}-${String(paidAt.getDate()).padStart(2, '0')}`;
      return paidKey === key ? sum + Number(payment.amount || 0) : sum;
    }, 0);
    return { date, key, amount, label: date.toLocaleDateString('en-PH', { weekday: 'short' }) };
  });
  const max = Math.max(...points.map((point) => point.amount), 1);
  const width = 760; const height = 250; const top = 18; const bottom = 205;
  const barWidth = 46; const gap = (width - points.length * barWidth) / (points.length + 1);
  const bars = points.map((point, index) => {
    const barHeight = point.amount ? Math.max(5, (point.amount / max) * (bottom - top)) : 2;
    const x = gap + index * (barWidth + gap); const y = bottom - barHeight;
    const fullDate = point.date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    const compactAmount = point.amount ? new Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 1 }).format(point.amount) : '—';
    return `<g><title>${escapeHtml(fullDate)}: ${escapeHtml(currency(point.amount))} approved</title><rect class="sales-chart-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth}" height="${barHeight.toFixed(1)}" rx="5"/><text class="sales-chart-value" x="${(x + barWidth / 2).toFixed(1)}" y="${Math.max(12, y - 7).toFixed(1)}" text-anchor="middle">${compactAmount}</text><text class="sales-chart-day" x="${(x + barWidth / 2).toFixed(1)}" y="230" text-anchor="middle">${point.label}</text></g>`;
  }).join('');
  const total = points.reduce((sum, point) => sum + point.amount, 0);
  host.setAttribute('aria-label', `Approved payments for the last seven days total ${currency(total)}. ${points.map((point) => `${point.label}: ${currency(point.amount)}`).join('; ')}.`);
  host.innerHTML = `<svg class="sales-chart-svg" viewBox="0 0 ${width} ${height}" role="presentation" aria-hidden="true"><defs><linearGradient id="sales-bar-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4edea3"/><stop offset="1" stop-color="#10b981" stop-opacity=".48"/></linearGradient></defs><line class="sales-chart-axis" x1="0" y1="${bottom}" x2="${width}" y2="${bottom}"/>${bars}</svg>`;
  dataList.innerHTML = points.map((point) => `<li><span>${escapeHtml(point.date.toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' }))}</span><strong>${escapeHtml(currency(point.amount))}</strong></li>`).join('');
}

async function loadOrders(options = {}) {
  if (options.background && adminIsEditing()) return;
  const request = ++adminOrderRequest;
  const host = $('#orders-body');
  if (!ordersLoaded) rowMessage(host, 7, 'Loading recent orders…');
  const started = Date.now();
  let { data, error } = await fetchAll(() => supabase.from('orders').select('id,customer_id,order_number,customer_name,email,mobile,address_line,city,province,postal_code,country,courier,payment_method,customer_note,subtotal,total,shipping_fee,shipping_confirmed,shipping_region,shipping_quote_note,actual_shipping_fee,shipping_receipt_reference,shipping_customer_emailed_at,shipping_adjustment_note,shipping_adjustment_settled_at,shipping_adjustment_amount,payment_scope,separate_shipping_quote,separate_shipping_quote_note,separate_shipping_actual,separate_shipping_receipt,separate_shipping_contacted_at,separate_shipping_settlement_note,separate_shipping_settled_at,separate_shipping_adjustment,customer_cancel_reason,customer_cancelled_at,status,tracking_number,hold_expires_at,created_at,order_items(product_id,product_name,quantity,unit_price,selected_options),payments(id,status,amount,proof_path,created_at)').order('created_at', { ascending: false }).order('id', { ascending: false }));
  if (error && /column|schema cache/i.test(error.message)) {
    const fallback = await fetchAll(() => supabase.from('orders').select('id,customer_id,order_number,customer_name,email,mobile,address_line,city,province,postal_code,country,courier,payment_method,customer_note,subtotal,total,shipping_fee,shipping_confirmed,status,tracking_number,hold_expires_at,created_at,order_items(product_id,product_name,quantity,unit_price,selected_options),payments(id,status,amount,proof_path,created_at)').order('created_at', { ascending: false }).order('id', { ascending: false }));
    data = fallback.data; error = fallback.error;
  }
  if (request !== adminOrderRequest || (options.background && adminIsEditing())) return;
  if (error && options.background) { backgroundFailure('orders'); return; }
  if (error) { ordersLoaded = false; ordersLoadFailed = true; renderAttention(); renderOverviewSummary(); renderCustomers(); rowMessage(host, 7, failureMessage(error, 'Orders'), 'orders'); $('#payment-queue').innerHTML = `<p class="panel-message">${escapeHtml(failureMessage(error, 'Orders'))} <button data-retry="orders">Retry</button></p>`; $('#audit-detail').textContent = 'Order details are unavailable. Retry loading orders.'; say(failureMessage(error, 'Orders'), 'error'); return; }
  backgroundFailures.delete('orders');
  const unchanged = ordersLoaded && JSON.stringify(ordersCache) === JSON.stringify(data || []);
  ordersCache = data || []; ordersLoaded = true; ordersLoadFailed = false;
  if (options.background && unchanged) return;
  renderAttention(); renderOverviewSummary();
  if (!selectedOrderId || !ordersCache.some((order) => order.id === selectedOrderId)) selectedOrderId = ordersCache.find((order) => order.status === 'payment_verification' && order.payments?.some((payment) => payment.status === 'pending' && payment.proof_path))?.id || ordersCache[0]?.id || null;
  if (!unchanged) { renderDashboardPanels(); renderCustomers(); await renderOrders(); }
  if (Date.now() - started > 5000) say('Orders loaded over a slow connection.', 'warning');
}

function renderOverviewSummary() {
  const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  set('#summary-orders', ordersLoaded ? ordersCache.length : '—');
  set('#summary-payments', ordersLoaded ? ordersCache.filter((order) => order.status === 'payment_verification' && order.payments?.some((payment) => payment.status === 'pending' && payment.proof_path)).length : '—');
  set('#summary-shipping', ordersLoaded ? ordersCache.filter((order) => ['ready_to_ship', 'shipped', 'in_transit'].includes(order.status)).length : '—');
  set('#summary-products', productsLoaded ? productsCache.filter((product) => product.is_active).length : '—');
  set('#summary-customers', profilesLoaded ? profilesCache.length : '—');
}

function renderAttention() {
  const host = $('#attention-content'); if (!host) return;
  const pending = ordersLoaded ? ordersCache.map((order) => ({ order, payment: [...(order.payments || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] })).filter(({ order, payment }) => order.status === 'payment_verification' && payment?.status === 'pending' && payment.proof_path) : [];
  const low = productsLoaded ? productsCache.filter((product) => product.is_active && product.stock_quantity - product.reserved_quantity <= product.low_stock_threshold).sort((a, b) => (a.stock_quantity - a.reserved_quantity) - (b.stock_quantity - b.reserved_quantity)) : [];
  if (ordersLoaded && productsLoaded && !pending.length && !low.length) { host.innerHTML = '<p class="attention-empty"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span> Nothing needs attention.</p>'; return; }
  const reviews = ordersLoaded ? (pending.length ? `<ul>${pending.slice(0, 3).map(({ order }) => `<li><button type="button" data-select-order="${escapeHtml(order.id)}"><span><strong>${escapeHtml(order.order_number)}</strong><small>${escapeHtml(order.customer_name)} · Proof submitted</small></span><span aria-hidden="true">→</span></button></li>`).join('')}</ul>${pending.length > 3 ? '<button type="button" class="attention-more" data-attention-view="payments">View all payment reviews</button>' : ''}` : '<p class="attention-quiet">No payment proofs waiting for review.</p>') : `<p class="attention-quiet">${ordersLoadFailed ? 'Payment reviews unavailable. <button data-retry="orders">Retry</button>' : 'Loading payment reviews…'}</p>`;
  const stock = productsLoaded ? (low.length ? `<ul>${low.slice(0, 3).map((product) => `<li><button type="button" data-attention-product="${escapeHtml(product.id)}"><span><strong>${escapeHtml(product.name)}</strong><small>${product.stock_quantity - product.reserved_quantity} available</small></span><span aria-hidden="true">→</span></button></li>`).join('')}</ul>${low.length > 3 ? '<button type="button" class="attention-more" data-attention-view="products">View inventory &amp; catalog</button>' : ''}` : '<p class="attention-quiet">No low-stock products.</p>') : `<p class="attention-quiet">${productsLoadFailed ? 'Stock information unavailable. <button data-retry="products">Retry</button>' : 'Loading stock…'}</p>`;
  host.innerHTML = `<section class="attention-group attention-payments"><h3><span class="attention-label"><span class="material-symbols-outlined" aria-hidden="true">receipt_long</span>Payment review</span><span class="attention-count">${ordersLoaded ? pending.length : '—'}</span></h3>${reviews}</section><section class="attention-group attention-stock"><h3><span class="attention-label"><span class="material-symbols-outlined" aria-hidden="true">inventory_2</span>Low stock</span><span class="attention-count">${productsLoaded ? low.length : '—'}</span></h3>${stock}</section>`;
}

function renderDashboardPanels() {
  const queue = $('#payment-queue'); const fulfillment = $('#fulfillment-body'); const detail = $('#audit-detail');
  if (!queue || !fulfillment || !detail || !ordersLoaded) return;
  const query = ($('#dashboard-search')?.value || '').trim().toLowerCase();
  const filteredOrders = ordersCache.filter((order) => !query || [order.order_number, order.customer_name, order.email, order.status, order.courier].some((value) => String(value || '').toLowerCase().includes(query)));
  const overviewRows = filteredOrders.map((order) => ({ order, payment: [...(order.payments || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] })).filter(({ order, payment }) => currentAdminView !== 'payments' || (order.status === 'payment_verification' && payment?.status === 'pending' && payment.proof_path));
  queue.innerHTML = overviewRows.length ? overviewRows.map(({ order, payment }) => {
    const items = (order.order_items || []).map((item) => `${escapeHtml(item.product_name)} × ${item.quantity}`).join(', ');
    const orderKind = ({ pending_payment: 'pending', payment_verification: 'pending', payment_rejected: 'rejected', payment_confirmed: 'preparing', processing: 'preparing', ready_to_ship: 'preparing', shipped: 'shipped', in_transit: 'shipped', delivered: 'approved', cancelled: 'rejected' })[order.status] || 'unknown';
    const proofKind = !payment?.proof_path ? 'missing' : ({ pending: 'pending', approved: 'approved', rejected: 'rejected' })[payment.status] || 'unknown';
    const proofStatus = payment?.proof_path ? (payment.status === 'pending' ? 'Proof awaiting review' : `Proof ${escapeHtml(payment.status)}`) : 'No proof submitted';
    return `<article class="payment-queue-card overview-order-row"><div class="overview-order-summary"><strong>${escapeHtml(order.order_number)}</strong><span>${escapeHtml(order.customer_name)}</span><span>${items || 'No items recorded'}</span><div class="overview-statuses"><small class="overview-status status-${orderKind}">${escapeHtml(orderStatusLabel(order.status))}</small><small class="overview-status status-${proofKind}">${proofStatus}</small></div></div><strong class="overview-order-amount">${currency(payment?.amount ?? order.total)}</strong><button type="button" class="overview-view-button" data-select-order="${escapeHtml(order.id)}" aria-label="View order ${escapeHtml(order.order_number)}">VIEW</button></article>`;
  }).join('') : `<p class="panel-message">${query ? 'No orders match your search.' : currentAdminView === 'payments' ? 'No payment proofs are waiting for review.' : 'No orders have been placed yet.'}</p>`;
  const recent = filteredOrders.slice(0, 6);
  fulfillment.innerHTML = recent.length ? recent.map((order) => {
    const payment = [...(order.payments || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const items = (order.order_items || []).map((item) => `${escapeHtml(item.product_name)} × ${item.quantity}${Object.keys(item.selected_options || {}).length ? ` · ${escapeHtml(JSON.stringify(item.selected_options))}` : ''}`).join('<br>');
    return `<tr><td><button class="order-link" data-select-order="${escapeHtml(order.id)}">#${escapeHtml(order.order_number)}</button></td><td>${escapeHtml(order.customer_name)}</td><td>${items || '—'}</td><td>${escapeHtml(order.courier || 'To confirm')}</td><td><span class="status-pill">${escapeHtml(orderStatusLabel(order.status))}</span></td><td>${escapeHtml(payment?.status || 'Not submitted')}</td></tr>`;
  }).join('') : '<tr><td colspan="6">No orders have been placed yet.</td></tr>';
  const telemetry = $('#equipment-telemetry');
  if (telemetry) telemetry.innerHTML = productsCache.length ? productsCache.slice().sort((a,b) => (a.stock_quantity-a.reserved_quantity)-(b.stock_quantity-b.reserved_quantity)).slice(0,5).map((product) => { const available = Math.max(0, product.stock_quantity-product.reserved_quantity); const low = available <= Number(product.low_stock_threshold || 0); const pct = Math.min(100, Math.round((available / Math.max(product.stock_quantity,1))*100)); return `<article class="telemetry-item ${low ? 'is-low' : ''}"><div><strong>${escapeHtml(product.name)}</strong><b>${available} available</b></div><small>${escapeHtml(product.sku || 'Stock level')} · ${low ? 'LOW STOCK' : 'Available'}</small><span class="stock-meter"><i style="width:${pct}%"></i></span></article>`; }).join('') : '<p>No product inventory is available.</p>';
  if (!$('#overview-order-dialog')?.open) return;
  const order = ordersCache.find((row) => row.id === selectedOrderId);
  if (!order) { detail.textContent = 'Select an order with submitted payment proof to inspect it.'; return; }
  const payment = [...(order.payments || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const version = ++overviewPreviewVersion;
  const items = (order.order_items || []).map((item) => {
    const options = Object.entries(item.selected_options || {}).map(([key, value]) => `${key}: ${value}`).join(' · ');
    const product = productsCache.find((row) => row.id === item.product_id);
    const image = product?.image_urls?.[0];
    return `<li class="modal-order-item">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.product_name)}"/>` : '<span class="modal-order-no-image">No image</span>'}<div><strong>${escapeHtml(item.product_name)}</strong>${options ? `<small>${escapeHtml(options)}</small>` : ''}<small>${Number(item.quantity)} × ${currency(item.unit_price)} each</small></div><strong>${currency(Number(item.unit_price) * Number(item.quantity))}</strong></li>`;
  }).join('');
  const canReview = order.status === 'payment_verification' && payment?.status === 'pending' && payment.proof_path;
  detail.innerHTML = `<div class="overview-selected-heading"><div><span>SELECTED ORDER</span><strong>${escapeHtml(order.order_number)}</strong><small>${escapeHtml(order.customer_name)} · ${escapeHtml(orderStatusLabel(order.status))} · ${escapeHtml(new Date(order.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }))}</small></div><strong>${currency(payment?.amount ?? order.total)}</strong></div><section class="overview-items"><h3>Order items</h3><ul>${items || '<li>No items recorded.</li>'}</ul><div class="modal-order-totals"><span>Product subtotal <strong>${currency(order.subtotal)}</strong></span>${order.payment_scope === 'products_only' ? `<span>Shipping arranged separately <strong>${order.separate_shipping_quote == null ? 'Not set' : currency(order.separate_shipping_quote)}</strong></span>` : `<span>Shipping <strong>${currency(order.shipping_fee)}</strong></span>`}<span>Order total <strong>${currency(order.total)}</strong></span></div></section><section class="overview-contact"><h3>Customer &amp; delivery</h3><p>${escapeHtml(order.email || 'No email')} · ${escapeHtml(order.mobile || 'No phone')}</p><p>${escapeHtml([order.address_line, order.city, order.province, order.postal_code, order.country].filter(Boolean).join(', ') || 'No address recorded')}</p><p>Courier: ${escapeHtml(order.courier || 'To confirm')} · Zone: ${escapeHtml(order.shipping_region || 'Not recorded')} · Tracking: ${escapeHtml(order.tracking_number || 'Not recorded')}</p>${order.customer_note ? `<p>Customer note: ${escapeHtml(order.customer_note)}</p>` : ''}</section><section class="overview-proof"><div class="overview-proof-heading"><h3>Payment proof</h3><span class="status-pill">${escapeHtml(payment?.status || 'Not submitted')}</span></div><p>${escapeHtml(order.payment_method || 'Payment method not listed')}</p>${payment?.proof_path ? `<div class="overview-proof-image" id="overview-proof-image"><span>Loading payment proof…</span></div><button data-view-proof="${escapeHtml(order.id)}" class="proof-preview-button">OPEN FULL PROOF</button>` : '<p class="overview-no-proof">No payment proof submitted yet.</p>'}</section>${canReview ? `<p class="audit-reminder">Check your bank or e-wallet before approving.</p><div class="audit-actions"><button data-review="${escapeHtml(payment.id)}" data-approved="true">APPROVE PAYMENT</button><button data-review="${escapeHtml(payment.id)}" data-approved="false">REJECT PROOF</button></div>` : ''}`;
  if (payment?.proof_path) {
    const preview = $('#overview-proof-image');
    if (/\.pdf$/i.test(payment.proof_path)) preview.textContent = 'Older PDF proof — open it to review.';
    else supabase.storage.from('payment-proofs').createSignedUrl(payment.proof_path, 300).then(({ data, error }) => {
      if (version !== overviewPreviewVersion || selectedOrderId !== order.id || !preview.isConnected) return;
      if (error || !data?.signedUrl) { preview.textContent = 'Preview unavailable. Open the proof to retry.'; return; }
      const image = document.createElement('img'); image.alt = `Payment proof for order ${order.order_number}`;
      image.addEventListener('error', () => { if (preview.isConnected) preview.textContent = 'Preview unavailable. Open the proof to retry.'; });
      image.src = data.signedUrl; preview.replaceChildren(image);
    }).catch(() => { if (version === overviewPreviewVersion && preview.isConnected) preview.textContent = 'Preview unavailable. Open the proof to retry.'; });
  }

}

async function renderOrders() {
  const host = $('#orders-body');
  const query = ($('#order-search')?.value || '').trim().toLowerCase();
  const data = ordersCache.filter((order) => !query || [order.order_number, order.customer_name, order.email, order.status, order.courier].some((value) => String(value || '').toLowerCase().includes(query)));
  if (!ordersCache.length) { rowMessage(host, 7, 'No orders have been placed yet.'); return; }
  if (!data.length) { rowMessage(host, 7, 'No orders match your search. Clear the search or try another term.'); return; }
  host.innerHTML = await Promise.all(data.map(async (order) => {
    const payment = [...(order.payments || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const hasApprovedPayment = order.payments?.some((entry) => entry.status === 'approved');
    const itemDetails = (order.order_items || []).map((item) => `${escapeHtml(item.product_name)} × ${item.quantity}${Object.keys(item.selected_options || {}).length ? ` — ${escapeHtml(Object.entries(item.selected_options).map(([key, value]) => `${key}: ${value}`).join(', '))}` : ''}`).join('<br>');
    const proof = payment?.proof_path ? `<button class="proof-link" data-view-proof="${escapeHtml(order.id)}">VIEW PAYMENT PROOF</button>` : '';
    const review = payment?.status === 'pending' && order.status === 'payment_verification' ? `<div class="review-actions"><button data-review="${escapeHtml(payment.id)}" data-approved="true">APPROVE PAYMENT</button><button data-review="${escapeHtml(payment.id)}" data-approved="false">REJECT PROOF</button></div>` : '';
    const currentStatus = order.status === 'in_transit' ? 'shipped' : order.status;
    const terminalStatus = ['cancelled', 'delivered'].includes(order.status);
    const address = [order.address_line, order.city, order.province, order.postal_code, order.country].filter(Boolean).join(', ');
    const international = order.courier === 'philpost';
    const shippingSchemaAvailable = Object.hasOwn(order, 'actual_shipping_fee');
    const region = order.shipping_region || '';
    let shippingControls = `<div class="shipping-controls"><label>${international ? 'Estimated fee (PHP)' : 'Shipping fee (PHP)'}<input type="number" min="0" step="0.01" ${order.courier === 'lalamove' ? 'readonly' : ''} value="${order.courier === 'lalamove' ? 0 : Number(order.shipping_fee)}" data-shipping="${escapeHtml(order.id)}"/></label><button data-save-shipping="${escapeHtml(order.id)}">SAVE FEE</button></div>${international ? `<details class="actual-shipping"><summary>Record actual PhilPost cost and private settlement</summary>${shippingSchemaAvailable ? `<p>Keep the estimate unchanged. Enter the actual fee and private receipt reference; email and any refund or balance are handled outside this website.</p><label>Actual fee (PHP)<input type="number" min="0" step="0.01" value="${order.actual_shipping_fee ?? ''}" data-actual-fee="${escapeHtml(order.id)}"/></label><label>Private receipt reference<input type="text" maxlength="500" value="${escapeHtml(order.shipping_receipt_reference || '')}" data-receipt-reference="${escapeHtml(order.id)}"/></label><label>Customer email sent at<input type="datetime-local" value="${toLocalInput(order.shipping_customer_emailed_at)}" data-email-time="${escapeHtml(order.id)}"/></label><label>External settlement details<input type="text" maxlength="1000" value="${escapeHtml(order.shipping_adjustment_note || '')}" placeholder="Refund arranged or balance paid outside site" data-settlement-note="${escapeHtml(order.id)}"/></label><label>Settlement completed at<input type="datetime-local" value="${toLocalInput(order.shipping_adjustment_settled_at)}" data-settlement-time="${escapeHtml(order.id)}"/></label><small>${order.shipping_adjustment_amount == null ? 'Actual cost not recorded.' : `Adjustment: ${currency(order.shipping_adjustment_amount)} ${Number(order.shipping_adjustment_amount) < 0 ? '(excess shipping refund due)' : Number(order.shipping_adjustment_amount) > 0 ? '(external balance due)' : '(no adjustment)'}`}</small><button data-save-actual="${escapeHtml(order.id)}">SAVE ACTUAL COST / SETTLEMENT</button>` : '<p>Structured actual-cost controls are unavailable because the reviewed shipping migration is not applied to this database.</p>'}</details>` : ''}`;
    if (order.payment_scope === 'products_only') {
      shippingControls = `<div class="shipping-controls"><label>Shipping amount (PHP)<input type="number" min="0" step="0.01" ${order.courier === 'lalamove' ? 'readonly' : ''} value="${order.courier === 'lalamove' ? 0 : order.separate_shipping_quote ?? ''}" data-shipping="${escapeHtml(order.id)}"/></label><small>${order.courier === 'lalamove' ? 'Customer pays rider' : 'Paid separately'}</small>${international ? `<details class="actual-shipping"><summary>Actual PhilPost cost and customer contact</summary><label>Actual cost (PHP)<input type="number" min="0" step="0.01" value="${order.separate_shipping_actual ?? ''}" data-separate-actual="${escapeHtml(order.id)}"/></label><label>Receipt reference<input type="text" value="${escapeHtml(order.separate_shipping_receipt || '')}" data-separate-receipt="${escapeHtml(order.id)}"/></label><label>Customer contacted at<input type="datetime-local" value="${toLocalInput(order.separate_shipping_contacted_at)}" data-separate-contact="${escapeHtml(order.id)}"/></label><label>Settlement details<input type="text" value="${escapeHtml(order.separate_shipping_settlement_note || '')}" data-separate-note="${escapeHtml(order.id)}"/></label><label>Settlement completed at<input type="datetime-local" value="${toLocalInput(order.separate_shipping_settled_at)}" data-separate-settled="${escapeHtml(order.id)}"/></label><small>${order.separate_shipping_adjustment == null ? 'Actual cost not recorded.' : `Actual cost minus estimate: ${currency(order.separate_shipping_adjustment)}. Handle any refund or balance outside the website.`}</small></details>` : ''}<button data-save-shipping="${escapeHtml(order.id)}">Save fee</button></div>`;
    }
    if (order.payment_scope === 'products_only' && !hasApprovedPayment && order.courier !== 'lalamove') shippingControls = '<div class="shipping-controls"><small>Record shipping after the product payment is approved.</small></div>';
    if (order.courier === 'lalamove') shippingControls = `<div class="shipping-controls"><small>Customer pays the rider directly. No website delivery fee.</small>${order.payment_scope !== 'products_only' && !order.shipping_confirmed ? `<input type="hidden" value="0" data-shipping="${escapeHtml(order.id)}"/><button data-save-shipping="${escapeHtml(order.id)}">CONFIRM RIDER PAYMENT</button>` : ''}</div>`;
    const orderStatus = `<label>Order status<select class="order-status" data-order="${escapeHtml(order.id)}">${!['shipped','delivered','cancelled'].includes(currentStatus) ? `<option value="" selected disabled>${escapeHtml(orderStatusLabel(order.status))}</option>` : ''}${['shipped','delivered','cancelled'].map((value) => `<option value="${value}" ${value === currentStatus ? 'selected' : ''} ${(value !== currentStatus && (terminalStatus || order.status === 'payment_rejected' || (!hasApprovedPayment && ['shipped','delivered'].includes(value)))) ? 'disabled' : ''}>${orderStatusLabel(value)}</option>`).join('')}</select></label>`;
    const holdExpired = order.status === 'pending_payment' && order.hold_expires_at && new Date(order.hold_expires_at) <= new Date();
    const nextAction = order.status === 'cancelled' ? (order.customer_cancel_reason ? `Cancelled by customer: ${order.customer_cancel_reason}.` : 'This order is cancelled.') : holdExpired ? 'The payment hold expired. Contact the customer before they pay; cancel the unpaid order to release its stock.' : order.payment_scope === 'products_only' && payment?.status === 'approved' ? 'Product payment approved. Contact the customer about shipping and prepare the order.' : order.payment_scope === 'products_only' && payment?.status === 'pending' ? 'Open the proof and check your bank or e-wallet before approving.' : order.payment_scope === 'products_only' ? 'Waiting for the customer to upload product payment proof.' : !order.shipping_confirmed ? '1. Confirm the shipping fee so the customer can pay.' : payment?.status === 'pending' ? '2. Open the proof and check your bank or e-wallet before approving.' : payment?.status === 'approved' ? 'Payment approved. Prepare the order for delivery.' : payment?.status === 'rejected' ? 'Proof rejected. Waiting for the customer to submit another image.' : 'Waiting for the customer to upload payment proof.';
    return `<tr class="order-table-row"><td><strong>${escapeHtml(order.order_number)}</strong><small>${new Date(order.created_at).toLocaleDateString('en-PH')}</small><small>${itemDetails || '—'}</small></td><td><strong>${escapeHtml(order.customer_name)}</strong><small>${escapeHtml(order.mobile || '')}</small><small>${escapeHtml(address)}</small><small>${escapeHtml(order.email || '')}</small></td><td>${orderStatus}<small>${escapeHtml(nextAction)}</small></td><td><strong>${order.payment_scope === 'products_only' || order.shipping_confirmed ? currency(order.total) : currency(order.subtotal)}</strong><small>${escapeHtml(order.payment_method)} · ${escapeHtml(payment?.status || 'not submitted')}</small>${proof}${review}</td><td><small>${escapeHtml(order.courier || 'To confirm')} · ${escapeHtml(order.shipping_region || 'No zone recorded')}</small>${shippingControls}</td><td><label>Courier tracking<input type="text" value="${escapeHtml(order.tracking_number || '')}" placeholder="Courier tracking number" data-tracking="${escapeHtml(order.id)}"/></label><small data-tracking-status="${escapeHtml(order.id)}">Saves after editing</small></td></tr>`;
  })).then((rows) => rows.join(''));
}
function toLocalInput(value) { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }

async function loadProducts(options = {}) {
  if (options.background && adminIsEditing()) return;
  const request = ++adminProductRequest;
  const host = $('#products-body');
  if (!productsLoaded) rowMessage(host, 5, 'Loading products…');
  const { data, error } = await fetchAll(() => supabase.from('products').select('id,name,description,sku,category_id,price,stock_quantity,reserved_quantity,image_urls,is_active,low_stock_threshold,options,specifications,shipping_class').order('name').order('id'));
  if (request !== adminProductRequest || (options.background && adminIsEditing())) return;
  if (error && options.background) { backgroundFailure('products'); return; }
  if (error) { productsLoaded = false; productsLoadFailed = true; renderAttention(); renderOverviewSummary(); rowMessage(host, 5, failureMessage(error, 'Products'), 'products'); say(failureMessage(error, 'Products'), 'error'); return; }
  backgroundFailures.delete('products');
  const unchanged = productsLoaded && JSON.stringify(productsCache) === JSON.stringify(data || []);
  productsCache = data || []; productsLoaded = true; productsLoadFailed = false;
  if (options.background && unchanged) return;
  renderAttention(); renderOverviewSummary();
  renderDashboardPanels();
  if (!data.length) { $('#catalog-empty').hidden = true; rowMessage(host, 5, 'No products yet. Add the first product to start the catalog.'); return; }
  host.innerHTML = data.map((product) => `<tr class="product-card-row" data-catalog-category="${escapeHtml(product.category_id || '')}"><td colspan="5"><article class="manage-card"><header class="catalog-product-head">${product.image_urls?.[0] ? `<img class="catalog-product-image" src="${escapeHtml(product.image_urls[0])}" alt="${escapeHtml(product.name)}"/>` : '<div class="catalog-product-image catalog-no-image">No image</div>'}<div class="catalog-product-details"><div class="catalog-product-name"><strong>${escapeHtml(product.name)}</strong></div><div class="catalog-product-number catalog-price"><small>Price</small><strong>${currency(product.price)}</strong></div><div class="catalog-product-number catalog-stock"><small>Available stock</small><strong>${product.stock_quantity - product.reserved_quantity}</strong></div></div><div class="catalog-row-actions"><button type="button" class="edit-product" data-edit-product="${escapeHtml(product.id)}" aria-label="Edit ${escapeHtml(product.name)}" title="Edit product"><span class="material-symbols-outlined" aria-hidden="true">edit</span></button><button type="button" class="delete-product" data-delete-product="${escapeHtml(product.id)}" aria-label="Delete ${escapeHtml(product.name)}" title="Delete product"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button></div></header><div class="product-editor-source" hidden><div class="product-edit-grid"><label>Product name<input class="row-edit" value="${escapeHtml(product.name)}" data-product-name="${product.id}"/></label><label>Category<select class="row-select" data-product-category="${product.id}">${categories.map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === product.category_id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></label><label>Price (PHP)<input class="row-edit" type="number" min="0" step="0.01" value="${Number(product.price)}" data-product-price="${product.id}"/></label><label>Stock on hand<input type="number" min="${product.reserved_quantity}" value="${product.stock_quantity}" data-stock-value="${product.id}"/><button type="button" data-save-stock="${product.id}">Save stock</button><small>Cannot be below ${product.reserved_quantity} reserved.</small></label><label class="publish-edit"><input type="checkbox" data-product-published="${product.id}" ${product.is_active?'checked':''}/> Show in shop</label><label>Description<textarea class="row-edit" data-product-description="${product.id}" rows="3">${escapeHtml(product.description)}</textarea></label><label>SKU<input class="row-edit" value="${escapeHtml(product.sku || '')}" data-product-sku="${product.id}"/></label>${product.image_urls?.[0] ? `<img class="admin-product-image-preview" src="${escapeHtml(product.image_urls[0])}" alt="Current product photo"/>` : '<span>No product image uploaded yet.</span>'}<label>Replace product image<input class="row-edit" type="file" accept="image/jpeg,image/png,image/webp" data-product-image="${product.id}"/></label><label>Shipping size<select class="row-select" data-product-shipping-class="${product.id}"><option value="" ${!product.shipping_class ? 'selected' : ''}>Not set — review needed</option>${[...shippingClasses].map(([value, label]) => `<option value="${value}" ${product.shipping_class === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><details class="advanced-product"><summary>Advanced product options and specifications</summary><label>Options data<textarea class="row-edit product-json-edit" data-product-options="${product.id}" rows="6">${escapeHtml(JSON.stringify(product.options || [], null, 2))}</textarea></label><label>Specifications data<textarea class="row-edit product-json-edit" data-product-specifications="${product.id}" rows="5">${escapeHtml(JSON.stringify(product.specifications || {}, null, 2))}</textarea></label></details></div><button class="admin-action product-save" data-save-product="${product.id}">Save product details</button><small class="product-save-status" data-product-save-status="${product.id}" role="status" aria-live="polite"></small></div></article></td></tr>`).join('');
  applyCatalogFilter();
}
function applyCatalogFilter() {
  document.querySelectorAll('[data-catalog-category]').forEach((row) => { row.hidden = !!catalogCategory && row.dataset.catalogCategory !== catalogCategory; });
  document.querySelectorAll('[data-category-filter]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.categoryFilter === catalogCategory)));
  const rows = [...document.querySelectorAll('[data-catalog-category]')];
  $('#catalog-empty').hidden = !rows.length || rows.some((row) => !row.hidden);
}
async function loadCategories() {
  const host = $('#categories-body');
  if (!categories.length) rowMessage(host, 2, 'Loading categories…');
  const { data, error } = await supabase.from('categories').select('id,name,sort_order,is_active').order('sort_order').order('name');
  if (error) { rowMessage(host, 2, failureMessage(error, 'Categories'), 'categories'); say(failureMessage(error, 'Categories'), 'error'); return; }
  categories = data || [];
  if (catalogCategory && !categories.some((category) => category.id === catalogCategory)) catalogCategory = '';
  $('#catalog-filters').innerHTML = `<button type="button" data-category-filter="" aria-pressed="false">All products</button>` + categories.map((category) => `<button type="button" data-category-filter="${escapeHtml(category.id)}" aria-pressed="false">${escapeHtml(category.name)}</button>`).join('');
  applyCatalogFilter();
  $('#product-form [name="category_id"]').innerHTML = categories.map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}${category.is_active ? '' : ' (inactive)'}</option>`).join('');
  if (!categories.length) { rowMessage(host, 2, 'No categories yet. Add a category before creating a product.'); return; }
  host.innerHTML = categories.map((category) => `<tr><td><input class="row-edit" value="${escapeHtml(category.name)}" data-category-name="${escapeHtml(category.id)}" aria-label="Category name"/></td><td><label class="publish-edit"><input type="checkbox" data-category-active="${escapeHtml(category.id)}" ${category.is_active?'checked':''}/> ACTIVE</label><button class="admin-action product-save" data-save-category="${escapeHtml(category.id)}">SAVE</button></td></tr>`).join('');
}
async function loadInventory() {
  const host = $('#inventory-list');
  if (!host.dataset.loaded) host.textContent = 'Loading stock activity…';
  const { data, error } = await fetchAll(() => supabase.from('inventory_transactions').select('id,quantity_delta,reason,note,created_at,products(name)').order('created_at', { ascending: false }).order('id', { ascending: false }));
  if (error) { host.innerHTML = `<p class="panel-message">${escapeHtml(failureMessage(error, 'Inventory activity'))} <button class="text-action" data-retry="inventory">RETRY</button></p>`; return; }
  host.dataset.loaded = 'true';
  if (!data.length) { host.textContent = 'No inventory changes recorded yet.'; return; }
  host.innerHTML = data.map((row) => `<article><strong>${escapeHtml(row.products?.name || 'Product')}</strong><span>${row.quantity_delta > 0 ? '+' : ''}${row.quantity_delta} · ${escapeHtml(row.reason.replaceAll('_',' '))}</span><small>${new Date(row.created_at).toLocaleString('en-PH')}</small></article>`).join('');
}

async function loadProfiles(options = {}) {
  if (options.background && adminIsEditing()) return;
  const host = $('#customers-body');
  if (!profilesLoaded) rowMessage(host, 4, 'Loading customer profiles…');
  const { data, error } = await fetchAll(() => supabase.rpc('admin_customer_profiles').select('id,full_name,phone,created_at').order('id'));
  if (options.background && adminIsEditing()) return;
  if (error && options.background) { backgroundFailure('customers'); return; }
  if (error) { profilesLoaded = false; renderOverviewSummary(); rowMessage(host, 4, failureMessage(error, 'Customers'), 'customers'); return; }
  backgroundFailures.delete('customers');
  const unchanged = profilesLoaded && JSON.stringify(profilesCache) === JSON.stringify(data || []);
  profilesCache = data || []; profilesLoaded = true; if (!options.background || !unchanged) renderCustomers(); renderOverviewSummary();
}
function renderCustomers() {
  if (!profilesLoaded) return;
  const host = $('#customers-body');
  const search = ($('#customer-search').value || '').trim().toLowerCase();
  const customers = new Map(profilesCache.map((profile) => [profile.id, { profile, order: null, count: 0 }]));
  for (const order of ordersCache) {
    const customer = customers.get(order.customer_id);
    if (!customer) continue;
    if (!customer.order) customer.order = order;
    customer.count += 1;
  }
  const rows = [...customers.values()].filter(({ profile, order }) => [profile.full_name, profile.phone, order?.customer_name, order?.email, order?.mobile].some((value) => String(value || '').toLowerCase().includes(search)));
  host.innerHTML = rows.length ? rows.map(({ profile, order, count }) => `<tr><td>${escapeHtml(profile.full_name || order?.customer_name || 'Name not provided')}</td><td>${escapeHtml(order?.email || 'No order email')}<small>${escapeHtml(profile.phone || order?.mobile || 'No phone')}</small></td><td>${ordersLoaded ? count : 'Unavailable'}</td><td>${!ordersLoaded ? 'Orders unavailable' : order ? `${escapeHtml(order.order_number)}<small>${new Date(order.created_at).toLocaleDateString('en-PH')}</small>` : 'No orders yet'}</td></tr>`).join('') : '<tr><td colspan="4">No matching customer profiles.</td></tr>';
}
$('#customer-search').addEventListener('input', renderCustomers);
// Prefix spreadsheet formula starters so exported customer text cannot execute as a formula.
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function downloadCsv(filename, rows) {
  const blob = new Blob(['\ufeff', rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#export-orders').addEventListener('click', async (event) => {
  const button = event.currentTarget; button.disabled = true; say('Refreshing orders for export…');
  const { data, error } = await fetchAll(() => supabase.from('orders').select('id,order_number,customer_name,email,status,total,courier,tracking_number,created_at').order('created_at', { ascending: false }).order('id', { ascending: false }));
  button.disabled = false;
  if (error) return say(failureMessage(error, 'Order export'), 'error');
  downloadCsv('hushley-orders.csv', [['Order', 'Customer', 'Email', 'Status', 'Total PHP', 'Courier', 'Tracking', 'Created at'], ...data.map((row) => [row.order_number, row.customer_name, row.email, row.status, row.total, row.courier, row.tracking_number, row.created_at])]);
  say(`Exported ${data.length} orders.`, 'success');
});
$('#export-payments').addEventListener('click', async (event) => {
  const button = event.currentTarget; button.disabled = true; say('Refreshing approved payments for export…');
  const { data, error } = await fetchAll(() => supabase.from('payments').select('id,order_id,method,amount,reviewed_at,orders(order_number)').eq('status', 'approved').order('id'));
  button.disabled = false;
  if (error) return say(failureMessage(error, 'Payment export'), 'error');
  downloadCsv('hushley-approved-payments.csv', [['Payment ID', 'Order', 'Method', 'Amount PHP', 'Approved at'], ...data.map((row) => [row.id, row.orders?.order_number || row.order_id, row.method, row.amount, row.reviewed_at])]);
  say(`Exported ${data.length} approved payments.`, 'success');
});


$('#admin-sign-out').addEventListener('click', async () => { await supabase.auth.signOut(); window.location.href = '/account'; });
$('#reload-orders').addEventListener('click', loadOrders);
$('#reload-queue')?.addEventListener('click', loadOrders);
$('#order-search').addEventListener('input', renderOrders);
$('#dashboard-search')?.addEventListener('input', (event) => { $('#order-search').value = event.target.value; renderDashboardPanels(); renderOrders(); });
function updateGeneratedSku() {
  const name = $('#product-form [name="name"]').value;
  const input = $('#product-form [name="sku"]');
  const base = safeSlug(name).toUpperCase().slice(0, 70).replace(/-+$/, '');
  if (!base) { input.value = ''; return; }
  const used = new Set(productsCache.map((product) => String(product.sku || '').toUpperCase()));
  let candidate = base; let suffix = 2;
  while (used.has(candidate)) { candidate = `${base}-${suffix++}`; }
  input.value = candidate;
}
$('#product-form [name="name"]').addEventListener('input', updateGeneratedSku);
const productDialog = $('#product-dialog');
const editProductDialog = $('#edit-product-dialog');
const editProductContent = $('#edit-product-content');
let editProductSource = null;
$('#close-edit-product').addEventListener('click', () => editProductDialog.close());
editProductDialog.addEventListener('click', (event) => { if (event.target === editProductDialog) editProductDialog.close(); });
editProductDialog.addEventListener('close', () => { if (editProductSource?.isConnected) editProductSource.append(...editProductContent.childNodes); else editProductContent.replaceChildren(); editProductSource = null; });
$('#toggle-product-form').addEventListener('click', () => {
  if (!productDialog.open) { updateGeneratedSku(); productDialog.showModal(); $('#product-form [name="name"]').focus(); }
});
document.querySelectorAll('[data-close-product-dialog]').forEach((button) => button.addEventListener('click', () => productDialog.close()));
productDialog.addEventListener('click', (event) => { if (event.target === productDialog) productDialog.close(); });
const orderDetailsDialog = $('#overview-order-dialog');
$('#close-overview-order').addEventListener('click', () => orderDetailsDialog.close());
orderDetailsDialog.addEventListener('click', (event) => { if (event.target === orderDetailsDialog) orderDetailsDialog.close(); });
orderDetailsDialog.addEventListener('close', () => { overviewPreviewVersion++; $('#audit-detail').replaceChildren(); });
const proofDialog = $('#proof-dialog');
const proofImage = $('#proof-dialog-image');
const proofStatus = $('#proof-dialog-status');
const proofDownload = $('#proof-dialog-download');
let proofRequest = 0;
$('#close-proof-dialog').addEventListener('click', () => proofDialog.close());
proofDialog.addEventListener('click', (event) => { if (event.target === proofDialog) proofDialog.close(); });
proofDialog.addEventListener('close', () => {
  proofRequest++;
  proofImage.removeAttribute('src');
  proofImage.hidden = true;
  proofDownload.removeAttribute('href');
});
proofImage.addEventListener('error', () => {
  proofImage.hidden = true;
  proofStatus.textContent = 'This proof could not be displayed as an image.';
  proofStatus.hidden = false;
});
const categoryDialog = $('#category-dialog');
function openCategoryDialog(focusName = false) { if (!categoryDialog.open) categoryDialog.showModal(); if (focusName) $('#category-form [name="name"]').focus(); }
$('#toggle-category-form').addEventListener('click', () => openCategoryDialog(true));
$('#close-category-dialog').addEventListener('click', () => categoryDialog.close());
categoryDialog.addEventListener('click', (event) => { if (event.target === categoryDialog) categoryDialog.close(); });
document.addEventListener('click', async (event) => {
  const dashboardView = event.target.closest('[data-dashboard-view]');
  if (dashboardView) { const view = dashboardView.dataset.dashboardView; markActivityRead(view); showAdminView(view, true); window.scrollTo({ top: 0, behavior: 'smooth' }); if (['orders', 'payments', 'shipping'].includes(view)) loadOrders(); if (view === 'customers') loadProfiles(); return; }
  const selectedOrder = event.target.closest('[data-select-order]');
  const attentionProduct = event.target.closest('[data-attention-product]');
  if (attentionProduct) { const id = attentionProduct.dataset.attentionProduct; catalogCategory = ''; applyCatalogFilter(); showAdminView('products', true); const target = $(`[data-edit-product="${id}"]`); if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.focus({ preventScroll: true }); } else say('Product is unavailable. Refresh the catalog.', 'error'); return; }
  const attentionView = event.target.closest('[data-attention-view]');
  if (attentionView) { showAdminView(attentionView.dataset.attentionView, true); return; }
  if (selectedOrder) { selectedOrderId = selectedOrder.dataset.selectOrder; const dialog = $('#overview-order-dialog'); if (!dialog.open) dialog.showModal(); renderDashboardPanels(); return; }
  const viewProof = event.target.closest('[data-view-proof]');
  if (viewProof) {
    const order = ordersCache.find((row) => row.id === viewProof.dataset.viewProof);
    const payment = [...(order?.payments || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!payment?.proof_path) return say('No payment proof is available for this order.', 'error');
    const request = ++proofRequest;
    $('#proof-dialog-order').textContent = `Order ${order.order_number} · ${order.customer_name}`;
    proofImage.hidden = true; proofImage.removeAttribute('src');
    proofDownload.hidden = true; proofDownload.removeAttribute('href');
    proofStatus.hidden = false; proofStatus.textContent = 'Loading payment proof…';
    if (!proofDialog.open) proofDialog.showModal();
    const legacyPdf = /\.pdf$/i.test(payment.proof_path);
    try {
      const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(payment.proof_path, 300, legacyPdf ? { download: true } : {});
      if (request !== proofRequest || !proofDialog.open) return;
      if (error || !data?.signedUrl) throw error || new Error('Unable to create a private proof link.');
      if (legacyPdf) {
        proofStatus.textContent = 'This older proof is a PDF. Download it to review.';
        proofDownload.href = data.signedUrl; proofDownload.hidden = false;
      } else {
        proofImage.src = data.signedUrl; proofImage.hidden = false; proofStatus.hidden = true;
      }
    } catch (error) {
      if (request === proofRequest && proofDialog.open) proofStatus.textContent = failureMessage(error, 'Payment proof');
    }
    return;
  }
  const retry = event.target.closest('[data-retry]');
  if (retry) ({ metrics: loadMetrics, orders: loadOrders, products: loadProducts, categories: loadCategories, inventory: loadInventory, customers: loadProfiles }[retry.dataset.retry] || (() => {}))();
});

$('#category-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const status = $('.form-status', form); const button = $('button[type="submit"]', form) || $('button', form);
  const values = new FormData(form); const name = String(values.get('name')).trim(); const id = safeSlug(name);
  if (!id) { status.textContent = 'Enter a category name using letters or numbers.'; return; }
  button.disabled = true; status.textContent = 'Saving category…';
  const { error } = await supabase.from('categories').insert({ id, name, sort_order: 100 });
  button.disabled = false;
  if (error) { status.textContent = failureMessage(error, 'Category save'); return; }
  form.reset(); status.textContent = 'Category added.'; say('Category added.', 'success'); await loadCategories(); await loadProducts();
});
$('#add-product-option').addEventListener('click', () => {
  const name = $('#new-option-name').value.trim();
  const values = $('#new-option-values').value.split(',').map((value) => value.trim()).filter(Boolean);
  const status = $('#option-builder-status');
  if (!name || !values.length || new Set(values).size !== values.length) { status.textContent = 'Enter an option name and distinct choices.'; return; }
  try {
    const field = $('#product-form [name="options"]'); const options = JSON.parse(field.value);
    if (!Array.isArray(options) || options.some((option) => option.name === name)) throw new Error('Check the options list; each option needs a unique name.');
    options.push({ name, values, required: $('#new-option-required').checked }); field.value = JSON.stringify(options, null, 2);
    $('#new-option-name').value = ''; $('#new-option-values').value = ''; status.textContent = `${name} added to the option list.`;
  } catch (error) { status.textContent = error.message; }
});
$('#product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const status = $('.form-status', form); const button = $('button[type="submit"]', form);
  const values = new FormData(form); const name = String(values.get('name')).trim(); const slug = safeSlug(name); const price = Number(values.get('price')); const stock = Number(values.get('stock_quantity'));
  const description = String(values.get('description') || '').trim();
  const image = values.get('image');
  if (!name || !slug || !description || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0 || !image?.size) { status.textContent = 'Enter a name, description, valid price and stock, and upload a product image.'; return; }
  let productConfig;
  try { productConfig = parseProductConfiguration(String(values.get('options') || '[]'), String(values.get('specifications') || '{}'), String(values.get('shipping_class') || '')); }
  catch (error) { status.textContent = error.message; form.elements[error.message.includes('Specifications') ? 'specifications' : 'options'].focus(); return; }
  button.disabled = true; status.textContent = 'Saving product…';
  try {
    const imageUrl = await uploadProductImage(image);
    const { data: product, error } = await supabase.from('products').insert({ category_id: values.get('category_id'), slug, name, description, sku: String(values.get('sku') || '').trim() || null, price, stock_quantity: 0, image_urls: [imageUrl], is_active: values.get('is_active') === 'on', ...productConfig }).select('id').single();
    if (error) throw error;
    if (stock > 0) { const { error: stockError } = await supabase.rpc('admin_set_product_stock', { p_product_id: product.id, p_quantity: stock, p_note: 'Opening stock' }); if (stockError) throw stockError; }
    form.reset(); productDialog.close(); say('Product saved.', 'success'); await Promise.all([loadProducts(), loadMetrics(), loadInventory()]);
  } catch (error) { status.textContent = failureMessage(error, 'Product save'); }
  finally { button.disabled = false; }
});

$('#orders-body').addEventListener('change', async (event) => {
  if (event.target.matches('[data-tracking]')) {
    const input = event.target; const id = input.dataset.tracking; const message = $(`[data-tracking-status="${id}"]`);
    input.disabled = true; message.textContent = 'Saving…';
    const { data, error } = await supabase.from('orders').update({ tracking_number: input.value.trim() || null }).eq('id', id).select('id').maybeSingle();
    input.disabled = false;
    if (error || !data) { message.textContent = 'Not saved. Try again.'; say(failureMessage(error || new Error('No order updated'), 'Tracking'), 'error'); }
    else { input.defaultValue = input.value; message.textContent = 'Saved'; const order = ordersCache.find((item) => item.id === id); if (order) order.tracking_number = input.value.trim() || null; }
    return;
  }
  const orderId = event.target.dataset.order; if (!orderId) return;
  const { error } = await supabase.from('orders').update({ status: event.target.value }).eq('id', orderId);
  if (error) { say(failureMessage(error, 'Order status update'), 'error'); await loadOrders(); } else { say('Order status updated.', 'success'); await Promise.all([loadOrders(), loadMetrics()]); }
});
document.addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-edit-product]');
  if (editButton) {
    const product = productsCache.find((row) => row.id === editButton.dataset.editProduct);
    const source = editButton.closest('.manage-card')?.querySelector('.product-editor-source');
    if (!product || !source) return say('Product not found. Refresh the catalog.', 'error');
    editProductSource = source;
    editProductContent.append(...source.childNodes);
    $('#edit-product-title').textContent = `Edit ${product.name}`;
    editProductDialog.showModal();
    editProductContent.querySelector('input')?.focus();
    return;
  }
  const filter = event.target.closest('[data-category-filter]');
  if (filter) { catalogCategory = filter.dataset.categoryFilter; applyCatalogFilter(); return; }
  const deleteProduct = event.target.closest('[data-delete-product]');
  if (deleteProduct) {
    const product = productsCache.find((row) => row.id === deleteProduct.dataset.deleteProduct);
    if (!product) return say('Product not found. Refresh the catalog.', 'error');
    if (product.reserved_quantity > 0) return say('This product has reserved stock. Complete or cancel its orders before deleting it.', 'error');
    if (!window.confirm(`Delete ${product.name}? This cannot be undone. Products with inventory history cannot be deleted; you can unpublish them instead.`)) return;
    deleteProduct.disabled = true; deleteProduct.textContent = 'Deleting…';
    const { data, error } = await supabase.from('products').delete().eq('id', product.id).eq('reserved_quantity', 0).select('id');
    if (error) { deleteProduct.disabled = false; deleteProduct.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">delete</span>'; return say(error.code === '23503' ? 'This product has inventory history and cannot be deleted. Unpublish it instead.' : failureMessage(error, 'Product deletion'), 'error'); }
    if (!data?.length) { deleteProduct.disabled = false; deleteProduct.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">delete</span>'; return say('Product was not deleted. Refresh and check your access and reserved stock.', 'error'); }
    say('Product deleted.', 'success'); await Promise.all([loadProducts(), loadMetrics(), loadInventory()]); return;
  }
  const review = event.target.closest('[data-review]');
  if (review) {
    review.disabled = true; review.textContent = 'REVIEWING…'; say('Checking payment proof review…');
    const { error } = await supabase.rpc('admin_review_payment', { p_payment_id: review.dataset.review, p_approved: review.dataset.approved === 'true' });
    if (error) say(failureMessage(error, 'Manual payment review'), 'error'); else { if (orderDetailsDialog.open) orderDetailsDialog.close(); selectedOrderId = null; say(review.dataset.approved === 'true' ? 'Payment manually approved and inventory updated.' : 'Payment proof rejected and stock hold released.', 'success'); }
    await Promise.all([loadOrders(), loadProducts(), loadMetrics(), loadInventory()]); return;
  }
  const shippingSave = event.target.closest('[data-save-shipping]');
  if (shippingSave) {
    const separateOrder = ordersCache.find((row) => row.id === shippingSave.dataset.saveShipping);
    if (separateOrder?.payment_scope === 'products_only') {
      const id = separateOrder.id; const input = $(`[data-shipping="${id}"]`); const note = separateOrder.separate_shipping_quote_note || 'Shipping fee confirmed by staff';
      if (!input.value.trim() || !Number.isFinite(Number(input.value)) || Number(input.value) < 0) return say('Enter a valid shipping amount.', 'error');
      const actualInput = $(`[data-separate-actual="${id}"]`); const actual = actualInput?.value.trim() ? Number(actualInput.value) : null;
      if (actual !== null && (!Number.isFinite(actual) || actual < 0)) return say('Enter a valid actual shipping cost.', 'error');
      const dateValue = (selector) => { const value = $(selector)?.value; return value ? new Date(value).toISOString() : null; };
      shippingSave.disabled = true;
      const { error } = await supabase.rpc('admin_record_separate_shipping', { p_order_id: id, p_quote: Number(input.value), p_note: note, p_actual: actual, p_receipt: $(`[data-separate-receipt="${id}"]`)?.value.trim() || null, p_contacted_at: dateValue(`[data-separate-contact="${id}"]`), p_settlement_note: $(`[data-separate-note="${id}"]`)?.value.trim() || null, p_settled_at: dateValue(`[data-separate-settled="${id}"]`) });
      shippingSave.disabled = false;
      if (error) say(failureMessage(error, 'Shipping details'), 'error'); else { say('Shipping details saved. Contact and payment are handled separately.', 'success'); await loadOrders(); }
      return;
    }
    const orderId = shippingSave.dataset.saveShipping; const input = $(`[data-shipping="${orderId}"]`); const region = separateOrder?.shipping_region; const quoteNote = separateOrder?.shipping_quote_note || 'Shipping fee confirmed by staff'; const fee = Number(input.value);
    if (!region) return say('This older order has no saved shipping region. Contact the customer before confirming shipping.', 'error');
    if (!input.value.trim() || !Number.isFinite(fee) || fee < 0) return say('Enter a valid shipping amount.', 'error');
    shippingSave.disabled = true; shippingSave.textContent = 'SAVING…';
    const { error } = await supabase.rpc('admin_confirm_order_shipping', { p_order_id: orderId, p_region: region, p_fee: fee, p_quote_note: quoteNote || null });
    shippingSave.disabled = false; shippingSave.textContent = 'CONFIRM SHIPPING';
    if (error) say(/admin_confirm_order_shipping|function.*not found|schema cache/i.test(error.message) ? 'Shipping confirmation is unavailable right now. Refresh and try again.' : failureMessage(error, 'Shipping confirmation'), 'error');
    else { say('Shipping quote confirmed. The order total follows the stored quote.', 'success'); await loadOrders(); } return;
  }
  const actualSave = event.target.closest('[data-save-actual]');
  if (actualSave) {
    const orderId = actualSave.dataset.saveActual; const feeInput = $(`[data-actual-fee="${orderId}"]`); const fee = Number(feeInput.value); const receipt = $(`[data-receipt-reference="${orderId}"]`).value.trim(); const emailValue = $(`[data-email-time="${orderId}"]`).value; const settlementNote = $(`[data-settlement-note="${orderId}"]`).value.trim(); const settledValue = $(`[data-settlement-time="${orderId}"]`).value;
    if (!feeInput.value.trim() || !Number.isFinite(fee) || fee < 0 || !receipt) return say('Enter a valid actual fee and private receipt reference.', 'error');
    const order = ordersCache.find((row) => row.id === orderId);
    const emailAt = emailValue ? new Date(emailValue).toISOString() : null; const settledAt = settledValue ? new Date(settledValue).toISOString() : null;
    if (settledAt && (!receipt || !emailAt || !settlementNote)) return say('Settlement requires a private receipt reference, customer email timestamp, and settlement details.', 'error');
    actualSave.disabled = true; actualSave.textContent = 'SAVING…';
    const { error } = await supabase.rpc('admin_record_shipping_actual', { p_order_id: orderId, p_actual_fee: fee, p_receipt_reference: receipt || null, p_customer_emailed_at: emailAt, p_note: settlementNote || null, p_settled_at: settledAt });
    actualSave.disabled = false; actualSave.textContent = 'SAVE ACTUAL COST / SETTLEMENT';
    if (error) say(/admin_record_shipping_actual|function.*not found|schema cache/i.test(error.message) ? 'Actual-cost recording is unavailable. Refresh and verify the Supabase connection; no change was saved.' : failureMessage(error, 'Actual shipping record'), 'error');
    else { const adjust = Number(fee) - Number(order?.estimated_shipping_fee ?? order?.shipping_fee ?? 0); say(`Actual shipping cost saved. ${adjust < 0 ? `Excess shipping refund due: ${currency(Math.abs(adjust))}.` : adjust > 0 ? `External balance due: ${currency(adjust)}.` : 'No shipping adjustment.'} Handle any email/refund/balance outside this website.`, 'success'); await loadOrders(); } return;
  }
  const stockSave = event.target.closest('[data-save-stock]');
  if (stockSave) {
    const productId = stockSave.dataset.saveStock; const input = $(`[data-stock-value="${productId}"]`); const nextStock = Number(input.value);
    if (!Number.isInteger(nextStock) || nextStock < Number(input.min)) return say('Stock must be a whole number and cannot be below reserved stock.', 'error');
    stockSave.disabled = true; stockSave.textContent = 'SAVING…'; const { error } = await supabase.rpc('admin_set_product_stock', { p_product_id: productId, p_quantity: nextStock, p_note: 'Admin dashboard adjustment' }); stockSave.disabled = false; stockSave.textContent = 'SAVE STOCK';
    if (error) return say(failureMessage(error, 'Inventory update'), 'error'); say('Inventory updated.', 'success'); if (editProductDialog.open) editProductDialog.close(); await Promise.all([loadProducts(), loadMetrics(), loadInventory()]); return;
  }
  const productSave = event.target.closest('[data-save-product]');
  if (productSave) {
    const id = productSave.dataset.saveProduct; const rowStatus = $(`[data-product-save-status="${id}"]`); const setRowStatus = (message, kind = '') => { rowStatus.textContent = message; rowStatus.dataset.kind = kind; };
    const name = $(`[data-product-name="${id}"]`).value.trim(); const sku = $(`[data-product-sku="${id}"]`).value.trim(); const description = $(`[data-product-description="${id}"]`).value.trim(); const categoryId = $(`[data-product-category="${id}"]`).value; const priceInput = $(`[data-product-price="${id}"]`); const price = Number(priceInput.value); const isActive = $(`[data-product-published="${id}"]`).checked; const existingProduct = productsCache.find((product) => product.id === id); const imageInput = $(`[data-product-image="${id}"]`); const replacementImage = imageInput.files?.[0];
    if (!name || !safeSlug(name) || !description || !priceInput.value.trim() || !Number.isFinite(price) || price < 0) { setRowStatus('Add a name, description, and valid price before saving.', 'error'); return; }
    if (isActive && !replacementImage && !existingProduct?.image_urls?.some((url) => typeof url === 'string' && url.trim())) { setRowStatus('Add a product photo before publishing.', 'error'); return; }
    let productConfig;
    try { productConfig = parseProductConfiguration($(`[data-product-options="${id}"]`).value, $(`[data-product-specifications="${id}"]`).value, $(`[data-product-shipping-class="${id}"]`).value); }
    catch (error) { setRowStatus(error.message, 'error'); $(`[data-product-options="${id}"]`).focus(); return; }
    productSave.disabled = true; productSave.textContent = 'SAVING…'; setRowStatus('Saving changes…');
    try {
      let imageUrls = existingProduct?.image_urls || [];
      if (replacementImage) imageUrls = [await uploadProductImage(replacementImage), ...imageUrls.slice(1)];
      const { data: updatedProduct, error } = await supabase.from('products').update({ name, slug: safeSlug(name), sku: sku || null, description, category_id: categoryId, price, image_urls: imageUrls, is_active: isActive, ...productConfig }).eq('id', id).select('id').maybeSingle();
      if (error) throw error;
      if (!updatedProduct) throw new Error('No product was updated. Refresh your admin session and try again.');
      productsCache = productsCache.map((product) => product.id === id ? { ...product, name, slug: safeSlug(name), sku: sku || null, description, category_id: categoryId, price, image_urls: imageUrls, is_active: isActive, ...productConfig } : product);
      say(isActive ? 'Product saved and published.' : 'Product saved as draft.', 'success');
      if (editProductDialog.open) editProductDialog.close();
      await Promise.all([loadProducts(), loadMetrics()]);
    } catch (error) { setRowStatus(failureMessage(error, 'Product update'), 'error'); }
    finally { productSave.disabled = false; productSave.textContent = 'SAVE PRODUCT'; }
    return;
  }
  const categorySave = event.target.closest('[data-save-category]');
  if (categorySave) {
    const id = categorySave.dataset.saveCategory; const name = $(`[data-category-name="${id}"]`).value.trim(); const isActive = $(`[data-category-active="${id}"]`).checked;
    if (!name) return say('Enter a category name.', 'error');
    categorySave.disabled = true; const { error } = await supabase.from('categories').update({ name, is_active: isActive }).eq('id', id); categorySave.disabled = false;
    if (error) say(failureMessage(error, 'Category update'), 'error'); else { say('Category updated.', 'success'); await loadCategories(); await loadProducts(); }
  }
});
const gcashForm = $('#gcash-settings-form');
let gcashSettingsLoaded = false;
async function loadGcashSettings() {
  const message = $('.form-status', gcashForm);
  const button = $('button[type="submit"]', gcashForm);
  button.disabled = true;
  const { data, error } = await supabase.from('gcash_payment_details').select('account_name,account_number').eq('id', true).maybeSingle();
  if (error || !data) { gcashSettingsLoaded = false; message.textContent = 'GCash settings are unavailable. Apply the reviewed database migration and refresh, or contact the site maintainer.'; return; }
  gcashForm.elements.account_name.value = data.account_name;
  gcashForm.elements.account_number.value = data.account_number;
  gcashSettingsLoaded = true;
  message.textContent = data.account_name ? 'Current details are visible to signed-in customers.' : 'No GCash details saved yet. Customers are asked to contact the shop.';
  button.disabled = false;
}
gcashForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!gcashSettingsLoaded) return;
  const message = $('.form-status', gcashForm);
  const accountName = gcashForm.elements.account_name.value.trim();
  const accountNumber = gcashForm.elements.account_number.value.trim();
  if (!accountName || !accountNumber) { message.textContent = 'Enter both the account name and GCash number.'; return; }
  const button = $('button[type="submit"]', gcashForm); button.disabled = true;
  const { data, error } = await supabase.from('gcash_payment_details').update({ account_name: accountName, account_number: accountNumber }).eq('id', true).select('id').maybeSingle();
  button.disabled = false;
  message.textContent = error || !data ? 'Could not save GCash details. Check your access and try again.' : 'GCash details saved. Check them carefully before customers pay.';
});
const adminTabs = [...document.querySelectorAll('.admin-sidebar nav a[href^="#"]')];
let staffActivityRows = [];
let staffAccountRows = null;
function renderStaffActivity() {
  const host = $('#staff-activity');
  const name = $('#staff-activity-filter').value.trim().toLowerCase();
  const date = $('#staff-activity-date').value;
  const type = $('#staff-activity-type').value;
  const dayOf = (row) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(row.created_at));
  const rows = staffActivityRows.filter((row) => (!name || `${row.actor_name} ${row.action} ${row.subject}`.toLowerCase().includes(name)) && (!date || dayOf(row) === date) && (!type || row.action.startsWith(type)));
  const groups = new Map();
  for (const row of rows) {
    const day = dayOf(row);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(row);
  }
  host.innerHTML = groups.size ? [...groups].map(([day, entries], index) => `<details class="staff-day" ${index === 0 ? 'open' : ''}><summary>${escapeHtml(day)} <small>${entries.length} activities</small></summary><ol>${entries.map((row) => `<li><time>${escapeHtml(new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(row.created_at)))}</time><div><strong>${escapeHtml(row.actor_name)}</strong> ${escapeHtml(row.action)}<small>${escapeHtml(row.subject)}${row.detail ? ` · ${escapeHtml(row.detail)}` : ''}</small></div></li>`).join('')}</ol></details>`).join('') : '<p>No matching staff activity.</p>';
}
async function loadStaffSection(options = {}) {
  if (!authorized || isStaff) return;
  const [accounts, activity] = await Promise.all([supabase.rpc('owner_staff_accounts'), fetchAll(() => supabase.rpc('owner_staff_activity').order('created_at', { ascending: false }).order('id', { ascending: false }))]);
  const list = $('#staff-list');
  if (accounts.error) { staffAccountRows = null; list.innerHTML = '<p>Staff accounts are unavailable. Check the database setup.</p>'; }
  else if (options.force || (!list.contains(document.activeElement) && JSON.stringify(staffAccountRows) !== JSON.stringify(accounts.data))) {
    staffAccountRows = accounts.data;
    list.innerHTML = accounts.data.length ? accounts.data.map((row) => `<div class="staff-account-row"><div class="staff-account-details"><strong>${escapeHtml(row.display_name)}</strong><small>${escapeHtml(row.email)} · ${!row.active ? 'Disabled' : row.email_verified ? 'Active' : 'Email verification pending'}</small>${row.active && !row.email_verified ? `<form class="staff-code-form" data-staff-email="${escapeHtml(row.email)}"><label>Code sent to staff email <input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" minlength="6" maxlength="8" required /></label><button type="submit" class="admin-action">Verify email</button><button type="button" class="admin-action" data-resend-staff-code>Resend code</button><span class="staff-code-status" role="status" aria-live="polite"></span></form>` : ''}</div><button type="button" class="admin-action" data-staff-id="${escapeHtml(row.user_id)}" data-staff-active="${row.active ? 'false' : 'true'}">${row.active ? 'Disable' : 'Enable'}</button></div>`).join('') : '<p>No staff accounts yet.</p>';
  }
  if (activity.error) { delete $('#staff-activity').dataset.loaded; $('#staff-activity').innerHTML = '<p>Activity is unavailable. Check the database setup.</p>'; }
  else if (JSON.stringify(staffActivityRows) !== JSON.stringify(activity.data) || !$('#staff-activity').dataset.loaded) {
    staffActivityRows = activity.data; $('#staff-activity').dataset.loaded = 'true'; renderStaffActivity();
  }
}
$('#open-staff-form').addEventListener('click', () => { $('#staff-form').hidden = false; $('#staff-form input').focus(); });
$('#refresh-staff').addEventListener('click', loadStaffSection);
function hideStaffPassword() {
  $('#staff-password').type = 'password';
  const toggle = $('#toggle-staff-password');
  toggle.setAttribute('aria-label', 'Show password'); toggle.setAttribute('aria-pressed', 'false');
  $('.material-symbols-outlined', toggle).textContent = 'visibility';
}
$('#toggle-staff-password').addEventListener('click', (event) => {
  const button = event.currentTarget; const input = $('#staff-password');
  const visible = input.type === 'password'; input.type = visible ? 'text' : 'password';
  button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  button.setAttribute('aria-pressed', String(visible));
  $('.material-symbols-outlined', button).textContent = visible ? 'visibility_off' : 'visibility';
});
$('#cancel-staff-form').addEventListener('click', () => { $('#staff-form').reset(); hideStaffPassword(); $('#staff-form').hidden = true; });
$('#staff-activity-filter').addEventListener('input', renderStaffActivity);
$('#staff-activity-date').addEventListener('change', renderStaffActivity);
$('#staff-activity-type').addEventListener('change', renderStaffActivity);
$('#staff-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const button = $('button[type="submit"]', form); const feedback = $('#staff-feedback');
  button.disabled = true; feedback.textContent = 'Creating staff account…';
  try {
    const { data, error } = await supabase.functions.invoke('create-staff', { body: { name: form.elements.name.value.trim(), email: form.elements.email.value.trim(), password: form.elements.password.value } });
    if (error) { let message = 'Could not create the staff account. Check the details and try again.'; try { message = (await error.context?.json())?.error || message; } catch {} throw new Error(message); }
    form.reset(); hideStaffPassword(); form.hidden = true; feedback.textContent = data?.verification_sent ? 'Account created. Enter the code sent to the staff email below, and share the password privately.' : 'Account created, but the verification email could not be sent. Use Resend code below.'; await loadStaffSection();
  } catch (error) { feedback.textContent = error.message; }
  finally { button.disabled = false; }
});
$('#staff-list').addEventListener('click', async (event) => {
  const resend = event.target.closest('[data-resend-staff-code]');
  if (resend) {
    const codeForm = resend.closest('.staff-code-form'); const status = $('.staff-code-status', codeForm);
    const verifier = createStaffVerificationClient(); if (!verifier) { status.textContent = 'Account services are unavailable.'; return; }
    resend.disabled = true;
    try {
      const { error } = await verifier.auth.resend({ type: 'signup', email: codeForm.dataset.staffEmail });
      if (error) throw error;
      status.textContent = 'Code sent to the staff email.';
    } catch (error) { status.textContent = error.status === 429 ? 'Please wait before requesting another code.' : 'Could not send the code. Try again.'; }
    finally { resend.disabled = false; }
    return;
  }
  const button = event.target.closest('[data-staff-id]'); if (!button) return;
  const enable = button.dataset.staffActive === 'true';
  if (!confirm(`${enable ? 'Enable' : 'Disable'} this staff account?`)) return;
  button.disabled = true; const { error } = await supabase.rpc('owner_set_staff_active', { p_user_id: button.dataset.staffId, p_active: enable });
  $('#staff-feedback').textContent = error ? 'Could not update staff access.' : `Staff account ${enable ? 'enabled' : 'disabled'}.`;
  await loadStaffSection({ force: true });
});
$('#staff-list').addEventListener('submit', async (event) => {
  const codeForm = event.target.closest('.staff-code-form'); if (!codeForm) return;
  event.preventDefault(); if (!codeForm.reportValidity()) return;
  const button = $('button[type="submit"]', codeForm); const status = $('.staff-code-status', codeForm);
  const verifier = createStaffVerificationClient(); if (!verifier) { status.textContent = 'Account services are unavailable.'; return; }
  button.disabled = true; status.textContent = 'Verifying…';
  try {
    const { data, error } = await verifier.auth.verifyOtp({ email: codeForm.dataset.staffEmail, token: codeForm.elements.code.value.trim(), type: 'signup' });
    if (error) throw error;
    if (!data.user || data.user.app_metadata?.role !== 'staff') throw new Error('This is not a staff account.');
    status.textContent = 'Email verified.';
    await loadStaffSection({ force: true });
    $('#staff-feedback').textContent = 'Staff email verified.';
  } catch (error) { status.textContent = error?.status === 429 ? 'Too many attempts. Please wait.' : 'Code invalid or expired. Check it or resend.'; }
  finally { try { await verifier.auth.signOut({ scope: 'local' }); } catch {} button.disabled = false; }
});
const adminViews = {
  overview: [$('.admin-metrics'), $('#overview-sections'), $('#dashboard-workspace'), $('.sales-chart-section')],
  payments: [$('#gcash-settings'), $('#dashboard-workspace')],
  orders: [$('#orders')],
  products: [$('#products'), $('#inventory')],
  shipping: [$('#orders')],
  customers: [$('#customers')],
  analytics: [$('.admin-metrics'), $('.sales-chart-section')],
  staff: [$('#staff')],
};
function showAdminView(view, updateHash = false) {
  if (!adminViews[view]) view = 'overview';
  if (isStaff && ['staff', 'analytics', 'customers', 'shipping'].includes(view)) view = 'overview';
  currentAdminView = view;
  document.querySelector('.admin-main').classList.toggle('is-overview', view === 'overview');
  if (view === 'payments') {
    if (authorized && !isStaff && !gcashSettingsLoaded) loadGcashSettings();
    const pending = ordersCache.filter((order) => order.status === 'payment_verification' && order.payments?.some((payment) => payment.status === 'pending' && payment.proof_path));
    if (!pending.some((order) => order.id === selectedOrderId)) selectedOrderId = pending[0]?.id || null;
  } else if (view === 'overview' && !selectedOrderId) selectedOrderId = ordersCache[0]?.id || null;
  if (view === 'overview' || view === 'payments') renderDashboardPanels();
  if (view === 'staff' && authorized && !isStaff) loadStaffSection();
  const allPanels = new Set(Object.values(adminViews).flat());
  allPanels.forEach((panel) => { const active = adminViews[view].includes(panel); panel.hidden = !active; panel.classList.toggle('view-enter', active); });
  // The payment workspace focuses on the review queue and selected proof.
  document.querySelectorAll('.fulfillment-panel, .telemetry-panel').forEach((panel) => { panel.hidden = true; });
  $('#attention-panel').hidden = view === 'payments';
  adminTabs.forEach((tab) => {
    const active = tab.hash === `#${view}`;
    tab.classList.toggle('selected', active);
    if (active) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  });
  if (updateHash && location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
}
adminTabs.forEach((tab) => tab.addEventListener('click', (event) => {
  event.preventDefault(); const view = tab.hash.slice(1); markActivityRead(view); showAdminView(view, true); window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'orders' || view === 'payments' || view === 'overview') { loadOrders(); loadMetrics(); }
  if (view === 'customers') loadProfiles();
}));
window.addEventListener('hashchange', () => showAdminView(location.hash.slice(1)));
showAdminView(location.hash.slice(1) || 'overview');

function updateClock() {
  const now = new Date();
  $('#dashboard-clock').textContent = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(now);
  $('#dashboard-clock').dateTime = now.toISOString();
  $('#today-date').textContent = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' }).format(now);
}
const activityTypes = ['orders', 'payments', 'customers'];
function readCutoff(type) {
  try { const value = Number(localStorage.getItem(`hushley-activity:${notificationUserId}:${type}`)); return Number.isFinite(value) && value > 0 ? value : Date.now() - 7 * 86400000; }
  catch { return activityReadFallback[type] || Date.now() - 7 * 86400000; }
}
function markActivityRead(view) {
  if (!notificationUserId) return;
  const types = view === 'overview' ? activityTypes : activityTypes.includes(view) ? [view] : [];
  for (const type of types) {
    activityReadFallback[type] = Date.now();
    try { localStorage.setItem(`hushley-activity:${notificationUserId}:${type}`, String(activityReadFallback[type])); } catch { /* Keep read state until this page closes. */ }
  }
  renderNotifications();
}
function renderNotifications(errorMessage = '') {
  const counts = Object.fromEntries(activityTypes.map((type) => [type, notificationEvents.filter((event) => event.type === type && event.time > readCutoff(type)).length]));
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const indicator = $('#notification-count'); indicator.hidden = !total; indicator.textContent = total > 99 ? '99+' : total;
  $('#notification-toggle').setAttribute('aria-label', total ? `Notifications, ${total} unread` : 'Notifications, no unread activity');
  for (const type of ['overview', ...activityTypes]) {
    const tab = $(`.admin-sidebar nav a[href="#${type}"]`); if (!tab) continue;
    let badge = $('.nav-activity-count', tab);
    if (!badge) { badge = document.createElement('span'); badge.className = 'nav-activity-count'; tab.append(badge); }
    const count = type === 'overview' ? total : counts[type]; badge.hidden = !count; badge.textContent = count > 99 ? '99+' : count;
    badge.setAttribute('aria-label', `${count} unread`);
  }
  const list = $('#notification-list');
  if (errorMessage) { list.innerHTML = `<p class="notification-message">${escapeHtml(errorMessage)} <button type="button" id="notification-retry">Retry</button></p>`; return; }
  list.innerHTML = notificationEvents.length ? notificationEvents.slice(0, 15).map((event) => `<button class="notification-item ${event.time > readCutoff(event.type) ? 'is-unread' : ''}" type="button" data-activity-view="${event.type}"><span>${escapeHtml(event.label)}</span><small>${escapeHtml(new Date(event.time).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }))}</small></button>`).join('') : '<p class="notification-message">No recent orders, payment proofs, or new customers.</p>';
}
async function refreshNotifications() {
  if (!authorized || !notificationUserId || notificationRefreshing) return;
  notificationRefreshing = true;
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  try {
    const [orders, payments, customers] = await Promise.all([
      fetchAll(() => supabase.from('orders').select('id,order_number,status,created_at').gte('created_at', since).order('created_at', { ascending: false }).order('id')),
      fetchAll(() => supabase.from('payments').select('id,status,proof_path,created_at,orders!inner(order_number,status)').eq('status', 'pending').eq('orders.status', 'payment_verification').gte('created_at', since).order('created_at', { ascending: false }).order('id')),
      isStaff ? Promise.resolve({ data: [], error: null }) : fetchAll(() => supabase.rpc('admin_customer_profiles').select('id,full_name,created_at').gte('created_at', since).order('created_at', { ascending: false }).order('id')),
    ]);
    const failed = [orders, payments, customers].find((result) => result.error);
    if (failed) throw failed.error;
    const priorKeys = new Set(notificationEvents.map((event) => event.key));
    notificationEvents = [
      ...orders.data.map((order) => ({ key: `order:${order.id}`, type: 'orders', time: Date.parse(order.created_at), label: `New order ${order.order_number} · ${orderStatusLabel(order.status)}` })),
      ...payments.data.filter((payment) => payment.proof_path).map((payment) => ({ key: `payment:${payment.id}`, type: 'payments', time: Date.parse(payment.created_at), label: `Payment proof awaiting review · ${payment.orders?.order_number || 'Order'}` })),
      ...customers.data.map((customer) => ({ key: `customer:${customer.id}`, type: 'customers', time: Date.parse(customer.created_at), label: `New customer · ${customer.full_name || 'Name not provided'}` })),
    ].filter((event) => Number.isFinite(event.time)).sort((a, b) => b.time - a.time);
    const newEvents = notificationEvents.filter((event) => !priorKeys.has(event.key));
    if (notificationBaselineReady && newEvents.length) notifyActivity(newEvents.length === 1 ? newEvents[0].label : `${newEvents.length} new updates.`, 'info');
    notificationBaselineReady = true;
    renderNotifications();
  } catch { renderNotifications('Activity could not be refreshed.'); }
  finally { notificationRefreshing = false; }
}
$('#notification-toggle').addEventListener('click', () => { const panel = $('#notification-panel'); panel.hidden = !panel.hidden; $('#notification-toggle').setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) refreshNotifications(); });
$('#notification-refresh').addEventListener('click', refreshNotifications);
$('#notification-list').addEventListener('click', (event) => {
  if (event.target.closest('#notification-retry')) { refreshNotifications(); return; }
  const item = event.target.closest('[data-activity-view]'); if (!item) return;
  const view = item.dataset.activityView; markActivityRead(view); showAdminView(view, true); $('#notification-panel').hidden = true; $('#notification-toggle').setAttribute('aria-expanded', 'false');
  if (view === 'orders' || view === 'payments') { loadOrders(); loadMetrics(); } else if (view === 'customers') loadProfiles();
});
document.addEventListener('click', (event) => { if (!event.target.closest('.notification-wrap')) { $('#notification-panel').hidden = true; $('#notification-toggle').setAttribute('aria-expanded', 'false'); } });
updateClock(); setInterval(updateClock, 1000);
async function refreshAdminInBackground() {
  if (!authorized || adminAutoRefreshing || document.hidden || !navigator.onLine) return;
  adminAutoRefreshing = true;
  try {
    await refreshNotifications();
    if (isStaff) {
      const { data, error } = await supabase.rpc('staff_current_access');
      if (error || !data) { authorized = false; layout.hidden = true; gate.hidden = false; gateMessage.textContent = 'Staff access is unavailable or disabled. Contact the shop owner.'; return; }
    }
    if (!isStaff && currentAdminView === 'staff') await loadStaffSection();
    if (!adminIsEditing()) await Promise.all([loadOrders({ background: true }), loadMetrics({ background: true }), loadProducts({ background: true }), ...(isStaff ? [] : [loadProfiles({ background: true })])]);
    backgroundFailures.delete('dashboard');
  } catch { backgroundFailure('dashboard'); }
  finally { adminAutoRefreshing = false; }
}
if (authorized) {
  refreshNotifications();
  setInterval(refreshAdminInBackground, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAdminInBackground(); });
  window.addEventListener('online', refreshAdminInBackground);
}
