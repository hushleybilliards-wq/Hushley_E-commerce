import { isSupabaseConfigured, supabase } from '../lib/supabase.js';

let products = [];
let categoryNames = new Map();
let activeFilter = 'All';
let activeCategoryId = null;
let searchTerm = '';
let slowTimer;
let toastTimer;
let isAdminSession = false;
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
const categoryTrack = document.querySelector('#hero-category-track');
const adminDashboardLink = document.querySelector('.admin-dashboard-link');
const fallbackCategories = [
  { id: 'cues', name: 'Billiard Cues' }, { id: 'shafts', name: 'Carbon Shafts' },
  { id: 'chalk', name: 'Billiard Chalk' }, { id: 'tips', name: 'Billiard Tips' },
  { id: 'ferrules', name: 'Ferrules' }, { id: 'cases', name: 'Cue Cases' },
  { id: 'grips-leather', name: 'Cue Grips and Leather' }, { id: 'gloves', name: 'Billiard Gloves' },
  { id: 'accessories', name: 'Cue Accessories' }, { id: 'other', name: 'Other Billiard Products' },
];
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
function formatSpecification(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.map(formatSpecification).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
function renderSpecifications(specifications = {}) {
  if (!specifications || typeof specifications !== 'object' || Array.isArray(specifications)) return '';
  const entries = Object.entries(specifications).map(([name, value]) => [name, formatSpecification(value)]).filter(([name, value]) => name.trim() && value);
  if (!entries.length) return '';
  return `<dl class="product-specifications" aria-label="Product specifications">${entries.map(([name, value]) => `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
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
function categoryFilter(categoryId) {
  if (['cues', 'shafts'].includes(categoryId)) return 'Cues';
  if (categoryId === 'chalk') return 'Chalk';
  return 'Accessories';
}
function renderCategoryCarousel(categories, productRows = []) {
  if (!categoryTrack) return;
  const list = (categories?.length ? categories : fallbackCategories)
    .filter((category) => category && typeof category.id === 'string' && typeof category.name === 'string');
  const firstImageByCategory = new Map();
  productRows.forEach((product) => {
    const image = product.image_urls?.find((url) => typeof url === 'string' && url.trim());
    if (image && !firstImageByCategory.has(product.category_id)) firstImageByCategory.set(product.category_id, image);
  });
  const iconFor = (name) => /cue/i.test(name) ? 'sports' : /shaft/i.test(name) ? 'straighten' : /chalk|tip|ferrule/i.test(name) ? 'ink_eraser' : /case/i.test(name) ? 'work' : /glove/i.test(name) ? 'back_hand' : 'category';
  const card = (category, clone = false) => {
    const image = firstImageByCategory.get(category.id);
    const label = escapeHtml(category.name);
    return `<button class="hero-category-card" type="button" data-category-id="${escapeHtml(category.id)}" ${clone ? 'tabindex="-1" aria-hidden="true"' : `aria-label="View ${label} products"`}>
      <span class="hero-category-art">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" />` : `<span class="material-symbols-outlined" aria-hidden="true">${iconFor(category.name)}</span>`}</span>
      <span class="hero-category-card-name">${label}</span><span class="material-symbols-outlined hero-category-arrow" aria-hidden="true">arrow_outward</span>
    </button>`;
  };
  const html = list.map((item) => card(item)).join('');
  categoryTrack.innerHTML = `${html}${list.map((item) => card(item, true)).join('')}`;
  categoryTrack.dataset.categoryCount = String(list.length);
}
function selectCategory(categoryId) {
  activeCategoryId = categoryId;
  activeFilter = categoryFilter(categoryId);
  document.querySelectorAll('.filter').forEach((filter) => {
    const active = filter.dataset.filter === activeFilter;
    filter.classList.toggle('active', active); filter.setAttribute('aria-pressed', String(active));
  });
  renderProducts();
  document.querySelector('#products').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function renderProducts() {
  const visible = products.filter((item) => (activeCategoryId ? item.category_id === activeCategoryId : activeFilter === 'All' || item.filterCategory === activeFilter) && `${item.name} ${item.category} ${item.description || ''} ${JSON.stringify(item.specifications || {})}`.toLowerCase().includes(searchTerm));
  if (!visible.length) {
    grid.innerHTML = `<div class="empty-results"><span class="material-symbols-outlined" aria-hidden="true">search_off</span><h3>${searchTerm ? 'NO MATCHES FOUND' : 'NOTHING IN THIS CATEGORY YET'}</h3><p>${searchTerm ? 'Try a different product name, category, or description.' : 'Choose another category to keep browsing.'}</p>${searchTerm ? '<button class="text-button" data-clear-search>Clear search</button>' : ''}</div>`;
    grid.setAttribute('aria-busy', 'false');
    return;
  }
  grid.innerHTML = visible.map((item) => `
    <article class="product-card" data-product-card="${escapeHtml(item.id)}">
      <div class="product-image"><span class="product-tag">${escapeHtml(item.tag)}</span><div class="product-visual"><img class="product-photo" src="${escapeHtml(item.image_urls[0])}" alt="${escapeHtml(item.name)}" loading="lazy"></div><button class="save-button ${saved.has(item.id) ? 'is-saved' : ''}" data-save="${escapeHtml(item.id)}" aria-label="${saved.has(item.id) ? 'Remove' : 'Save'} ${escapeHtml(item.name)}" aria-pressed="${saved.has(item.id)}"><span class="material-symbols-outlined" aria-hidden="true">${saved.has(item.id) ? 'favorite' : 'favorite_border'}</span></button></div>
      <div class="product-meta"><span class="product-category-label">${escapeHtml(item.category)}</span><span class="stock-dot">${item.available_count > 0 ? `${item.available_count} IN STOCK` : 'SOLD OUT'}</span></div>
      <h3>${escapeHtml(item.name)}</h3><p class="product-description">${escapeHtml(item.description)}</p>
      ${renderSpecifications(item.specifications)}
      ${getProductOptions(item).length ? `<div class="product-options"><p class="option-heading">SELECT YOUR OPTIONS</p>${getProductOptions(item).map((option, index) => {
        const name = option.name.trim();
        const required = option.required !== false;
        const values = option.values.filter((value) => typeof value === 'string' && value.trim());
        const label = `${name}${required ? ' (required)' : ' (optional)'}`;
        return `<label class="product-option">${escapeHtml(label)}<select data-product-option="${index}" data-option-name="${escapeHtml(name)}" ${required ? 'required' : ''} aria-label="${escapeHtml(label)}"><option value="">${required ? `Choose ${escapeHtml(name.toLowerCase())}` : 'No preference'}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}</select></label>`;
      }).join('')}<p class="product-option-error" role="status" aria-live="polite" hidden></p></div>` : ''}
      <div class="product-buy"><strong>${Number.isFinite(Number(item.price)) && item.price !== undefined ? money(item.price) : 'PRICE TO BE CONFIRMED'}</strong><div class="product-actions"><button class="add-button" data-add="${escapeHtml(item.id)}" ${item.available_count === 0 ? 'disabled' : ''}><span class="material-symbols-outlined" aria-hidden="true">add_shopping_cart</span><span>Add to cart</span></button><button class="buy-now-button" data-buy-now="${escapeHtml(item.id)}" ${item.available_count === 0 ? 'disabled' : ''}>Buy now</button></div></div>
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
function cartPhoto(product) {
  const liveProduct = products.find((item) => item.id === product.id);
  const image = liveProduct?.image_urls?.find((url) => typeof url === 'string' && url.trim()) || product.image_urls?.find((url) => typeof url === 'string' && url.trim());
  return image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}"/>` : '<span class="material-symbols-outlined" aria-hidden="true">image_not_supported</span>';
}
function updateCart() {
  const count = [...cart.values()].reduce((sum, line) => sum + line.quantity, 0);
  document.querySelector('.bag-count').textContent = count;
  document.querySelector('.drawer-count').textContent = `(${count})`;
  localStorage.setItem('hushley-cart', JSON.stringify([...cart].map(([id, line]) => [id, line])));
  const lines = [...cart.entries()];
  document.querySelector('.empty-cart').hidden = lines.length > 0;
  document.querySelector('.cart-footer').hidden = lines.length === 0;
  document.querySelector('.cart-items').innerHTML = lines.map(([key, { product, quantity, selected_options = {} }]) => `<div class="cart-line"><div class="cart-thumb">${cartPhoto(product)}</div><div class="cart-info"><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.category === 'Cues' ? 'Cues & shafts' : product.category)}</p>${Object.keys(selected_options).length ? `<small class="cart-options">${formatSelectedOptions(selected_options)}</small>` : ''}<div class="qty-control"><button data-qty="${escapeHtml(key)}" data-delta="-1" aria-label="Remove one ${escapeHtml(product.name)}">−</button><span>${quantity}</span><button data-qty="${escapeHtml(key)}" data-delta="1" aria-label="Add one ${escapeHtml(product.name)}">+</button></div></div><div class="cart-line-end"><button type="button" class="cart-remove" data-remove="${escapeHtml(key)}" aria-label="Remove ${escapeHtml(product.name)} from cart">×</button><span class="cart-line-price">${Number.isFinite(Number(product.price)) && product.price !== undefined ? money(product.price * quantity) : 'PRICE TBD'}</span></div></div>`).join('');
  const total = lines.reduce((sum, [, { product, quantity }]) => sum + (Number(product.price) || 0) * quantity, 0);
  document.querySelector('.subtotal').textContent = lines.every(([, { product }]) => Number.isFinite(Number(product.price)) && product.price !== undefined) ? money(total) : 'TO BE CONFIRMED';
}
function addProduct(id, card) {
  if (isAdminSession) { showToast('Admin accounts cannot place orders'); return false; }
  const product = products.find((item) => item.id === id);
  if (!product || product.available_count === 0) { showToast('THIS ITEM IS OUT OF STOCK'); return false; }
  const selectors = [...card.querySelectorAll('[data-option-name]')];
  const missing = selectors.find((selector) => selector.required && !selector.value);
  const error = card.querySelector('.product-option-error');
  if (missing) {
    if (error) { error.textContent = `Choose ${missing.dataset.optionName} before adding this item.`; error.hidden = false; }
    missing.focus();
    missing.reportValidity();
    return false;
  }
  if (error) { error.textContent = ''; error.hidden = true; }
  const selected_options = Object.fromEntries(selectors.filter((selector) => selector.value).map((selector) => [selector.dataset.optionName, selector.value]));
  const key = cartKey(product, selected_options);
  const current = cart.get(key);
  cart.set(key, { product, quantity: (current?.quantity || 0) + 1, selected_options });
  updateCart(); showToast(`${product.name} ADDED TO CART`); openDrawer(); return true;
}
function showProductPage(product) {
  const page = document.querySelector('#product-page');
  if (!product) { page.hidden = true; [...document.querySelector('main').children].filter((node) => node !== page).forEach((node) => node.hidden = false); document.title = 'Hushley Billiard Accessories'; return; }
  [...document.querySelector('main').children].filter((node) => node !== page).forEach((node) => node.hidden = true);
  page.hidden = false;
  page.innerHTML = `<div class="detail-topbar"><button type="button" class="detail-close" data-product-back aria-label="Close product details">×</button></div><div class="detail-layout" data-product-card="${escapeHtml(product.id)}"><div class="detail-gallery"><img src="${escapeHtml(product.image_urls[0])}" alt="${escapeHtml(product.name)}"></div><div class="detail-info"><div class="detail-intro"><p class="eyebrow">${escapeHtml(product.category)} · ${product.available_count > 0 ? `${product.available_count} IN STOCK` : 'SOLD OUT'}</p><h1>${escapeHtml(product.name)}</h1><p class="detail-price">${product.price !== undefined ? money(product.price) : 'PRICE TO BE CONFIRMED'}</p><p class="detail-description">${escapeHtml(product.description || '')}</p></div><section class="detail-options-block"><h2>Choose variations</h2>${getProductOptions(product).map((option, index) => { const name = option.name.trim(); const required = option.required !== false; return `<label>${escapeHtml(name)}${required ? ' (required)' : ' (optional)'}<select data-product-option="${index}" data-option-name="${escapeHtml(name)}" ${required ? 'required' : ''}><option value="">${required ? `Choose ${escapeHtml(name.toLowerCase())}` : 'No preference'}</option>${option.values.filter((value) => typeof value === 'string' && value.trim()).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}</select></label>`; }).join('')}<p class="product-option-error" role="status" aria-live="polite" hidden></p><div class="detail-actions"><button class="button button-outline" data-add="${escapeHtml(product.id)}" ${product.available_count === 0 ? 'disabled' : ''}>ADD TO CART</button><button class="button button-primary" data-buy-now="${escapeHtml(product.id)}" ${product.available_count === 0 ? 'disabled' : ''}>BUY NOW</button></div></section><section class="detail-specs"><h2>Specifications</h2>${renderSpecifications(product.specifications) || '<p>Specifications have not been provided for this item.</p>'}</section></div></div>`;
  document.title = `${product.name} · Hushley Billiards`;
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function navigateProduct(product) { history.pushState({ productId: product.id }, '', `/?product=${encodeURIComponent(product.id)}`); showProductPage(product); }
async function loadCatalog() {
  if (!isSupabaseConfigured) {
    renderCategoryCarousel(fallbackCategories);
    setStatus('notice', '<span class="material-symbols-outlined" aria-hidden="true">info</span><span>The product catalog is not connected. Products appear here after staff add and publish them.</span>');
    renderProducts(); updateCart(); return;
  }
  renderSkeletons();
  setStatus('loading', '<span class="material-symbols-outlined spin" aria-hidden="true">progress_activity</span><span>Loading the catalog…</span>');
  let isSlow = false;
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => { isSlow = true; setStatus('slow', '<span class="material-symbols-outlined" aria-hidden="true">hourglass_top</span><span>This is taking a little longer. Your catalog is still loading.</span>'); }, 5000);
  const [productsResult, categoriesResult] = await Promise.all([
    supabase.from('products').select('id,name,category_id,description,price,stock_quantity,reserved_quantity,image_urls,is_active,options,specifications').eq('is_active', true).order('name'),
    supabase.from('categories').select('id,name').eq('is_active', true),
  ]);
  clearTimeout(slowTimer);
  const { data, error } = productsResult;
  renderCategoryCarousel(categoriesResult.data || [], data || []);
  if (error) {
    setStatus('error', '<span class="material-symbols-outlined" aria-hidden="true">cloud_off</span><span>We could not load the catalog.</span><button class="status-retry" data-retry>Try again</button>');
    grid.innerHTML = '';
    console.error('Could not load catalog:', error.message);
    return;
  }
  categoryNames = new Map((categoriesResult.data || []).map((category) => [category.id, category.name]));
  const catalogRows = data || [];
  products = catalogRows
    .filter((product) => product.description?.trim() && product.image_urls?.some((url) => typeof url === 'string' && url.trim()))
    .map((product) => ({
      ...product,
      available_count: product.stock_quantity - product.reserved_quantity,
      category: categoryNames.get(product.category_id) || product.category_id,
      filterCategory: ['shafts', 'cues'].includes(product.category_id) ? 'Cues' : product.category_id === 'chalk' ? 'Chalk' : 'Accessories',
      tag: (categoryNames.get(product.category_id) || product.category_id).toUpperCase(),
    }));
  const hiddenIncomplete = catalogRows.length - products.length;
  setStatus(hiddenIncomplete ? 'notice' : '', hiddenIncomplete ? `<span class="material-symbols-outlined" aria-hidden="true">info</span><span>${hiddenIncomplete} published product${hiddenIncomplete === 1 ? ' is' : 's are'} hidden until staff add a photo and description.</span>` : '');
  document.querySelector('.catalog-note').hidden = true;
  renderProducts(); updateCart();
  const productId = new URLSearchParams(location.search).get('product');
  if (productId) showProductPage(products.find((product) => product.id === productId));
}

grid.addEventListener('click', (event) => {
  const card = event.target.closest('[data-product-card]');
  if (card && !event.target.closest('button, select, a, input')) {
    const product = products.find((item) => item.id === card.dataset.productCard);
    if (product) navigateProduct(product);
    return;
  }
  if (event.target.closest('[data-product-back]')) { event.preventDefault(); history.pushState({}, '', '/'); showProductPage(null); return; }
  const buyNow = event.target.closest('[data-buy-now]');
  if (buyNow && addProduct(buyNow.dataset.buyNow, buyNow.closest('[data-product-card]'))) { window.location.href = '/checkout'; return; }
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
document.querySelector('#product-page').addEventListener('click', (event) => {
  if (event.target.closest('[data-product-back]')) { event.preventDefault(); history.pushState({}, '', '/'); showProductPage(null); return; }
  const add = event.target.closest('[data-add]');
  if (add) addProduct(add.dataset.add, add.closest('[data-product-card]'));
  const buy = event.target.closest('[data-buy-now]');
  if (buy && addProduct(buy.dataset.buyNow, buy.closest('[data-product-card]'))) window.location.href = '/checkout';
});
window.addEventListener('popstate', () => {
  const id = new URLSearchParams(location.search).get('product');
  showProductPage(id ? products.find((product) => product.id === id) : null);
});
grid.addEventListener('change', (event) => {
  if (!event.target.matches('[data-option-name]')) return;
  const error = event.target.closest('[data-product-card]')?.querySelector('.product-option-error');
  if (error) { error.textContent = ''; error.hidden = true; }
});
document.querySelector('.cart-items').addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove]');
  if (remove) { cart.delete(remove.dataset.remove); updateCart(); return; }
  const button = event.target.closest('[data-qty]'); if (!button) return;
  const entry = cart.get(button.dataset.qty); if (!entry) return; entry.quantity += Number(button.dataset.delta);
  if (entry.quantity <= 0) cart.delete(button.dataset.qty); updateCart();
});
document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.filter').forEach((filter) => { const active = filter === button; filter.classList.toggle('active', active); filter.setAttribute('aria-pressed', String(active)); });
  activeFilter = button.dataset.filter; activeCategoryId = null; renderProducts();
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
document.querySelector('.checkout-button').addEventListener('click', () => { if (isAdminSession) { showToast('Admin accounts cannot place orders'); return; } window.location.href = '/checkout'; });
categoryTrack?.addEventListener('click', (event) => {
  const card = event.target.closest('[data-category-id]');
  if (card && !card.hasAttribute('aria-hidden')) selectCategory(card.dataset.categoryId);
});
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
if (isSupabaseConfigured) {
  const syncAdminLink = (user) => { isAdminSession = user?.app_metadata?.role === 'admin'; adminDashboardLink.hidden = !isAdminSession; document.body.classList.toggle('admin-session', isAdminSession); };
  supabase.auth.getUser().then(({ data }) => syncAdminLink(data.user));
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => syncAdminLink(session?.user));
  window.addEventListener('beforeunload', () => subscription.unsubscribe(), { once: true });
}
renderProducts(); updateCart();
loadCatalog();
