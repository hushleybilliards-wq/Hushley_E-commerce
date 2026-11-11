import { isSupabaseConfigured, supabase } from '../lib/supabase.js';
import { passwordIssue } from '../lib/password.js';
import { isGmailSignupEmail } from '../lib/signup.js';

const form = document.querySelector('#auth-form');
const authCard = document.querySelector('#auth-card');
const accountPanel = document.querySelector('#account-panel');
let mode = new URLSearchParams(location.search).get('recovery') === '1' ? 'recovery' : 'signin';
let signupStage = 1;
let recoveryStage = 1;
let recoveryEmail = '';
let currentUser = null;
let customerView = 'account';
let signingOut = false;
let savedAddress = null;
let pendingSignup = null;
let verifiedSignupUser = null;
let resendTimer = null;
let resendRemaining = 0;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

function say(message, kind = '', target = mode === 'signup' ? (signupStage === 3 ? '.otp-form-status' : '.signup-form-status') : mode === 'recovery' && recoveryStage === 2 ? '.otp-form-status' : '.signin-details .form-status') {
  const status = document.querySelector(target);
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = kind;
}
function authErrorMessage(error) {
  const detail = error?.message || 'We could not complete that request.';
  if (error?.status === 429 || /rate limit|too many requests/i.test(detail)) return 'Too many attempts in a short time. Please wait a little, then try again.';
  if (/invalid login credentials/i.test(detail)) return 'Email or password is incorrect. Check your details and try again.';
  if (/email not confirmed/i.test(detail)) return 'Please confirm your email using the link we sent before signing in.';
  if (/already registered|already exists|database error saving new user/i.test(detail)) return 'We could not create this account. If you already have an account, sign in; otherwise contact the shop for help.';
  if (/invalid.*(otp|token)|token.*(expired|invalid)|otp.*(expired|invalid)/i.test(detail)) return 'That code is invalid or expired. Check the latest code and try again.';
  if (/password.*(weak|short|length)/i.test(detail)) return 'Choose a stronger password with at least 8 characters.';
  if (/permission|row-level|not authorized/i.test(detail)) return 'Access was denied for this action. Sign in again or contact the shop if it continues.';
  if (/expired|jwt/i.test(detail)) return 'Your session expired. Sign in again and retry.';
  return detail;
}
function redirectAfterAuthentication(user) {
  const params = new URLSearchParams(location.search);
  const next = params.get('next');
  if (next === '/checkout') { location.replace('/checkout'); return; }
  if (next === '/admin' && user?.app_metadata?.role === 'admin') { location.replace('/admin'); return; }
  if (params.has('profile') && user?.app_metadata?.role === 'admin') { location.replace('/account?profile=1'); return; }
  location.replace(user?.app_metadata?.role === 'admin' ? '/admin' : '/');
}
const orderNotice = document.querySelector('#order-notice');
const connection = document.querySelector('#connection-state');
const accountConnection = document.querySelector('#account-connection');
function networkState() {
  const message = navigator.onLine ? '' : 'You are offline. Reconnect to sign in, load orders, or upload payment proof.';
  [connection, accountConnection].forEach((node) => { node.hidden = !message; node.textContent = message; node.dataset.kind = 'error'; });
}
window.addEventListener('offline', networkState);
window.addEventListener('online', () => {
  networkState();
  if (currentUser) { accountConnection.hidden = false; accountConnection.textContent = 'Connection restored. Refresh your orders to get the latest status.'; accountConnection.dataset.kind = 'success'; }
});
networkState();
function selectedChannel() { return form.elements.signup_channel.value; }
function normalizedPhone(value) {
  const raw = String(value || '').trim();
  if (!/^[+\d\s().-]+$/.test(raw) || (raw.includes('+') && !raw.startsWith('+63'))) return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0063')) digits = digits.slice(4);
  else if (digits.startsWith('63')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return /^9\d{9}$/.test(digits) ? `+63${digits}` : '';
}
function updateMode() {
  const signup = mode === 'signup';
  const recovery = mode === 'recovery';
  const recoveryOtp = recovery && recoveryStage === 2;
  const recoveryPassword = recovery && recoveryStage === 3;
  const channel = selectedChannel();
  const identifier = form.elements.identifier;
  const emailField = document.querySelector('#email-field');
  const signupDetails = document.querySelector('#signup-details');
  const otpDetails = document.querySelector('#signup-otp');
  const signinDetails = document.querySelector('#signin-details');
  const progress = document.querySelector('#signup-progress');
  const methodPicker = document.querySelector('#signup-methods');
  const continueButton = document.querySelector('#continue-signup');
  const changeEmail = document.querySelector('#change-signup-email');
  const signupDetailsVisible = signup && signupStage === 2;
  const otpVisible = signup && signupStage === 3;
  document.querySelector('#auth-title').textContent = recovery ? 'RESET PASSWORD' : otpVisible ? 'VERIFY YOUR CONTACT' : signup ? 'CREATE ACCOUNT' : 'SIGN IN';
  document.querySelector('#auth-lead').textContent = recovery ? (recoveryStage === 1 ? 'Enter your email and we’ll send a one-time reset code.' : recoveryOtp ? 'Enter the code from your email to continue.' : 'Choose a new password for your account.') : otpVisible ? 'Enter the one-time code to finish creating your account.' : signup ? 'Create your Hushley Billiards Shop account.' : 'Access your Hushley Billiards Shop account.';
  document.querySelector('#switch-prompt').textContent = signup ? 'Already have an account?' : 'New to Hushley?';
  document.querySelector('#switch-mode').textContent = signup ? 'SIGN IN' : 'CREATE AN ACCOUNT';
  progress.hidden = !signup;
  methodPicker.hidden = !signup || signupStage !== 1;
  signupDetails.hidden = !signupDetailsVisible;
  otpDetails.hidden = !(otpVisible || recoveryOtp);
  signinDetails.hidden = signup || (recovery && !recoveryPassword);
  emailField.hidden = recovery ? recoveryStage !== 1 : otpVisible;
  identifier.readOnly = signup && signupStage !== 1;
  identifier.required = recovery ? recoveryStage === 1 : !otpVisible;
  continueButton.hidden = !signup || signupStage !== 1;
  changeEmail.hidden = true;
  const progressLabels = [['EMAIL', signupStage === 1], ['CODE', signupStage === 3], ['DETAILS', signupStage === 2]];
  const progressIndex = signupStage === 3 ? 2 : signupStage === 2 ? 3 : 1;
  progressLabels.forEach(([label, active], index) => {
    const step = document.querySelector(`[data-progress-step="${index + 1}"]`);
    step.classList.toggle('is-current', active);
    step.classList.toggle('is-complete', progressIndex > index + 1);
    step.lastChild.textContent = ` ${label}`;
  });
  form.elements.full_name.required = signupDetailsVisible;
  form.elements.phone.required = signupDetailsVisible && channel === 'email';
  form.elements.contact_email.required = signupDetailsVisible && channel === 'phone';
  form.elements.password.required = signupDetailsVisible;
  form.elements.confirm_password.required = signupDetailsVisible;
  form.elements.terms_accepted.required = signupDetailsVisible;
  form.elements.otp_code.required = otpVisible || recoveryOtp;
  form.elements.recovery_password.required = recoveryOtp;
  form.elements.signin_password.required = !signup && (!recovery || recoveryPassword);
  identifier.autocomplete = recovery ? 'email' : 'username';
  const initialStep = signup && signupStage === 1;
  if (!initialStep) document.querySelector('#signup-email-status').hidden = true;
  const emailChannel = channel === 'email';
  const label = document.querySelector('#email-label');
  label.textContent = recovery ? 'EMAIL ADDRESS' : initialStep ? (emailChannel ? 'EMAIL ADDRESS TO VERIFY' : 'MOBILE NUMBER TO VERIFY') : (signup && !otpVisible ? (emailChannel ? 'VERIFIED EMAIL ADDRESS' : 'VERIFIED MOBILE NUMBER') : 'EMAIL ADDRESS');
  identifier.type = initialStep && emailChannel || recovery ? 'email' : 'text';
  identifier.inputMode = initialStep && !emailChannel ? 'tel' : 'email';
  if (signup && channel === 'phone') identifier.maxLength = 13; else identifier.removeAttribute('maxlength');
  identifier.placeholder = initialStep ? (emailChannel ? 'name@gmail.com' : '09171234567 or +639171234567') : 'Email address';
  document.querySelector('#identifier-icon').textContent = initialStep && !emailChannel ? 'call' : 'mail';
  document.querySelector('.contact-email-field').hidden = channel !== 'phone';
  document.querySelector('.phone-field').hidden = channel === 'phone';
  signupDetails.querySelector('.auth-submit').textContent = 'CREATE ACCOUNT →';
  document.querySelector('#verify-signup-code').textContent = 'VERIFY CODE';
  signinDetails.querySelector('.auth-submit').textContent = recovery ? 'UPDATE PASSWORD' : 'SIGN IN →';
  signinDetails.querySelector('.auth-field > span:first-child').textContent = recovery ? 'NEW PASSWORD' : 'PASSWORD';
  form.elements.signin_password.autocomplete = recovery ? 'new-password' : 'current-password';
  form.elements.signin_password.minLength = recoveryPassword ? 8 : 0;
  form.elements.signin_password.placeholder = recovery ? 'At least 8 characters' : 'Enter your password';
  document.querySelector('#recovery-password-rules').hidden = !recoveryPassword;
  document.querySelector('.auth-switch').hidden = recovery || (signup && signupStage === 2);
  document.querySelector('#forgot-password').hidden = signup || (recovery && recoveryStage !== 1);
  document.querySelector('#forgot-password').textContent = recovery ? 'SEND RESET CODE' : 'FORGOT PASSWORD?';
  document.querySelector('#recovery-password-confirm-field').hidden = !recoveryOtp;
  document.querySelector('#verify-signup-code').textContent = recoveryOtp ? 'VERIFY RESET CODE' : 'VERIFY CODE';
  if (recoveryOtp) document.querySelector('#otp-destination').textContent = `Enter the password reset code sent to ${recoveryEmail}.`;
  if (recovery) document.querySelector('#email-label').textContent = 'EMAIL ADDRESS';
  form.elements.password.placeholder = 'At least 8 characters';
  document.querySelector('.confirm-password-field').hidden = !signup;
  document.querySelector('.phone-field').hidden = !signup || channel === 'phone';
  document.querySelector('#switch-mode').disabled = otpVisible;
}
async function showAccount(user) {
  if (user.user_metadata?.signup_incomplete === true) {
    verifiedSignupUser = user;
    mode = 'signup'; signupStage = 2;
    form.elements.identifier.value = user.email || '';
    authCard.hidden = false; accountPanel.hidden = true;
    updateMode();
    say('Your email is verified. Complete your account details.', 'success');
    return;
  }
  if (currentUser?.id !== user.id) customerOrders = [];
  currentUser = user;
  const params = new URLSearchParams(location.search);
  const next = params.get('next');
  if (next === '/checkout' && mode !== 'recovery') { location.replace('/checkout'); return; }
  if (user.app_metadata?.role === 'admin' && next === '/admin') { location.replace('/admin'); return; }
  authCard.hidden = true;
  accountPanel.hidden = false;
  setCustomerView(params.has('placed') ? 'payment' : location.hash === '#payment' ? 'payment' : location.hash === '#orders' ? 'orders' : location.hash === '#addresses' ? 'addresses' : 'account');
  const identity = user.email_confirmed_at && user.email ? user.email : user.phone_confirmed_at && user.phone ? user.phone : user.email || user.phone || '';
  document.querySelector('#account-email').textContent = identity || 'No sign-in identity available';
  document.querySelector('#identity-status').textContent = (user.email_confirmed_at && identity === user.email) || (user.phone_confirmed_at && identity === user.phone) ? 'Verified sign-in contact' : 'Sign-in contact';
  const profileForm = document.querySelector('#customer-profile-form');
  if (profileForm) {
    const { data: profile, error: profileError } = await supabase.from('profiles').select('full_name,phone,default_address').eq('id', user.id).maybeSingle();
    profileForm.elements.full_name.value = profile?.full_name || user.user_metadata?.full_name || '';
    profileForm.elements.phone.value = profile?.phone || user.user_metadata?.phone || '';
    savedAddress = profile?.default_address || null;
    renderSavedAddress(profileError ? 'Could not load your saved address. Refresh and try again.' : '');
  }
  if (new URLSearchParams(location.search).has('placed')) document.querySelector('#order-notice').textContent = 'Order placed. Open your order below to upload your product payment proof. The shop will contact you about shipping.' + (params.get('address_save') === 'failed' ? ' Your order was placed, but your default address could not be saved.' : '');
  await loadOrders();
}
let customerOrders = [];
let orderFilter = 'all';
async function loadOrders() {
  if (!currentUser || !supabase) return;
  const host = document.querySelector('#orders-list');
  host.innerHTML = '<p class="state-loading" role="status">Loading your orders…</p>';
  let slowTimer = setTimeout(() => { host.insertAdjacentHTML('afterbegin', '<p class="slow-note">This is taking longer than usual. Your orders are still loading.</p>'); }, 7000);
  let { data, error } = await supabase.from('orders').select('id,order_number,status,subtotal,shipping_fee,total,courier,payment_method,tracking_number,shipping_confirmed,payment_scope,separate_shipping_quote,separate_shipping_actual,separate_shipping_adjustment,hold_expires_at,created_at,order_items(product_name,quantity,selected_options,products(image_urls)),payments(id)').eq('customer_id', currentUser.id).order('created_at', { ascending: false });
  if (error && /payment_scope|separate_shipping|schema cache/i.test(error.message || '')) {
    ({ data, error } = await supabase.from('orders').select('id,order_number,status,subtotal,shipping_fee,total,courier,payment_method,tracking_number,shipping_confirmed,hold_expires_at,created_at,order_items(product_name,quantity,selected_options,products(image_urls)),payments(id)').eq('customer_id', currentUser.id).order('created_at', { ascending: false }));
  }
  clearTimeout(slowTimer);
  if (error) {
    host.innerHTML = `<div class="state-error"><p>${escapeHtml(error.message || 'Your order history could not be loaded.')}</p><button class="admin-action" type="button" id="retry-orders">TRY AGAIN</button></div>`;
    host.querySelector('#retry-orders').addEventListener('click', loadOrders, { once: true });
    return;
  }
  customerOrders = data || [];
  renderCustomerOrders();
}
function renderCustomerOrders() {
  const host = document.querySelector('#orders-list');
  const groups = { 'to-pay': ['pending_payment', 'payment_rejected'], processing: ['payment_verification', 'payment_confirmed', 'processing', 'ready_to_ship'], 'in-transit': ['shipped', 'in_transit'], delivered: ['delivered'], cancelled: ['cancelled'] };
  const query = document.querySelector('#customer-order-search').value.trim().toLowerCase();
  const data = customerOrders.filter((order) => (orderFilter === 'all' || groups[orderFilter]?.includes(order.status)) && (!query || [order.order_number, ...(order.order_items || []).map((item) => item.product_name)].some((value) => String(value || '').toLowerCase().includes(query))));
  if (!data.length) {
    host.innerHTML = '<p class="empty-orders">No orders match your selection.</p>';
    return;
  }
  const money = (value) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(value);
  const nextStep = (order) => {
    if (order.status === 'pending_payment' && order.hold_expires_at && new Date(order.hold_expires_at) <= new Date()) return 'Your payment hold has expired. Contact the shop before paying so staff can help you place a new order.';
    if (['pending_payment', 'payment_rejected'].includes(order.status) && order.payment_scope !== 'products_only' && !order.shipping_confirmed) return 'The shop is reviewing your shipping fee. Wait for confirmation before paying.';
    if (order.status === 'payment_rejected') return 'Your proof was rejected. You may submit a new proof if the items are still available.';
    if (order.status === 'pending_payment') return order.payment_scope === 'products_only' ? 'Pay the product amount using your selected method, then upload your proof. The shop will contact you separately about shipping.' : 'Review the confirmed total, pay using your selected method, then upload your proof.';
    if (order.status === 'payment_verification') return 'Your proof is awaiting manual review by the shop.';
    if (order.status === 'cancelled') return 'This order has been cancelled. Contact the shop if you need help.';
    if (order.status === 'delivered') return 'This order is marked as delivered.';
    return 'Payment has been approved. Follow the order status and tracking details below.';
  };
  const cancellationControl = (order) => customerView === 'orders' && order.status === 'pending_payment' && !(order.payments || []).length ? `<div class="customer-cancel"><button type="button" data-open-cancel="${escapeHtml(order.id)}">Cancel order</button><form data-cancel-form="${escapeHtml(order.id)}" hidden><label>Reason for cancellation<select name="reason" required><option value="">Choose a reason</option><option>Changed my mind</option><option>Ordered the wrong item</option><option>Duplicate order</option><option>Other</option></select></label><small>Only cancel if you have not paid. If you already paid, contact the shop; refunds are handled manually.</small><div><button type="submit">Confirm cancellation</button><button type="button" data-close-cancel>Keep order</button></div></form></div>` : '';
  host.innerHTML = data.map((order) => `<article class="order-row"><div class="order-card-header"><div><span class="order-card-label">ORDER</span><strong>${escapeHtml(order.order_number)}</strong><span>${new Date(order.created_at).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' })}</span></div><span class="status-pill status-${escapeHtml(order.status)}">${escapeHtml(order.status.replaceAll('_', ' '))}</span></div><p class="order-next-step">${escapeHtml(nextStep(order))}</p><div class="order-items">${(order.order_items || []).map((item) => `<div class="order-item-line">${item.products?.image_urls?.[0] ? `<img class="order-item-photo" src="${escapeHtml(item.products.image_urls[0])}" alt="${escapeHtml(item.product_name)}" loading="lazy"/>` : `<span class="order-item-photo order-photo-missing" aria-label="Product image unavailable">—</span>`}<div><strong>${escapeHtml(item.product_name)} × ${Number(item.quantity)}</strong>${Object.keys(item.selected_options || {}).length ? `<span>${escapeHtml(Object.entries(item.selected_options).map(([key, value]) => `${key}: ${value}`).join(' · '))}</span>` : ''}</div></div>`).join('')}</div><div class="order-summary"><span>Payment <strong>${escapeHtml(order.payment_method.toUpperCase())}</strong></span><span>Courier <strong>${escapeHtml(order.courier || 'To be confirmed')}</strong></span><span>Shipping <strong>${order.payment_scope === 'products_only' ? (order.separate_shipping_quote != null ? escapeHtml(money(order.separate_shipping_quote)) + ' (separate)' : 'Shop will contact you') : order.shipping_confirmed ? escapeHtml(money(order.shipping_fee)) : 'To be confirmed'}</strong></span><span>${order.payment_scope === 'products_only' ? 'Product payment' : order.shipping_confirmed ? 'Total' : 'Subtotal'} <strong>${escapeHtml(money(order.payment_scope === 'products_only' || order.shipping_confirmed ? order.total : order.subtotal))}</strong></span></div>${order.tracking_number ? `<p class="order-tracking">Tracking number: <strong>${escapeHtml(order.tracking_number)}</strong></p>` : ''}${customerView === 'payment' && ['pending_payment','payment_rejected'].includes(order.status) && (order.shipping_confirmed || order.payment_scope === 'products_only') && !(order.status === 'pending_payment' && order.hold_expires_at && new Date(order.hold_expires_at) <= new Date()) ? `<form class="proof-upload" data-proof-order="${escapeHtml(order.id)}"><label>Upload payment proof<input type="file" accept="image/jpeg,image/png,image/webp" required /></label><small>JPEG, PNG or WebP · maximum 10 MB. A clear, cropped screenshot around 0.5–2 MB is recommended.</small><p class="proof-file-status" role="status" aria-live="polite"></p><button class="admin-action" type="submit">UPLOAD</button><small>Staff will check your payment manually before approving the order.</small></form>` : customerView === 'payment' && ['pending_payment','payment_rejected'].includes(order.status) ? `<div class="proof-waiting"><button type="button" disabled>UPLOAD</button><small>${order.status === 'pending_payment' && order.hold_expires_at && new Date(order.hold_expires_at) <= new Date() ? 'This order’s payment hold has expired. Contact the shop before paying.' : 'Available after the shop confirms your shipping fee. Select Refresh orders to check again.'}</small></div>` : ''}${cancellationControl(order)}</article>`).join('');
}

const addressForm = document.querySelector('#address-form');
const addressFormStatus = document.querySelector('#address-form-status');
let addressProvinces = [];
let addressRequest = 0;
const addressFields = addressForm.elements;
function renderSavedAddress(message = '') {
  const host = document.querySelector('#saved-address');
  document.querySelector('#address-edit').textContent = savedAddress ? 'Edit address' : 'Add address';
  if (message) { host.textContent = message; return; }
  if (!savedAddress) { host.innerHTML = '<p>No default address yet. Add one to make checkout faster.</p>'; return; }
  const address = [savedAddress.address_line, savedAddress.barangay, savedAddress.city, savedAddress.province, savedAddress.postal_code, savedAddress.country].filter(Boolean).join(', ');
  host.innerHTML = `<article class="saved-address-card"><div><strong>${escapeHtml(savedAddress.customer_name)}</strong><span> · ${escapeHtml(savedAddress.mobile)}</span><p>${escapeHtml(address)}</p><small>Default address</small></div><button type="button" class="address-delete" id="address-delete">Delete</button></article>`;
}
function addressOptions(select, placeholder, list) {
  select.replaceChildren(new Option(placeholder, ''));
  [...list].sort((a, b) => a.name.localeCompare(b.name)).forEach((item) => select.add(new Option(item.name, item.code)));
}
async function addressLocations(path) {
  const response = await fetch(`https://psgc.gitlab.io/api/${path}/`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Address list unavailable. Please try again.');
  const data = await response.json();
  if (!Array.isArray(data) || !data.length) throw new Error('Address list unavailable. Please try again.');
  return data;
}
function updateAddressEditorMode() {
  const local = addressFields.delivery_type.value === 'local';
  for (const part of ['province', 'city', 'barangay']) {
    const select = addressFields[`${part}_code`];
    document.querySelector(`#address-${part}-label`).hidden = !local;
    select.disabled = !local; select.required = local;
  }
  for (const [id, field] of [['country','country'], ['zone','shipping_region'], ['state','province'], ['international-city','city']]) {
    document.querySelector(`#address-${id}-label`).hidden = local;
    addressFields[field].disabled = local;
    addressFields[field].required = !local && field !== 'province';
  }
}
async function loadAddressProvinces() {
  addressProvinces = await addressLocations('provinces');
  addressOptions(addressFields.province_code, 'Choose province / Metro Manila', [...addressProvinces, { code: 'NCR', name: 'Metro Manila', islandGroupCode: 'luzon' }]);
}
async function loadAddressCities(code) {
  const path = code === 'NCR' ? 'regions/130000000/cities-municipalities' : `provinces/${code}/cities-municipalities`;
  addressOptions(addressFields.city_code, 'Choose city / municipality', await addressLocations(path));
}
async function loadAddressBarangays(code) {
  addressOptions(addressFields.barangay_code, 'Choose barangay', await addressLocations(`cities-municipalities/${code}/barangays`));
}
addressFields.delivery_type.addEventListener('change', async () => {
  addressRequest++; updateAddressEditorMode(); addressFormStatus.textContent = '';
  if (addressFields.delivery_type.value === 'local' && !addressProvinces.length) {
    try { await loadAddressProvinces(); }
    catch (error) { addressFormStatus.textContent = error.message; }
  }
});
addressFields.province_code.addEventListener('change', async () => {
  const request = ++addressRequest; const code = addressFields.province_code.value;
  addressOptions(addressFields.city_code, 'Loading cities…', []); addressOptions(addressFields.barangay_code, 'Choose city first', []);
  if (!code) return;
  try { const path = code === 'NCR' ? 'regions/130000000/cities-municipalities' : `provinces/${code}/cities-municipalities`; const list = await addressLocations(path); if (request === addressRequest) { addressOptions(addressFields.city_code, 'Choose city / municipality', list); addressFormStatus.textContent = ''; } }
  catch (error) { if (request === addressRequest) addressFormStatus.textContent = error.message; }
});
addressFields.city_code.addEventListener('change', async () => {
  const request = ++addressRequest; const code = addressFields.city_code.value;
  addressOptions(addressFields.barangay_code, 'Loading barangays…', []);
  if (!code) return;
  try { const list = await addressLocations(`cities-municipalities/${code}/barangays`); if (request === addressRequest) { addressOptions(addressFields.barangay_code, 'Choose barangay', list); addressFormStatus.textContent = ''; } }
  catch (error) { if (request === addressRequest) addressFormStatus.textContent = error.message; }
});
document.querySelector('#address-edit').addEventListener('click', async () => {
  addressForm.hidden = false; addressForm.reset(); addressFormStatus.textContent = '';
  const submit = addressForm.querySelector('[type="submit"]'); submit.disabled = true;
  const saved = savedAddress || {};
  addressFields.delivery_type.value = saved.delivery_type || 'local'; updateAddressEditorMode();
  for (const key of ['customer_name','mobile','email','address_line','postal_code','province','city']) addressFields[key].value = saved[key] || (key === 'customer_name' ? document.querySelector('#customer-profile-form').elements.full_name.value : key === 'mobile' ? document.querySelector('#customer-profile-form').elements.phone.value : key === 'email' ? currentUser?.email || '' : '');
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'region' }); const countries = [];
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) { const code = String.fromCharCode(a,b); const name = display.of(code); if (name && name !== code && code !== 'PH') countries.push({code:name,name}); }
    addressOptions(addressFields.country, 'Choose a country', countries); addressFields.country.value = saved.country || '';
    addressFields.shipping_region.value = saved.shipping_region || '';
    if (addressFields.delivery_type.value === 'local') {
      await loadAddressProvinces(); addressFields.province_code.value = saved.province_code || '';
      if (addressFields.province_code.value && saved.city_code) { await loadAddressCities(addressFields.province_code.value); addressFields.city_code.value = saved.city_code; }
      if (addressFields.city_code.value && saved.barangay_code) { await loadAddressBarangays(addressFields.city_code.value); addressFields.barangay_code.value = saved.barangay_code; }
    }
  } catch (error) { addressFormStatus.textContent = error.message || 'Could not load address choices. Close and try again.'; }
  finally { submit.disabled = false; }
});
document.querySelector('#address-cancel').addEventListener('click', () => { addressRequest++; addressForm.hidden = true; });
addressForm.addEventListener('submit', async (event) => {
  event.preventDefault(); if (!currentUser) return;
  const local = addressFields.delivery_type.value === 'local';
  const selectedProvince = addressProvinces.find((item) => item.code === addressFields.province_code.value);
  const region = local ? addressFields.province_code.value === 'NCR' ? 'Luzon' : {luzon:'Luzon',visayas:'Visayas',mindanao:'Mindanao'}[selectedProvince?.islandGroupCode] : addressFields.shipping_region.value;
  if (!region) { addressFormStatus.textContent = 'Please select a valid shipping region.'; return; }
  const address = { delivery_type: addressFields.delivery_type.value, customer_name: addressFields.customer_name.value.trim(), mobile: addressFields.mobile.value.trim(), email: addressFields.email.value.trim(), address_line: addressFields.address_line.value.trim(), postal_code: addressFields.postal_code.value.trim(), country: local ? 'Philippines' : addressFields.country.value, province: local ? addressFields.province_code.selectedOptions[0].textContent : addressFields.province.value.trim(), city: local ? addressFields.city_code.selectedOptions[0].textContent : addressFields.city.value.trim(), barangay: local ? addressFields.barangay_code.selectedOptions[0].textContent : '', province_code: local ? addressFields.province_code.value : '', city_code: local ? addressFields.city_code.value : '', barangay_code: local ? addressFields.barangay_code.value : '', shipping_region: region, courier: savedAddress?.shipping_region === region && savedAddress?.delivery_type === addressFields.delivery_type.value ? savedAddress.courier || '' : '' };
  const button = addressForm.querySelector('[type="submit"]'); button.disabled = true; addressFormStatus.textContent = 'Saving address…';
  const { data, error } = await supabase.from('profiles').update({ default_address: address }).eq('id', currentUser.id).select('id').maybeSingle();
  button.disabled = false;
  if (error || !data) { addressFormStatus.textContent = 'Could not save your address. Please try again.'; return; }
  savedAddress = address; addressForm.hidden = true; renderSavedAddress();
});
document.querySelector('#saved-address').addEventListener('click', async (event) => {
  if (!event.target.closest('#address-delete') || !currentUser || !confirm('Delete your saved default address?')) return;
  const { data, error } = await supabase.from('profiles').update({ default_address: null }).eq('id', currentUser.id).select('id').maybeSingle();
  if (error || !data) { renderSavedAddress('Could not delete your address. Refresh and try again.'); return; }
  savedAddress = null; addressForm.hidden = true; renderSavedAddress();
});

