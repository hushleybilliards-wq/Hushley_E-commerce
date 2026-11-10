import { isSupabaseConfigured, supabase } from '../lib/supabase.js';

const $ = (selector, root = document) => root.querySelector(selector);
const gate = $('#admin-gate');
const layout = $('#admin-layout');
const gateMessage = $('#gate-message');
const adminStatus = $('#admin-status');
let categories = [];
let ordersCache = [];
let productsCache = [];
let authorized = false;
const currency = (amount) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(amount || 0));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const safeSlug = (value) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const shippingClasses = new Map([['small_items', 'Small items'], ['cue', 'Billiard cue'], ['ball_set', 'Billiard ball set']]);
async function uploadProductImage(image) {
  if (!image) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type)) throw new Error('Product image must be JPG, PNG, or WebP.');
  const path = `catalog/${crypto.randomUUID()}-${safeSlug(image.name)}`;
  const { error } = await supabase.storage.from('product-images').upload(path, image, { upsert: false });
  if (error) throw error;
  return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
}
function say(message, kind = '') { adminStatus.textContent = message; adminStatus.dataset.kind = kind; }
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
  else if (user.app_metadata?.role !== 'admin') gateMessage.textContent = 'Permission denied. This account has no administrator role. Ask the project owner to assign it, then sign in again.';
  else {
    authorized = true;
    gate.hidden = true;
    layout.hidden = false;
    $('#admin-email').textContent = user.email;
    $('#today-date').textContent = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' });
    setConnection(navigator.onLine);
    await loadCategories();
    await Promise.all([loadMetrics(), loadOrders(), loadProducts(), loadInventory()]);
  }
}

function setConnection(online, reconnected = false) {
  const indicator = $('#connection-state');
  if (!indicator) return;
  indicator.textContent = online ? (reconnected ? 'RECONNECTED' : 'ONLINE') : 'OFFLINE';
  indicator.dataset.state = online ? 'online' : 'offline';
  if (reconnected) say('Connection restored. Refresh any view that failed while offline.', 'success');
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

async function loadMetrics() {
  const started = Date.now();
  const queries = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true }),
    supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('products').select('stock_quantity,low_stock_threshold').eq('is_active', true),
    supabase.from('payments').select('amount').eq('status', 'approved'),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'delivered'),
  ]);
  const error = queries.find((item) => item.error)?.error;
  if (error) { say(failureMessage(error, 'Dashboard metrics'), 'error'); return; }
  const [orders, payments, products, lowStock, sales, completed] = queries;
  $('#metric-sales').textContent = currency((sales.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0));
  $('#metric-orders').textContent = orders.count ?? '0';
  $('#metric-payments').textContent = payments.count ?? '0';
  $('#metric-completed').textContent = completed.count ?? '0';
  $('#metric-products').textContent = products.count ?? '0';
  $('#metric-low-stock').textContent = lowStock.data.filter((row) => row.stock_quantity <= row.low_stock_threshold).length;
  if (Date.now() - started > 5000) say('Metrics loaded over a slow connection.', 'warning');
}

