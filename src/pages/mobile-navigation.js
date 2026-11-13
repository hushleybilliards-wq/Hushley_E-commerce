import '../styles/mobile-navigation.css';

const isAdmin = document.body.classList.contains('admin-page');
const isAccount = document.body.classList.contains('account-portal-page');
const isStore = Boolean(document.querySelector('#product-grid'));
const icon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
const link = (href, name, symbol, extra = '') => `<a href="${href}" ${extra}>${icon(symbol)}<span>${name}</span></a>`;
const nav = document.createElement('nav');
nav.className = 'mobile-bottom-nav';
if (isAdmin) {
  nav.setAttribute('aria-label', 'Mobile admin navigation');
  nav.innerHTML = `${link('#overview', 'Overview', 'space_dashboard', 'data-mobile-admin="overview"')}${link('#orders', 'Orders', 'receipt_long', 'data-mobile-admin="orders"')}${link('#payments', 'Payments', 'verified_user', 'data-mobile-admin="payments"')}${link('#products', 'Products', 'inventory_2', 'data-mobile-admin="products"')}<details class="mobile-more"><summary>${icon('more_horiz')}<span>More</span></summary><div class="mobile-more-menu">${link('#shipping', 'Shipping', 'local_shipping', 'data-mobile-admin="shipping"')}${link('#customers', 'Customers', 'group', 'data-mobile-admin="customers"')}${link('#analytics', 'Analytics', 'monitoring', 'data-mobile-admin="analytics"')}${link('/', 'View shop', 'storefront')}</div></details>`;
  document.querySelector('#admin-layout').append(nav);
  const syncAdmin = () => {
    const active = document.querySelector('.admin-sidebar nav a.selected')?.hash.slice(1) || 'overview';
    nav.querySelectorAll('[data-mobile-admin]').forEach((item) => {
      if (item.dataset.mobileAdmin === active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    });
    nav.querySelector('summary').classList.toggle('is-active', ['shipping', 'customers', 'analytics'].includes(active));
  };
  nav.addEventListener('click', (event) => {
    const item = event.target.closest('[data-mobile-admin]');
    if (!item) return;
    const target = document.querySelector(`.admin-sidebar nav a[href="#${item.dataset.mobileAdmin}"]`);
    if (target) { event.preventDefault(); target.click(); nav.querySelector('details').open = false; syncAdmin(); }
  });
  new MutationObserver(syncAdmin).observe(document.querySelector('.admin-sidebar nav'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  syncAdmin();
} else {
  nav.setAttribute('aria-label', 'Mobile navigation');
  nav.innerHTML = `${link('/', 'Shop', 'storefront', 'data-mobile-page="shop"')}${link('/?cart=1', 'Cart', 'shopping_bag', 'data-mobile-cart')}${link('/account#orders', 'Orders', 'receipt_long', 'data-mobile-account="orders"')}${link('/account?profile=1', 'Profile', 'person', 'data-mobile-account="account"')}`;
  document.body.append(nav);
  const syncCustomer = () => {
    nav.querySelectorAll('a').forEach((item) => item.removeAttribute('aria-current'));
    const current = isAccount ? nav.querySelector(`[data-mobile-account="${location.hash === '#orders' || location.hash === '#payment' ? 'orders' : 'account'}"]`) : isStore ? nav.querySelector('[data-mobile-page="shop"]') : null;
    current?.setAttribute('aria-current', 'page');
  };
  nav.addEventListener('click', (event) => {
    const cart = event.target.closest('[data-mobile-cart]');
    if (cart && isStore) { event.preventDefault(); document.querySelector('.bag-button').click(); return; }
    const account = event.target.closest('[data-mobile-account]');
    if (account && isAccount && !document.querySelector('#account-panel').hidden) {
      const target = document.querySelector(`[data-account-view="${account.dataset.mobileAccount}"]`);
      if (target) { event.preventDefault(); target.click(); syncCustomer(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    }
  });
  window.addEventListener('hashchange', syncCustomer);
  if (isAccount) new MutationObserver(syncCustomer).observe(document.querySelector('.account-sections'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  syncCustomer();
}
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { const menu = nav.querySelector('details[open]'); if (menu) { menu.open = false; menu.querySelector('summary').focus(); } } });
document.addEventListener('click', (event) => { if (!nav.contains(event.target)) { const menu = nav.querySelector('details[open]'); if (menu) menu.open = false; } });
