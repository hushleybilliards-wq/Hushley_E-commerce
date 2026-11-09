import { isSupabaseConfigured, supabase } from '../lib/supabase.js';

const previewProducts = [
  { id: 'shaft', name: 'Hushley carbon shaft', category: 'Cues', image: 'shaft', tag: 'CARBON SHAFTS' },
  { id: 'chalk', name: 'Hushley billiard chalk', category: 'Chalk', image: 'chalk', tag: 'BILLIARD CHALK' },
  { id: 'tip', name: 'Billiard cue tip set', category: 'Accessories', image: 'chalk', tag: 'CUE TIPS' },
];
let products = [...previewProducts];
let activeFilter = 'All';
let searchTerm = '';
let slowTimer;
let toastTimer;
const readStore = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
function readCart() {
  try { return new Map(JSON.parse(localStorage.getItem('hushley-cart') || '[]')); }
  catch { localStorage.removeItem('hushley-cart'); return new Map(); }
}
const cart = readCart();
const saved = new Set(readStore('hushley-saved'));
const grid = document.querySelector('#product-grid');
const drawer = document.querySelector('.cart-drawer');
const overlay = document.querySelector('.overlay');
const toast = document.querySelector('.toast');
const status = document.querySelector('#catalog-status');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);
function art(type) {
  if (type === 'shaft') return '<div class="visual-shaft"></div>';
  if (type === 'case') return '<div class="visual-case"></div>';
  return '<div class="visual-chalk"><span></span><span></span><span></span></div>';
}
function getProductOptions(product) {
  if (!Array.isArray(product.options)) return [];
  return product.options.filter((option) => option && typeof option.name === 'string' && option.name.trim() && Array.isArray(option.values) && option.values.some((value) => typeof value === 'string' && value.trim()));
}
function formatSelectedOptions(options = {}) {
  return Object.entries(options).map(([name, value]) => `${escapeHtml(name)}: ${escapeHtml(value)}`).join(' · ');
}
function cartKey(product, options = {}) {
  const entries = Object.entries(options).sort(([nameA], [nameB]) => nameA.localeCompare(nameB));
  return entries.length ? `${product.id}::${encodeURIComponent(JSON.stringify(entries))}` : String(product.id);
}
function setStatus(kind, message = '') {
  status.dataset.state = kind;
  status.innerHTML = message;
  status.hidden = !kind;
}
function renderProducts() {
  const visible = products.filter((item) => (activeFilter === 'All' || item.category === activeFilter) && `${item.name} ${item.category} ${item.description || ''} ${item.sku || ''}`.toLowerCase().includes(searchTerm));
  if (!visible.length) {
    grid.innerHTML = `<div class="empty-results"><span class="material-symbols-outlined" aria-hidden="true">search_off</span><h3>${searchTerm ? 'NO MATCHES FOUND' : 'NOTHING IN THIS CATEGORY YET'}</h3><p>${searchTerm ? 'Try a different product name, category, or SKU.' : 'Choose another category to keep browsing.'}</p>${searchTerm ? '<button class="text-button" data-clear-search>Clear search</button>' : ''}</div>`;
    grid.setAttribute('aria-busy', 'false');
    return;
  }
  grid.innerHTML = visible.map((item) => `
    <article class="product-card" data-product-card="${escapeHtml(item.id)}">
      <div class="product-image"><span class="product-tag">${escapeHtml(item.tag)}</span><div class="product-visual">${item.image_urls?.[0] ? `<img class="product-photo" src="${escapeHtml(item.image_urls[0])}" alt="${escapeHtml(item.name)}" loading="lazy">` : art(item.image)}</div><button class="save-button ${saved.has(item.id) ? 'is-saved' : ''}" data-save="${escapeHtml(item.id)}" aria-label="${saved.has(item.id) ? 'Remove' : 'Save'} ${escapeHtml(item.name)}" aria-pressed="${saved.has(item.id)}"><span class="material-symbols-outlined" aria-hidden="true">${saved.has(item.id) ? 'favorite' : 'favorite_border'}</span></button></div>
      <div class="product-meta"><span>${escapeHtml(item.category === 'Cues' ? 'CUES & SHAFTS' : item.category.toUpperCase())}</span><span class="stock-dot">${item.available_count === undefined ? 'CATALOG' : item.available_count > 0 ? `${item.available_count} IN STOCK` : 'SOLD OUT'}</span></div>
      <h3>${escapeHtml(item.name)}</h3><p class="product-description">${escapeHtml(item.description || 'Billiard gear for your game.')}</p>
      <div class="spec-row"><span>SKU</span><strong>${escapeHtml(item.sku || 'DETAILS AT CHECKOUT')}</strong></div>
      ${getProductOptions(item).length ? `<div class="product-options"><p class="option-heading">SELECT YOUR OPTIONS</p>${getProductOptions(item).map((option, index) => {
        const name = option.name.trim();
        const required = option.required !== false;
        const values = option.values.filter((value) => typeof value === 'string' && value.trim());
        const label = `${name}${required ? ' (required)' : ' (optional)'}`;
        return `<label class="product-option">${escapeHtml(label)}<select data-product-option="${index}" data-option-name="${escapeHtml(name)}" ${required ? 'required' : ''} aria-label="${escapeHtml(label)}"><option value="">${required ? `Choose ${escapeHtml(name.toLowerCase())}` : 'No preference'}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}</select></label>`;
      }).join('')}<p class="product-option-error" role="status" aria-live="polite" hidden></p></div>` : ''}
      <div class="product-buy"><strong>${Number.isFinite(Number(item.price)) && item.price !== undefined ? money(item.price) : 'PRICE TO BE CONFIRMED'}</strong><button class="add-button" data-add="${escapeHtml(item.id)}" ${item.available_count === 0 ? 'disabled' : ''}><span class="material-symbols-outlined" aria-hidden="true">add_shopping_cart</span><span>Add to cart</span></button></div>
    </article>`).join('');
  grid.setAttribute('aria-busy', 'false');
}
function renderSkeletons() {
  grid.setAttribute('aria-busy', 'true');
  grid.innerHTML = Array.from({ length: 8 }, () => '<article class="skeleton-card" aria-hidden="true"><div class="skeleton-image"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div><div class="skeleton-line"></div></article>').join('');
}
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}
function openDrawer() {
  drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
  overlay.hidden = false; document.body.classList.add('drawer-open');
  document.querySelector('.close-drawer').focus();
}
function closeDrawer() {
  drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true');
  overlay.hidden = true; document.body.classList.remove('drawer-open');
}
function updateCart() {
  const count = [...cart.values()].reduce((sum, line) => sum + line.quantity, 0);
  document.querySelector('.bag-count').textContent = count;
  document.querySelector('.drawer-count').textContent = `(${count})`;
  localStorage.setItem('hushley-cart', JSON.stringify([...cart].map(([id, line]) => [id, line])));
  const lines = [...cart.entries()];
  document.querySelector('.empty-cart').hidden = lines.length > 0;
  document.querySelector('.cart-footer').hidden = lines.length === 0;
  document.querySelector('.cart-items').innerHTML = lines.map(([key, { product, quantity, selected_options = {} }]) => `<div class="cart-line"><div class="cart-thumb">${art(product.image)}</div><div class="cart-info"><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.category === 'Cues' ? 'Cues & shafts' : product.category)}</p>${Object.keys(selected_options).length ? `<small class="cart-options">${formatSelectedOptions(selected_options)}</small>` : ''}<div class="qty-control"><button data-qty="${escapeHtml(key)}" data-delta="-1" aria-label="Remove one ${escapeHtml(product.name)}">−</button><span>${quantity}</span><button data-qty="${escapeHtml(key)}" data-delta="1" aria-label="Add one ${escapeHtml(product.name)}">+</button></div></div><span class="cart-line-price">${Number.isFinite(Number(product.price)) && product.price !== undefined ? money(product.price * quantity) : 'PRICE TBD'}</span></div>`).join('');
  const total = lines.reduce((sum, [, { product, quantity }]) => sum + (Number(product.price) || 0) * quantity, 0);
  document.querySelector('.subtotal').textContent = lines.every(([, { product }]) => Number.isFinite(Number(product.price)) && product.price !== undefined) ? money(total) : 'TO BE CONFIRMED';
}
function addProduct(id, card) {
  const product = products.find((item) => item.id === id);
  if (!product || product.available_count === 0) return showToast('THIS ITEM IS OUT OF STOCK');
  const selectors = [...card.querySelectorAll('[data-option-name]')];
  const missing = selectors.find((selector) => selector.required && !selector.value);
  const error = card.querySelector('.product-option-error');
  if (missing) {
    if (error) { error.textContent = `Choose ${missing.dataset.optionName} before adding this item.`; error.hidden = false; }
    missing.focus();
    missing.reportValidity();
    return;
  }
  if (error) { error.textContent = ''; error.hidden = true; }
  const selected_options = Object.fromEntries(selectors.filter((selector) => selector.value).map((selector) => [selector.dataset.optionName, selector.value]));
  const key = cartKey(product, selected_options);
  const current = cart.get(key);
  cart.set(key, { product, quantity: (current?.quantity || 0) + 1, selected_options });
  updateCart(); showToast(`${product.name} ADDED TO CART`);
}
async function loadCatalog() {
  if (!isSupabaseConfigured) {
    setStatus('notice', '<span class="material-symbols-outlined" aria-hidden="true">info</span><span>Preview catalog is shown. Connect the store catalog to see live products and stock.</span>');
    renderProducts(); updateCart(); return;
  }
  renderSkeletons();
  setStatus('loading', '<span class="material-symbols-outlined spin" aria-hidden="true">progress_activity</span><span>Loading the catalog…</span>');
  let isSlow = false;
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => { isSlow = true; setStatus('slow', '<span class="material-symbols-outlined" aria-hidden="true">hourglass_top</span><span>This is taking a little longer. Your catalog is still loading.</span>'); }, 5000);
  const { data, error } = await supabase.from('products').select('id,name,category_id,description,sku,price,stock_quantity,reserved_quantity,image_urls,is_active,options').eq('is_active', true).order('name');
  clearTimeout(slowTimer);
  if (error) {
    setStatus('error', '<span class="material-symbols-outlined" aria-hidden="true">cloud_off</span><span>We could not load the catalog.</span><button class="status-retry" data-retry>Try again</button>');
    grid.innerHTML = '';
    console.error('Could not load catalog:', error.message);
    return;
  }
  products = (data || []).map((product) => ({ ...product, available_count: product.stock_quantity - product.reserved_quantity, category: ['shafts', 'cues'].includes(product.category_id) ? 'Cues' : product.category_id === 'chalk' ? 'Chalk' : 'Accessories', tag: product.category_id.replaceAll('_', ' ').toUpperCase(), image: 'shaft' }));
  setStatus('', '');
  document.querySelector('.catalog-note').hidden = true;
  renderProducts(); updateCart();
}