async function loadOrders() {
  const host = $('#orders-body');
  rowMessage(host, 7, 'Loading recent orders…');
  const started = Date.now();
  let { data, error } = await supabase.from('orders').select('id,order_number,customer_name,email,mobile,address_line,city,province,postal_code,country,courier,payment_method,customer_note,subtotal,total,shipping_fee,shipping_confirmed,shipping_region,shipping_quote_note,actual_shipping_fee,shipping_receipt_reference,shipping_customer_emailed_at,shipping_adjustment_note,shipping_adjustment_settled_at,shipping_adjustment_amount,status,tracking_number,created_at,order_items(product_name,quantity,selected_options),payments(id,status,proof_path,created_at)').order('created_at', { ascending: false }).limit(30);
  if (error && /column|schema cache/i.test(error.message)) {
    const fallback = await supabase.from('orders').select('id,order_number,customer_name,email,mobile,address_line,city,province,postal_code,country,courier,payment_method,customer_note,subtotal,total,shipping_fee,shipping_confirmed,status,tracking_number,created_at,order_items(product_name,quantity,selected_options),payments(id,status,proof_path,created_at)').order('created_at', { ascending: false }).limit(30);
    data = fallback.data; error = fallback.error;
    if (!error) say('Connected database is missing the reviewed shipping fields. Legacy order views work; structured quote and actual-cost records require migration rollout.', 'warning');
  }
  if (error) { rowMessage(host, 7, failureMessage(error, 'Orders'), 'orders'); say(failureMessage(error, 'Orders'), 'error'); return; }
  ordersCache = data || [];
  await renderOrders();
  if (Date.now() - started > 5000) say('Orders loaded over a slow connection.', 'warning');
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
    const itemDetails = (order.order_items || []).map((item) => `${escapeHtml(item.product_name)} × ${item.quantity}${Object.keys(item.selected_options || {}).length ? ` — ${escapeHtml(JSON.stringify(item.selected_options))}` : ''}`).join('<br>');
    let proof = '';
    if (payment?.proof_path) {
      const { data: signed } = await supabase.storage.from('payment-proofs').createSignedUrl(payment.proof_path, 300);
      if (signed?.signedUrl) proof = `<a class="proof-link" href="${escapeHtml(signed.signedUrl)}" target="_blank" rel="noreferrer">VIEW PAYMENT PROOF</a>`;
    }
    const review = payment?.status === 'pending' ? `<div class="review-actions"><button data-review="${escapeHtml(payment.id)}" data-approved="true">APPROVE PAYMENT</button><button data-review="${escapeHtml(payment.id)}" data-approved="false">REJECT PROOF</button></div>` : '';
    const options = ['pending_payment','payment_verification','processing','ready_to_ship','shipped','in_transit','delivered','cancelled'];
    if (!options.includes(order.status)) options.push(order.status);
    const address = [order.address_line, order.city, order.province, order.postal_code, order.country].filter(Boolean).join(', ');
    const international = order.courier === 'philpost';
    const shippingSchemaAvailable = Object.hasOwn(order, 'actual_shipping_fee');
    const region = order.shipping_region || '';
    const shippingControls = `<div class="shipping-controls"><label>${international ? 'Estimated fee (PHP)' : 'Shipping fee (PHP)'}<input type="number" min="0" step="0.01" ${order.courier === 'lalamove' ? 'readonly' : ''} value="${order.courier === 'lalamove' ? 0 : Number(order.shipping_fee)}" data-shipping="${escapeHtml(order.id)}"/></label><label>Destination zone<select data-shipping-region="${escapeHtml(order.id)}"><option value="" ${!region ? 'selected' : ''}>Choose after destination review</option><option value="Luzon" ${region === 'Luzon' ? 'selected' : ''}>Luzon</option><option value="Visayas" ${region === 'Visayas' ? 'selected' : ''}>Visayas</option><option value="Mindanao" ${region === 'Mindanao' ? 'selected' : ''}>Mindanao</option><option value="Asia" ${region === 'Asia' ? 'selected' : ''}>Asia</option><option value="Outside Asia" ${region === 'Outside Asia' ? 'selected' : ''}>Outside Asia</option></select></label><label>Quote basis / review note<input type="text" maxlength="500" value="${escapeHtml(order.shipping_quote_note || '')}" placeholder="Destination and parcel assumptions" data-shipping-note="${escapeHtml(order.id)}"/></label><button data-save-shipping="${escapeHtml(order.id)}">CONFIRM SHIPPING</button></div>${international ? `<details class="actual-shipping"><summary>Record actual PhilPost cost and private settlement</summary>${shippingSchemaAvailable ? `<p>Keep the estimate unchanged. Enter the actual fee and private receipt reference; email and any refund or balance are handled outside this website.</p><label>Actual fee (PHP)<input type="number" min="0" step="0.01" value="${order.actual_shipping_fee ?? ''}" data-actual-fee="${escapeHtml(order.id)}"/></label><label>Private receipt reference<input type="text" maxlength="500" value="${escapeHtml(order.shipping_receipt_reference || '')}" data-receipt-reference="${escapeHtml(order.id)}"/></label><label>Customer email sent at<input type="datetime-local" value="${toLocalInput(order.shipping_customer_emailed_at)}" data-email-time="${escapeHtml(order.id)}"/></label><label>External settlement details<input type="text" maxlength="1000" value="${escapeHtml(order.shipping_adjustment_note || '')}" placeholder="Refund arranged or balance paid outside site" data-settlement-note="${escapeHtml(order.id)}"/></label><label>Settlement completed at<input type="datetime-local" value="${toLocalInput(order.shipping_adjustment_settled_at)}" data-settlement-time="${escapeHtml(order.id)}"/></label><small>${order.shipping_adjustment_amount == null ? 'Actual cost not recorded.' : `Adjustment: ${currency(order.shipping_adjustment_amount)} ${Number(order.shipping_adjustment_amount) < 0 ? '(excess shipping refund due)' : Number(order.shipping_adjustment_amount) > 0 ? '(external balance due)' : '(no adjustment)'}`}</small><button data-save-actual="${escapeHtml(order.id)}">SAVE ACTUAL COST / SETTLEMENT</button>` : '<p>Structured actual-cost controls are unavailable because the reviewed shipping migration is not applied to this database.</p>'}</details>` : ''}`;
    return `<tr><td><strong>${escapeHtml(order.order_number)}</strong><small>${new Date(order.created_at).toLocaleDateString('en-PH')}</small>${proof}${review}<small>${itemDetails}</small></td><td>${escapeHtml(order.customer_name)}<small>${escapeHtml(order.email)}</small><small>${escapeHtml(order.mobile)}</small><small>${escapeHtml(address)}</small><small>Courier: ${escapeHtml(order.courier || 'to confirm')}</small><small>${escapeHtml(order.customer_note || '')}</small></td><td>${currency(order.total)}</td><td>${escapeHtml(order.payment_method)}<small>${escapeHtml(payment?.status || 'not submitted')}</small></td><td><select class="order-status" data-order="${escapeHtml(order.id)}">${options.map((value) => `<option value="${value}" ${value === order.status ? 'selected' : ''} ${(['payment_confirmed','payment_rejected','payment_verification'].includes(value) || (!hasApprovedPayment && ['processing','ready_to_ship','shipped','in_transit','delivered'].includes(value)) || (['cancelled','payment_rejected'].includes(order.status) && value !== order.status)) ? 'disabled' : ''}>${value.replaceAll('_', ' ')}</option>`).join('')}</select></td><td>${shippingControls}</td><td><label>Tracking number<input type="text" value="${escapeHtml(order.tracking_number || '')}" placeholder="Tracking no." data-tracking="${escapeHtml(order.id)}"/></label><button data-save-tracking="${escapeHtml(order.id)}">SAVE TRACKING</button></td></tr>`;
  })).then((rows) => rows.join(''));
}
function toLocalInput(value) { return value ? new Date(value).toISOString().slice(0, 16) : ''; }