function setCustomerView(view) {
  customerView = ['account', 'addresses', 'orders', 'payment'].includes(view) ? view : 'account';
  document.querySelector('#account-profile-view').hidden = customerView !== 'account';
  document.querySelector('#addresses-view').hidden = customerView !== 'addresses';
  document.querySelector('#orders').hidden = !['orders', 'payment'].includes(customerView);
  document.querySelector('#payment-instructions').hidden = customerView !== 'payment';
  document.querySelector('.order-filters').hidden = customerView !== 'payment';
  document.querySelector('#customer-view-title').textContent = customerView === 'payment' ? 'My payment' : 'My orders';
  document.querySelector('#customer-view-eyebrow').textContent = customerView === 'payment' ? 'PAYMENT' : 'ORDERS';
  document.querySelector('#customer-view-description').textContent = customerView === 'payment' ? 'Check your orders and upload your receipt after paying for the products.' : 'Review your purchases and delivery status.';
  document.querySelectorAll('[data-account-view]').forEach((link) => { const active = link.dataset.accountView === customerView; link.classList.toggle('selected', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  if (customerView !== 'payment') { orderFilter = 'all'; document.querySelectorAll('[data-order-filter]').forEach((item) => { const active = item.dataset.orderFilter === 'all'; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }); }
  if (currentUser) renderCustomerOrders();
}
document.querySelectorAll('[data-account-view]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); history.replaceState(null, '', `#${link.dataset.accountView}`); setCustomerView(link.dataset.accountView); }));

document.querySelectorAll('[data-order-filter]').forEach((button) => button.addEventListener('click', () => {
  orderFilter = button.dataset.orderFilter;
  document.querySelectorAll('[data-order-filter]').forEach((item) => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
  renderCustomerOrders();
}));
document.querySelector('#customer-order-search').addEventListener('input', renderCustomerOrders);

document.querySelector('#switch-mode').addEventListener('click', () => {
  mode = mode === 'signin' ? 'signup' : 'signin';
  signupStage = 1;
  pendingSignup = null;
  say('');
  updateMode();
});
document.querySelector('#continue-signup').addEventListener('click', async (event) => {
  const identifier = form.elements.identifier;
  const status = document.querySelector('#signup-email-status');
  status.hidden = true;
  status.textContent = '';
  const channel = selectedChannel();
  identifier.setCustomValidity('');
  if (channel === 'email') {
    identifier.type = 'email';
    identifier.value = identifier.value.trim().toLowerCase();
    if (!identifier.value || !identifier.checkValidity()) {
      identifier.setCustomValidity('Enter a valid email address.');
      status.textContent = identifier.validationMessage; status.dataset.kind = 'error'; status.hidden = false;
      identifier.reportValidity(); identifier.focus(); return;
    }
    if (!isGmailSignupEmail(identifier.value)) {
      identifier.setCustomValidity('Use a Gmail address ending in @gmail.com without a + sign.');
      status.textContent = identifier.validationMessage; status.dataset.kind = 'error'; status.hidden = false;
      identifier.reportValidity(); identifier.focus(); return;
    }
  } else {
    const phone = normalizedPhone(identifier.value);
    if (!phone) {
      identifier.setCustomValidity('Enter 11 digits starting with 09, or +63 followed by 10 digits starting with 9.');
      identifier.reportValidity(); identifier.focus(); return;
    }
    identifier.value = phone;
  }
  if (!isSupabaseConfigured) {
    status.textContent = 'Account services are unavailable. Please contact the shop.'; status.dataset.kind = 'error'; status.hidden = false; return;
  }
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'SENDING CODE…';
  try {
    // A random temporary password allows Supabase to send its normal signup OTP.
    // It is replaced after email verification and is never shown or persisted here.
    const temporaryPassword = `A!${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    const email = identifier.value;
    const { data, error } = await supabase.auth.signUp({ email, password: temporaryPassword, options: { data: { signup_incomplete: true } } });
    if (error) throw error;
    if (Array.isArray(data.user?.identities) && data.user.identities.length === 0) throw new Error('We could not create this account. If you already have an account, sign in; otherwise contact the shop for help.');
    if (data.session) {
      await supabase.auth.signOut();
      throw new Error('Email confirmation is not enabled. Please contact the shop.');
    }
    pendingSignup = { channel: 'email', email, destination: email };
    document.querySelector('#otp-destination').textContent = `Enter the one-time code sent to ${email}.`;
    signupStage = 3;
    updateMode();
    startResendCooldown();
    form.elements.otp_code.focus();
    say('Code sent. Verify your email to continue.', 'success');
  } catch (error) {
    status.textContent = authErrorMessage(error); status.dataset.kind = 'error'; status.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'SEND VERIFICATION CODE →';
  }
});
form.elements.identifier.addEventListener('input', () => {
  form.elements.identifier.setCustomValidity('');
  document.querySelector('#signup-email-status').hidden = true;
});
form.elements.phone.addEventListener('input', () => form.elements.phone.setCustomValidity(''));
form.elements.password.addEventListener('input', () => form.elements.password.setCustomValidity(''));
form.elements.signin_password.addEventListener('input', () => form.elements.signin_password.setCustomValidity(''));
form.querySelectorAll('[name="signup_channel"]').forEach((radio) => radio.addEventListener('change', () => {
  const identifier = form.elements.identifier;
  identifier.value = '';
  identifier.setCustomValidity('');
  updateMode();
  identifier.focus();
}));
document.querySelector('#change-signup-email').addEventListener('click', () => {
  signupStage = 1;
  pendingSignup = null;
  updateMode();
  form.elements.identifier.focus();
});
document.querySelector('#change-signup-contact').addEventListener('click', () => {
  signupStage = 1;
  pendingSignup = null;
  updateMode();
  form.elements.identifier.focus();
});
document.querySelectorAll('[data-toggle-password]').forEach((button) => button.addEventListener('click', () => {
  const input = form.elements[button.dataset.togglePassword];
  const showing = input.type === 'password';
  input.type = showing ? 'text' : 'password';
  button.setAttribute('aria-label', `${showing ? 'Hide' : 'Show'} ${button.dataset.togglePassword.replaceAll('_', ' ')}`);
  button.querySelector('.material-symbols-outlined').textContent = showing ? 'visibility_off' : 'visibility';
}));
document.querySelector('#forgot-password').addEventListener('click', async () => {
  if (!isSupabaseConfigured) return say('Connect the client-owned Supabase project before using password recovery.', 'error');
  const identifier = form.elements.identifier.value.trim();
  if (!identifier || !identifier.includes('@')) return say('Password recovery uses your account email. Enter an email address; phone-only accounts need a linked email to reset here.', 'error');
  const email = identifier.toLowerCase();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/account?recovery=1` });
  if (error) return say(authErrorMessage(error), 'error');
  recoveryEmail = email;
  recoveryStage = 2;
  mode = 'recovery';
  updateMode();
  startResendCooldown();
  form.elements.otp_code.focus();
  say('If an account exists for that email, a password reset code is on the way.', 'success');
});
document.querySelector('#refresh-orders').addEventListener('click', loadOrders);
document.querySelector('#customer-profile-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const profileForm = event.currentTarget;
  const button = profileForm.querySelector('button[type="submit"]');
  const profileStatus = document.querySelector('#profile-status');
  if (!profileForm.reportValidity()) return;
  button.disabled = true;
  button.textContent = 'SAVING…';
  profileStatus.textContent = 'Saving your profile…';
  try {
    const fullName = profileForm.elements.full_name.value.trim();
    const phone = profileForm.elements.phone.value.trim();
    const { error: profileError } = await supabase.from('profiles').update({ full_name: fullName, phone: phone || null }).eq('id', currentUser.id);
    if (profileError) throw profileError;
    const { error: authError } = await supabase.auth.updateUser({ data: { full_name: fullName } });
    if (authError) throw authError;
    profileStatus.textContent = 'Profile details saved.';
    profileStatus.dataset.kind = 'success';
  } catch (error) {
    profileStatus.textContent = error?.code === '23505'
      ? 'This mobile number is already used by another account. Contact the shop if you need help.'
      : `${authErrorMessage(error)} You can try again.`;
    profileStatus.dataset.kind = 'error';
  } finally { button.disabled = false; button.textContent = 'SAVE PROFILE'; }
});
const proofTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const proofLimit = 10 * 1024 * 1024;
async function validProofImage(file) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const starts = (...values) => values.every((value, index) => bytes[index] === value);
  const headerMatches = file.type === 'image/jpeg' ? starts(0xff, 0xd8, 0xff)
    : file.type === 'image/png' ? starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    : file.type === 'image/webp' && starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!headerMatches) return false;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image.naturalWidth > 0 && image.naturalHeight > 0;
  } catch { return false; }
  finally { URL.revokeObjectURL(url); }
}
document.querySelector('#orders-list').addEventListener('click', (event) => {
  const open = event.target.closest('[data-open-cancel]');
  if (open) { const box = open.closest('.customer-cancel'); box.querySelector('form').hidden = false; open.hidden = true; box.querySelector('select').focus(); }
  const close = event.target.closest('[data-close-cancel]');
  if (close) { const box = close.closest('.customer-cancel'); box.querySelector('form').hidden = true; box.querySelector('[data-open-cancel]').hidden = false; }
});
document.querySelector('#orders-list').addEventListener('submit', async (event) => {
  const cancelForm = event.target.closest('[data-cancel-form]');
  if (!cancelForm) return;
  event.preventDefault();
  const button = cancelForm.querySelector('[type="submit"]'); button.disabled = true; button.textContent = 'Cancelling…';
  const { error } = await supabase.rpc('customer_cancel_order', { p_order_id: cancelForm.dataset.cancelForm, p_reason: cancelForm.elements.reason.value });
  if (error) { button.disabled = false; button.textContent = 'Confirm cancellation'; orderNotice.textContent = error.message || 'Could not cancel this order. Please contact the shop.'; orderNotice.dataset.kind = 'error'; return; }
  orderNotice.textContent = 'Order cancelled. If you already paid, contact the shop about your payment.'; orderNotice.dataset.kind = 'success';
  await loadOrders();
});
document.querySelector('#orders-list').addEventListener('change', (event) => {
  const input = event.target.closest('[data-proof-order] input[type="file"]');
  if (!input) return;
  const file = input.files[0];
  const hint = input.closest('form').querySelector('.proof-file-status');
  input.setCustomValidity(!file ? '' : !proofTypes.has(file.type) ? 'Choose a JPEG, PNG or WebP file.' : file.size > proofLimit ? 'The file must be 10 MB or smaller.' : '');
  hint.textContent = file ? `${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} MB${input.validationMessage ? ` — ${input.validationMessage}` : ''}` : '';
});
document.querySelector('#orders-list').addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-proof-order]');
  if (!form) return;
  event.preventDefault();
  const file = form.querySelector('input[type="file"]').files[0];
  if (!file || !proofTypes.has(file.type) || file.size > proofLimit) { orderNotice.textContent = 'Choose a JPEG, PNG or WebP file up to 10 MB.'; orderNotice.dataset.kind = 'error'; return; }
  const extension = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' }[file.type];
  const path = `${currentUser.id}/${form.dataset.proofOrder}/${crypto.randomUUID()}.${extension}`;
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'UPLOADING…';
  orderNotice.textContent = 'Uploading payment proof… Staff will review it manually; this does not mark the order as paid.';
  orderNotice.dataset.kind = '';
  try {
    if (!await validProofImage(file)) throw new Error('Choose a valid JPEG, PNG or WebP image.');
    const { error: uploadError } = await supabase.storage.from('payment-proofs').upload(path, file, { upsert: false, contentType: file.type });
    if (uploadError) throw uploadError;
    const { error } = await supabase.rpc('submit_payment_proof', { p_order_id: form.dataset.proofOrder, p_proof_path: path });
    if (error) throw error;
    orderNotice.textContent = 'Payment proof submitted. Staff will verify it manually before the order is marked paid.';
    orderNotice.dataset.kind = 'success';
    await loadOrders();
  } catch (error) {
    orderNotice.textContent = `${error.message || 'Upload failed.'} You can try again.`;
    orderNotice.dataset.kind = 'error';
  } finally { button.disabled = false; button.textContent = 'UPLOAD'; }
});
document.querySelector('#sign-out').addEventListener('click', async () => {
  signingOut = true;
  const { error } = await supabase.auth.signOut();
  if (error) { signingOut = false; say(authErrorMessage(error), 'error'); return; }
  currentUser = null;
  customerOrders = []; savedAddress = null;
  accountPanel.hidden = true;
  authCard.hidden = false;
  mode = 'signin'; updateMode(); say('');
  signingOut = false;
});
function startResendCooldown(seconds = 60) {
  clearInterval(resendTimer);
  const button = document.querySelector('#resend-signup-code');
  resendRemaining = seconds;
  button.disabled = true;
  button.textContent = `RESEND CODE IN ${resendRemaining}s`;
  resendTimer = setInterval(() => {
    resendRemaining -= 1;
    if (resendRemaining <= 0) {
      clearInterval(resendTimer);
      resendTimer = null;
      button.disabled = false;
      button.textContent = 'RESEND CODE';
    } else button.textContent = `RESEND CODE IN ${resendRemaining}s`;
  }, 1000);
}
document.querySelector('#resend-signup-code').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if ((!pendingSignup && !(mode === 'recovery' && recoveryStage === 2 && recoveryEmail)) || button.disabled || !isSupabaseConfigured) return;
  button.disabled = true;
  button.textContent = 'SENDING…';
  try {
      if (mode === 'recovery') {
        const response = await supabase.auth.resetPasswordForEmail(recoveryEmail, { redirectTo: `${location.origin}/account?recovery=1` });
        if (response.error) throw response.error;
        say('If an account exists for that email, a new password reset code is on the way.', 'success');
      } else {
        const response = pendingSignup.channel === 'email'
          ? await supabase.auth.resend({ type: 'signup', email: pendingSignup.email })
          : await supabase.auth.resend({ type: 'sms', phone: pendingSignup.phone });
        if (response.error) throw response.error;
        say(`A new verification code was sent to ${pendingSignup.destination}.`, 'success');
      }
    startResendCooldown();
  } catch (error) {
    say(authErrorMessage(error), 'error');
    if (error?.status === 429 || /rate limit|too many requests/i.test(error?.message || '')) startResendCooldown();
    else { button.disabled = false; button.textContent = 'RESEND CODE'; }
  }
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (mode === 'signup' && signupStage === 1) return document.querySelector('#continue-signup').click();
  const activeDetails = mode === 'signup'
    ? document.querySelector(signupStage === 3 ? '#signup-otp' : '#signup-details')
    : document.querySelector('#signin-details');
  for (const field of activeDetails.querySelectorAll('input[required]')) {
    field.setCustomValidity('');
    if (!field.checkValidity()) { field.reportValidity(); field.focus(); return say('Check the highlighted details and try again.', 'error'); }
  }
  if ((mode === 'signup' && signupStage === 2) || (mode === 'recovery' && recoveryStage === 3)) {
    const field = mode === 'signup' ? form.elements.password : form.elements.signin_password;
    const email = mode === 'signup' ? (selectedChannel() === 'email' ? form.elements.identifier.value : form.elements.contact_email.value) : recoveryEmail;
    const issue = passwordIssue(field.value, email);
    if (issue) { field.setCustomValidity(issue); field.reportValidity(); field.focus(); return say(issue, 'error'); }
  }
  if (mode === 'signup' && signupStage === 2 && form.elements.password.value !== form.elements.confirm_password.value) {
    form.elements.confirm_password.setCustomValidity('Passwords do not match.');
    form.elements.confirm_password.reportValidity();
    form.elements.confirm_password.focus();
    return say('Make sure both password fields match.', 'error');
  }
  if (mode === 'signup' && signupStage === 2 && selectedChannel() === 'email' && !isGmailSignupEmail(form.elements.identifier.value)) {
    signupStage = 1;
    updateMode();
    form.elements.identifier.setCustomValidity('Use a Gmail address ending in @gmail.com without a + sign.');
    form.elements.identifier.reportValidity(); form.elements.identifier.focus(); return;
  }
  if (mode === 'signup' && signupStage === 2 && selectedChannel() === 'email' && !normalizedPhone(form.elements.phone.value)) {
    form.elements.phone.setCustomValidity('Enter 10 digits starting with 9 after +63.');
    form.elements.phone.reportValidity(); form.elements.phone.focus();
    return say('Enter a valid mobile number so the shop can contact you about delivery.', 'error');
  }
  if (mode === 'signup' && signupStage === 2 && selectedChannel() === 'phone') {
    form.elements.contact_email.setCustomValidity('');
    if (!form.elements.contact_email.value.trim() || !form.elements.contact_email.checkValidity()) {
      form.elements.contact_email.setCustomValidity('Enter a valid email for order updates.');
      form.elements.contact_email.reportValidity(); form.elements.contact_email.focus();
      return say('Enter a valid email address for order updates.', 'error');
    }
  }
  if (!isSupabaseConfigured) return say('Connect the client-owned Supabase project before using account features.', 'error');
  const values = new FormData(form);
  const identifier = String(values.get('identifier') || '').trim();
  const channel = selectedChannel();
  const password = String(mode === 'signup' && signupStage === 2 ? values.get('password') : values.get('signin_password'));
  const button = mode === 'recovery' && recoveryStage === 2
    ? document.querySelector('#verify-signup-code')
    : mode === 'signup'
    ? document.querySelector(signupStage === 3 ? '#verify-signup-code' : '#signup-details .auth-submit')
    : document.querySelector('#signin-details .auth-submit');
  button.disabled = true;
  button.dataset.label = button.textContent;
  button.textContent = 'PLEASE WAIT…';
  const pendingMessage = mode === 'signup' ? (signupStage === 2 ? 'Creating your account…' : 'Verifying your code…') : mode === 'recovery' ? (recoveryStage === 2 ? 'Verifying reset code…' : 'Updating your password…') : 'Signing in…';
  say(pendingMessage);
  const slowTimer = setTimeout(() => say(`${pendingMessage} This is taking longer than usual. Please keep this page open.`, ''), 7000);
  try {
    if (mode === 'recovery' && recoveryStage === 2) {
      const token = String(values.get('otp_code') || '').replace(/\s+/g, '');
      const { data, error } = await supabase.auth.verifyOtp({ email: recoveryEmail, token, type: 'recovery' });
      if (error) throw error;
      if (!data?.session) throw new Error('The reset code was accepted without creating a recovery session. Request a new code and try again.');
      recoveryStage = 3;
      updateMode();
      form.elements.signin_password.focus();
      say('Code verified. Enter your new password.', 'success');
    } else if (mode === 'recovery' && recoveryStage === 3) {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      mode = 'signin';
      recoveryStage = 1;
      await showAccount(data.user);
      orderNotice.textContent = 'Password updated successfully.';
      orderNotice.dataset.kind = 'success';
    } else if (mode === 'signup' && signupStage === 2) {
      const fullName = String(values.get('full_name')).trim();
      const phone = normalizedPhone(String(values.get('phone')));
      if (!verifiedSignupUser) throw new Error('Please verify your email again before creating your account.');
      const { data: savedProfile, error: profileError } = await supabase.from('profiles').update({ full_name: fullName, phone }).eq('id', verifiedSignupUser.id).select('id').maybeSingle();
      if (profileError?.code === '23505') throw new Error('This mobile number is already used by another account. Contact the shop if you need help.');
      if (profileError) throw profileError;
      if (!savedProfile) throw new Error('Your profile could not be saved. Please contact the shop.');
      const { data, error } = await supabase.auth.updateUser({ password, data: { full_name: fullName, phone, signup_incomplete: false } });
      if (error) throw error;
      verifiedSignupUser = null;
      mode = 'signin'; signupStage = 1;
      redirectAfterAuthentication(data.user);
    } else if (mode === 'signup' && signupStage === 3) {
      if (!pendingSignup) throw new Error('Your verification request expired. Start signup again to request a new code.');
      const token = String(values.get('otp_code') || '').replace(/\s+/g, '');
      const response = pendingSignup.channel === 'email'
        ? await supabase.auth.verifyOtp({ email: pendingSignup.email, token, type: 'email' })
        : await supabase.auth.verifyOtp({ phone: pendingSignup.phone, token, type: 'sms' });
      if (response.error) throw response.error;
      if (!response.data?.session || !response.data?.user) throw new Error('Supabase did not return a verified account session. Check Auth confirmation settings and try again.');
      if (response.data.user.user_metadata?.signup_incomplete !== true) {
        await supabase.auth.signOut();
        throw new Error('This account was started previously. Please sign in or contact the shop for help.');
      }
      clearInterval(resendTimer);
      resendTimer = null;
      pendingSignup = null;
      verifiedSignupUser = response.data.user;
      signupStage = 2;
      updateMode();
      form.elements.full_name.focus();
      say('Email verified. Complete your account details.', 'success');
    } else {
      let credentials;
      if (identifier.includes('@')) credentials = { email: identifier.toLowerCase(), password };
      else {
        const phone = normalizedPhone(identifier);
        if (!phone) throw new Error('Enter your email address or a phone number with country code.');
        credentials = { phone, password };
      }
      const { data, error } = await supabase.auth.signInWithPassword(credentials);
      if (error) throw error;
      redirectAfterAuthentication(data.user);
    }
  } catch (error) {
    say(authErrorMessage(error), 'error');
  } finally {
    clearTimeout(slowTimer);
    button.disabled = false;
    button.textContent = button.dataset.label;
  }
});

document.querySelector('.config-alert').hidden = isSupabaseConfigured;
if (isSupabaseConfigured) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      mode = 'recovery';
      authCard.hidden = false;
      accountPanel.hidden = true;
      updateMode();
      say('Set a new password for your account.');
    } else if (session?.user && !currentUser && mode !== 'recovery' && mode !== 'signup') showAccount(session.user);
    if (!session && currentUser) {
      currentUser = null;
      customerOrders = [];
      accountPanel.hidden = true;
      authCard.hidden = false;
      if (!signingOut) say('Your session ended. Sign in again to access your account.', 'error');
    }
  });
  supabase.auth.getUser().then(({ data }) => { if (data.user) showAccount(data.user); });
  window.addEventListener('beforeunload', () => subscription.unsubscribe(), { once: true });
}
updateMode();