grid.addEventListener('click', (event) => {
  const add = event.target.closest('[data-add]'); if (add) addProduct(add.dataset.add, add.closest('[data-product-card]'));
  const save = event.target.closest('[data-save]');
  if (save) {
    const id = save.dataset.save;
    if (saved.has(id)) saved.delete(id); else saved.add(id);
    localStorage.setItem('hushley-saved', JSON.stringify([...saved]));
    renderProducts(); showToast(saved.has(id) ? 'SAVED FOR LATER' : 'REMOVED FROM SAVED ITEMS');
  }
  if (event.target.closest('[data-clear-search]')) { document.querySelector('#catalog-search').value = ''; searchTerm = ''; renderProducts(); document.querySelector('#catalog-search').focus(); }
  if (event.target.closest('[data-retry]')) loadCatalog();
});
grid.addEventListener('change', (event) => {
  if (!event.target.matches('[data-option-name]')) return;
  const error = event.target.closest('[data-product-card]')?.querySelector('.product-option-error');
  if (error) { error.textContent = ''; error.hidden = true; }
});
document.querySelector('.cart-items').addEventListener('click', (event) => {
  const button = event.target.closest('[data-qty]'); if (!button) return;
  const entry = cart.get(button.dataset.qty); if (!entry) return; entry.quantity += Number(button.dataset.delta);
  if (entry.quantity <= 0) cart.delete(button.dataset.qty); updateCart();
});
document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.filter').forEach((filter) => { const active = filter === button; filter.classList.toggle('active', active); filter.setAttribute('aria-pressed', String(active)); });
  activeFilter = button.dataset.filter; renderProducts();
}));
document.querySelector('#catalog-search').addEventListener('input', (event) => { searchTerm = event.target.value.trim().toLowerCase(); renderProducts(); });
document.querySelector('.bag-button').addEventListener('click', openDrawer);
document.querySelector('.close-drawer').addEventListener('click', closeDrawer);
document.querySelector('.continue-shopping').addEventListener('click', closeDrawer);
overlay.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDrawer(); });
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    event.preventDefault(); document.querySelector('#catalog-search').focus();
  }
});
document.querySelector('.checkout-button').addEventListener('click', () => { window.location.href = '/checkout.html'; });
document.querySelectorAll('.category-card').forEach((card) => card.addEventListener('click', (event) => {
  event.preventDefault(); activeFilter = card.dataset.category;
  document.querySelectorAll('.filter').forEach((filter) => { const active = filter.dataset.filter === activeFilter; filter.classList.toggle('active', active); filter.setAttribute('aria-pressed', String(active)); }); renderProducts();
  document.querySelector('#products').scrollIntoView({ behavior: 'smooth' });
}));
document.querySelector('.menu-toggle').addEventListener('click', (event) => {
  const nav = document.querySelector('.main-nav'); const opened = nav.classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', String(opened));
});
document.querySelectorAll('.main-nav a').forEach((link) => link.addEventListener('click', () => {
  document.querySelector('.main-nav').classList.remove('open'); document.querySelector('.menu-toggle').setAttribute('aria-expanded', 'false');
}));
window.addEventListener('offline', () => setStatus('offline', '<span class="material-symbols-outlined" aria-hidden="true">wifi_off</span><span>You are offline. Your cart is saved on this device.</span>'));
window.addEventListener('online', () => { setStatus('reconnected', '<span class="material-symbols-outlined" aria-hidden="true">wifi</span><span>Connection restored.</span>'); setTimeout(() => { if (navigator.onLine) { setStatus('', ''); if (isSupabaseConfigured) loadCatalog(); } }, 2200); });
document.querySelector('#year').textContent = new Date().getFullYear();
renderProducts(); updateCart();
loadCatalog();