async function loadProducts() {
  const host = $('#products-body');
  rowMessage(host, 5, 'Loading products…');
  const { data, error } = await supabase.from('products').select('id,name,description,sku,category_id,price,stock_quantity,reserved_quantity,image_urls,is_active,low_stock_threshold,options,specifications,shipping_class').order('name');
  if (error) { rowMessage(host, 5, failureMessage(error, 'Products'), 'products'); say(failureMessage(error, 'Products'), 'error'); return; }
  productsCache = data || [];
  if (!data.length) { rowMessage(host, 5, 'No products yet. Add the first product to start the catalog.'); return; }
  host.innerHTML = data.map((product) => `<tr><td><input class="row-edit" value="${escapeHtml(product.name)}" data-product-name="${product.id}" aria-label="Product name"/><details class="row-details"><summary>DESCRIPTION, PHOTOS &amp; PRODUCT DETAILS</summary><label>Description<textarea class="row-edit" data-product-description="${product.id}" rows="3" aria-label="Description">${escapeHtml(product.description)}</textarea></label><label>SKU<input class="row-edit" value="${escapeHtml(product.sku || '')}" data-product-sku="${product.id}" placeholder="SKU" aria-label="SKU"/></label>${product.image_urls?.[0] ? `<img class="admin-product-image-preview" src="${escapeHtml(product.image_urls[0])}" alt="Current photo of ${escapeHtml(product.name)}"/>` : '<span class="missing-product-image">No product image uploaded yet.</span>'}<label>Replace product image<input class="row-edit" type="file" accept="image/jpeg,image/png,image/webp" data-product-image="${product.id}" aria-label="Replace product image"/></label><label>Options JSON<textarea class="row-edit product-json-edit" data-product-options="${product.id}" rows="6" spellcheck="false" aria-label="Product options JSON">${escapeHtml(JSON.stringify(product.options || [], null, 2))}</textarea></label><label>Specifications JSON<textarea class="row-edit product-json-edit" data-product-specifications="${product.id}" rows="5" spellcheck="false" aria-label="Specifications JSON">${escapeHtml(JSON.stringify(product.specifications || {}, null, 2))}</textarea></label><label>Shipping class<select class="row-select" data-product-shipping-class="${product.id}" aria-label="Shipping class"><option value="" ${!product.shipping_class ? 'selected' : ''}>Unclassified — staff review</option>${[...shippingClasses].map(([value, label]) => `<option value="${value}" ${product.shipping_class === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><small>Enter sizes and item-specific details in Specifications JSON. Each option uses a name, text values, and an optional required flag.</small></details><small>${product.id.slice(0,8)}</small></td><td><select class="row-select" data-product-category="${product.id}" aria-label="Category">${categories.map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === product.category_id ? 'selected' : ''}>${escapeHtml(category.name)}${category.is_active ? '' : ' (inactive)'}</option>`).join('')}</select></td><td><input class="row-edit price-edit" type="number" min="0" step="0.01" value="${Number(product.price)}" data-product-price="${product.id}" aria-label="Price"/></td><td><span>${product.stock_quantity - product.reserved_quantity} available · ${product.reserved_quantity} reserved</span><small class="stock-edit"><input type="number" min="${product.reserved_quantity}" value="${product.stock_quantity}" data-stock-value="${product.id}" aria-label="Stock quantity"/><button data-save-stock="${product.id}">SAVE STOCK</button></small></td><td><label class="publish-edit"><input type="checkbox" data-product-published="${product.id}" ${product.is_active?'checked':''}/> PUBLISHED</label>${product.stock_quantity <= product.low_stock_threshold ? '<small class="low-stock-note">LOW STOCK</small>' : ''}<button class="admin-action product-save" data-save-product="${product.id}">SAVE PRODUCT</button><small class="product-save-status" data-product-save-status="${product.id}" role="status" aria-live="polite"></small></td></tr>`).join('');
}
async function loadCategories() {
  const host = $('#categories-body');
  rowMessage(host, 4, 'Loading categories…');
  const { data, error } = await supabase.from('categories').select('id,name,sort_order,is_active').order('sort_order').order('name');
  if (error) { rowMessage(host, 4, failureMessage(error, 'Categories'), 'categories'); say(failureMessage(error, 'Categories'), 'error'); return; }
  categories = data || [];
  $('#product-form [name="category_id"]').innerHTML = categories.map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}${category.is_active ? '' : ' (inactive)'}</option>`).join('');
  if (!categories.length) { rowMessage(host, 4, 'No categories yet. Add a category before creating a product.'); return; }
  host.innerHTML = categories.map((category) => `<tr><td><input class="row-edit" value="${escapeHtml(category.name)}" data-category-name="${escapeHtml(category.id)}" aria-label="Category name"/></td><td>${escapeHtml(category.id)}</td><td><input class="row-edit price-edit" type="number" min="0" value="${Number(category.sort_order)}" data-category-order="${escapeHtml(category.id)}" aria-label="Sort order"/></td><td><label class="publish-edit"><input type="checkbox" data-category-active="${escapeHtml(category.id)}" ${category.is_active?'checked':''}/> ACTIVE</label><button class="admin-action product-save" data-save-category="${escapeHtml(category.id)}">SAVE</button></td></tr>`).join('');
}
async function loadInventory() {
  const host = $('#inventory-list');
  host.textContent = 'Loading stock activity…';
  const { data, error } = await supabase.from('inventory_transactions').select('id,quantity_delta,reason,note,created_at,products(name)').order('created_at', { ascending: false }).limit(12);
  if (error) { host.innerHTML = `<p class="panel-message">${escapeHtml(failureMessage(error, 'Inventory activity'))} <button class="text-action" data-retry="inventory">RETRY</button></p>`; return; }
  if (!data.length) { host.textContent = 'No inventory changes recorded yet.'; return; }
  host.innerHTML = data.map((row) => `<article><strong>${escapeHtml(row.products?.name || 'Product')}</strong><span>${row.quantity_delta > 0 ? '+' : ''}${row.quantity_delta} · ${escapeHtml(row.reason.replaceAll('_',' '))}</span><small>${new Date(row.created_at).toLocaleString('en-PH')}</small></article>`).join('');
}

$('#admin-sign-out').addEventListener('click', async () => { await supabase.auth.signOut(); window.location.href = '/account.html'; });
$('#reload-orders').addEventListener('click', loadOrders);
$('#order-search').addEventListener('input', renderOrders);
$('#toggle-product-form').addEventListener('click', () => { $('#product-form').hidden = !$('#product-form').hidden; });
$('#toggle-category-form').addEventListener('click', () => { $('#category-form').hidden = !$('#category-form').hidden; });
document.addEventListener('click', async (event) => {
  const retry = event.target.closest('[data-retry]');
  if (retry) ({ metrics: loadMetrics, orders: loadOrders, products: loadProducts, categories: loadCategories, inventory: loadInventory }[retry.dataset.retry] || (() => {}))();
});

$('#category-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const status = $('.form-status', form); const button = $('button[type="submit"]', form) || $('button', form);
  const values = new FormData(form); const name = String(values.get('name')).trim(); const id = safeSlug(name);
  if (!id) { status.textContent = 'Enter a category name using letters or numbers.'; return; }
  button.disabled = true; status.textContent = 'Saving category…';
  const { error } = await supabase.from('categories').insert({ id, name, sort_order: Number(values.get('sort_order')) });
  button.disabled = false;
  if (error) { status.textContent = failureMessage(error, 'Category save'); return; }
  form.reset(); form.hidden = true; say('Category added.', 'success'); await Promise.all([loadCategories(), loadProducts()]);
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
    form.reset(); form.hidden = true; say('Product saved.', 'success'); await Promise.all([loadProducts(), loadMetrics(), loadInventory()]);
  } catch (error) { status.textContent = failureMessage(error, 'Product save'); }
  finally { button.disabled = false; }
});

$('#orders-body').addEventListener('change', async (event) => {
  const orderId = event.target.dataset.order; if (!orderId) return;
  const { error } = await supabase.from('orders').update({ status: event.target.value }).eq('id', orderId);
  if (error) { say(failureMessage(error, 'Order status update'), 'error'); await loadOrders(); } else say('Order status updated.', 'success');
});
document.addEventListener('click', async (event) => {
  const review = event.target.closest('[data-review]');
  if (review) {
    review.disabled = true; review.textContent = 'REVIEWING…'; say('Checking payment proof review…');
    const { error } = await supabase.rpc('admin_review_payment', { p_payment_id: review.dataset.review, p_approved: review.dataset.approved === 'true' });
    if (error) say(failureMessage(error, 'Manual payment review'), 'error'); else say(review.dataset.approved === 'true' ? 'Payment manually approved and inventory updated.' : 'Payment proof rejected and stock hold released.', 'success');
    await Promise.all([loadOrders(), loadProducts(), loadMetrics(), loadInventory()]); return;
  }
  const shippingSave = event.target.closest('[data-save-shipping]');
  if (shippingSave) {
    const orderId = shippingSave.dataset.saveShipping; const input = $(`[data-shipping="${orderId}"]`); const region = $(`[data-shipping-region="${orderId}"]`).value; const quoteNote = $(`[data-shipping-note="${orderId}"]`).value.trim(); const fee = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(fee) || fee < 0 || !region || !quoteNote) return say('Choose the reviewed destination region and add the quote basis/parcel assumptions.', 'error');
    shippingSave.disabled = true; shippingSave.textContent = 'SAVING…';
    const { error } = await supabase.rpc('admin_confirm_order_shipping', { p_order_id: orderId, p_region: region, p_fee: fee, p_quote_note: quoteNote || null });
    shippingSave.disabled = false; shippingSave.textContent = 'CONFIRM SHIPPING';
    if (error) say(/admin_confirm_order_shipping|function.*not found|schema cache/i.test(error.message) ? 'Shipping confirmation is unavailable. Refresh and verify the Supabase connection; no change was saved.' : failureMessage(error, 'Shipping confirmation'), 'error');
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
    if (error) return say(failureMessage(error, 'Inventory update'), 'error'); say('Inventory updated.', 'success'); await Promise.all([loadProducts(), loadMetrics(), loadInventory()]); return;
  }
  const trackingSave = event.target.closest('[data-save-tracking]');
  if (trackingSave) {
    const orderId = trackingSave.dataset.saveTracking; const trackingNumber = $(`[data-tracking="${orderId}"]`).value.trim(); trackingSave.disabled = true;
    const { error } = await supabase.from('orders').update({ tracking_number: trackingNumber || null }).eq('id', orderId); trackingSave.disabled = false;
    if (error) say(failureMessage(error, 'Tracking update'), 'error'); else say('Tracking number updated.', 'success'); return;
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
      setRowStatus(isActive ? 'Saved and published.' : 'Saved as draft.', 'success');
      await loadMetrics();
    } catch (error) { setRowStatus(failureMessage(error, 'Product update'), 'error'); }
    finally { productSave.disabled = false; productSave.textContent = 'SAVE PRODUCT'; }
    return;
  }
  const categorySave = event.target.closest('[data-save-category]');
  if (categorySave) {
    const id = categorySave.dataset.saveCategory; const name = $(`[data-category-name="${id}"]`).value.trim(); const orderInput = $(`[data-category-order="${id}"]`); const sortOrder = Number(orderInput.value); const isActive = $(`[data-category-active="${id}"]`).checked;
    if (!name || !orderInput.value.trim() || !Number.isInteger(sortOrder) || sortOrder < 0) return say('Enter a category name and whole-number sort order.', 'error');
    categorySave.disabled = true; const { error } = await supabase.from('categories').update({ name, sort_order: sortOrder, is_active: isActive }).eq('id', id); categorySave.disabled = false;
    if (error) say(failureMessage(error, 'Category update'), 'error'); else { say('Category updated.', 'success'); await Promise.all([loadCategories(), loadProducts()]); }
  }
});
