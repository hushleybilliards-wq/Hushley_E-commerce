import { isSupabaseConfigured, supabase } from '../lib/supabase.js';

const form = document.querySelector('#auth-form');
const authCard = document.querySelector('#auth-card');
const accountPanel = document.querySelector('#account-panel');
let mode = new URLSearchParams(location.search).get('recovery') === '1' ? 'recovery' : 'signin';
let signupStage = 1;
let currentUser = null;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

function say(message, kind = '', target = mode === 'signup' ? '.signup-form-status' : '.signin-details .form-status') {
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
  if (/password.*(weak|short|length)/i.test(detail)) return 'Choose a stronger password with at least 8 characters.';
  if (/permission|row-level|not authorized/i.test(detail)) return 'Access was denied for this action. Sign in again or contact the shop if it continues.';
  if (/expired|jwt/i.test(detail)) return 'Your session expired. Sign in again and retry.';
  return detail;
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
function updateMode() {
  const signup = mode === 'signup';
  const recovery = mode === 'recovery';
  const email = form.elements.email;
  const emailField = document.querySelector('#email-field');
  const signupDetails = document.querySelector('#signup-details');
  const signinDetails = document.querySelector('#signin-details');
  const progress = document.querySelector('#signup-progress');
  const continueButton = document.querySelector('#continue-signup');
  const changeEmail = document.querySelector('#change-signup-email');
  const signupFields = ['full_name', 'phone', 'password', 'confirm_password'];
  const signupReady = signup && signupStage === 2;
  document.querySelector('#auth-title').textContent = recovery ? 'RESET PASSWORD' : signup ? 'CREATE ACCOUNT' : 'SIGN IN';
  document.querySelector('#auth-lead').textContent = recovery ? 'Choose a new password for your account.' : signup ? 'Create your Hushley Billiards Shop account.' : 'Access your Hushley Billiards Shop account.';
  document.querySelector('#switch-prompt').textContent = signup ? 'Already have an account?' : 'New to Hushley?';
  document.querySelector('#switch-mode').textContent = signup ? 'SIGN IN' : 'CREATE AN ACCOUNT';
  progress.hidden = !signup;
  signupDetails.hidden = !signupReady;
  signinDetails.hidden = signup;
  emailField.hidden = recovery;
  email.readOnly = signupReady;
  email.required = !recovery;
  continueButton.hidden = !signup || signupReady;
  changeEmail.hidden = !signupReady;
  document.querySelector('[data-progress-step="1"]').classList.toggle('is-complete', signupReady);
  document.querySelector('[data-progress-step="1"]').classList.toggle('is-current', !signupReady);
  document.querySelector('[data-progress-step="2"]').classList.toggle('is-current', signupReady);
  signupFields.forEach((name) => { const field = form.elements[name]; field.required = signupReady && ['full_name', 'phone', 'password', 'confirm_password'].includes(name); });
  form.elements.terms_accepted.required = signupReady;
  form.elements.signin_password.required = !signup;
  form.elements.password.required = signupReady;
  form.elements.password.autocomplete = recovery ? 'new-password' : 'new-password';
  form.elements.email.autocomplete = 'email';
  signupDetails.querySelector('.auth-submit').textContent = 'CREATE ACCOUNT →';
  signinDetails.querySelector('.auth-submit').textContent = recovery ? 'UPDATE PASSWORD' : 'SIGN IN →';
  signinDetails.querySelector('.auth-field > span:first-child').textContent = recovery ? 'NEW PASSWORD' : 'PASSWORD';
  form.elements.signin_password.autocomplete = recovery ? 'new-password' : 'current-password';
  form.elements.signin_password.minLength = recovery ? 8 : 0;
  form.elements.signin_password.placeholder = recovery ? 'At least 8 characters' : 'Enter your password';
  document.querySelector('.auth-switch').hidden = recovery;
  document.querySelector('#forgot-password').hidden = signup || recovery;
  document.querySelector('#forgot-password').textContent = 'FORGOT PASSWORD?';
  form.elements.password.placeholder = 'At least 8 characters';
  document.querySelector('.confirm-password-field').hidden = !signup;
  document.querySelector('.phone-field').hidden = !signup;
}
async function showAccount(user) {
  currentUser = user;
  authCard.hidden = true;
  accountPanel.hidden = false;
  document.querySelector('#account-email').textContent = user.email || '';
  document.querySelector('#admin-link').hidden = user.app_metadata?.role !== 'admin';
  if (user.app_metadata?.role === 'admin' && new URLSearchParams(location.search).get('next') === '/admin.html') location.replace('/admin.html');
  if (new URLSearchParams(location.search).get('next') === '/checkout.html') location.replace('/checkout.html');
  if (new URLSearchParams(location.search).has('placed')) document.querySelector('#order-notice').textContent = 'Order created. Confirm the final shipping total and upload payment proof below.';
  await loadOrders();
}
async function loadOrders() {
  if (!currentUser || !supabase) return;
  const host = document.querySelector('#orders-list');
  host.innerHTML = '<p class="state-loading" role="status">Loading your orders…</p>';
  let slowTimer = setTimeout(() => { host.insertAdjacentHTML('afterbegin', '<p class="slow-note">This is taking longer than usual. Your orders are still loading.</p>'); }, 7000);
  const { data, error } = await supabase.from('orders').select('id,order_number,status,total,tracking_number,shipping_confirmed,created_at').eq('customer_id', currentUser.id).order('created_at', { ascending: false });
  clearTimeout(slowTimer);
  if (error) {
    host.innerHTML = `<div class="state-error"><p>${escapeHtml(error.message || 'Your order history could not be loaded.')}</p><button class="admin-action" type="button" id="retry-orders">TRY AGAIN</button></div>`;
    host.querySelector('#retry-orders').addEventListener('click', loadOrders, { once: true });
    return;
  }
  if (!data.length) {
    host.innerHTML = '<p class="empty-orders">No orders yet. Your next game starts in the shop.</p>';
    return;
  }
  host.innerHTML = data.map((order) => `<article class="order-row"><div><strong>${escapeHtml(order.order_number)}</strong><span>${new Date(order.created_at).toLocaleDateString('en-PH')}</span>${order.tracking_number ? `<span>Tracking: ${escapeHtml(order.tracking_number)}</span>` : ''}${['pending_payment','payment_rejected'].includes(order.status) && !order.shipping_confirmed ? '<span>Waiting for the shop to confirm shipping.</span>' : ''}</div><span class="status-pill status-${escapeHtml(order.status)}">${escapeHtml(order.status.replaceAll('_', ' '))}</span><strong>${new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(order.total)}</strong>${['pending_payment','payment_rejected'].includes(order.status) && order.shipping_confirmed ? `<form class="proof-upload" data-proof-order="${escapeHtml(order.id)}"><label>Payment proof (image or PDF, up to 10 MB)<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required /></label><button class="admin-action" type="submit">UPLOAD PAYMENT PROOF</button></form>` : ''}</article>`).join('');
}

document.querySelector('#switch-mode').addEventListener('click', () => {
  mode = mode === 'signin' ? 'signup' : 'signin';
  signupStage = 1;
  say('');
  updateMode();
});
document.querySelector('#continue-signup').addEventListener('click', () => {
  const email = form.elements.email;
  email.setCustomValidity('');
  if (!email.value.trim() || !email.checkValidity()) {
    email.setCustomValidity('Enter a valid email address.');
    email.reportValidity();
    email.focus();
    return;
  }
  email.value = email.value.trim().toLowerCase();
  signupStage = 2;
  updateMode();
  form.elements.full_name.focus();
});
form.elements.email.addEventListener('input', () => form.elements.email.setCustomValidity(''));
document.querySelector('#change-signup-email').addEventListener('click', () => {
  signupStage = 1;
  updateMode();
  form.elements.email.focus();
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
  const email = form.elements.email.value.trim().toLowerCase();
  if (!email) return say('Enter your email address first.', 'error');
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/account.html?recovery=1` });
  say(error ? authErrorMessage(error) : 'If an account exists for that email, password reset instructions are on the way.', error ? 'error' : 'success');
});
document.querySelector('#refresh-orders').addEventListener('click', loadOrders);
document.querySelector('#orders-list').addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-proof-order]');
  if (!form) return;
  event.preventDefault();
  const file = form.querySelector('input[type="file"]').files[0];
  if (!file || file.size > 10 * 1024 * 1024) { orderNotice.textContent = 'Choose an image or PDF up to 10 MB.'; orderNotice.dataset.kind = 'error'; return; }
  const path = `${currentUser.id}/${form.dataset.proofOrder}/${crypto.randomUUID()}.${file.name.split('.').pop().toLowerCase()}`;
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'UPLOADING…';
  orderNotice.textContent = 'Uploading payment proof… Staff will review it manually; this does not mark the order as paid.';
  orderNotice.dataset.kind = '';
  try {
    const { error: uploadError } = await supabase.storage.from('payment-proofs').upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await supabase.rpc('submit_payment_proof', { p_order_id: form.dataset.proofOrder, p_proof_path: path });
    if (error) throw error;
    orderNotice.textContent = 'Payment proof submitted. Staff will verify it manually before the order is marked paid.';
    orderNotice.dataset.kind = 'success';
    await loadOrders();
  } catch (error) {
    orderNotice.textContent = `${error.message || 'Upload failed.'} You can try again.`;
    orderNotice.dataset.kind = 'error';
  } finally { button.disabled = false; button.textContent = 'UPLOAD PAYMENT PROOF'; }
});
document.querySelector('#sign-out').addEventListener('click', async () => {
  const { error } = await supabase.auth.signOut();
  if (error) return;
  currentUser = null;
  accountPanel.hidden = true;
  authCard.hidden = false;
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (mode === 'signup' && signupStage === 1) return document.querySelector('#continue-signup').click();
  const activeDetails = mode === 'signup' ? document.querySelector('#signup-details') : document.querySelector('#signin-details');
  for (const field of activeDetails.querySelectorAll('input[required]')) {
    field.setCustomValidity('');
    if (!field.checkValidity()) { field.reportValidity(); field.focus(); return say('Check the highlighted details and try again.', 'error'); }
  }
  if (mode === 'signup' && form.elements.password.value !== form.elements.confirm_password.value) {
    form.elements.confirm_password.setCustomValidity('Passwords do not match.');
    form.elements.confirm_password.reportValidity();
    form.elements.confirm_password.focus();
    return say('Make sure both password fields match.', 'error');
  }
  if (!isSupabaseConfigured) return say('Connect the client-owned Supabase project before using account features.', 'error');
  const values = new FormData(form);
  const email = String(values.get('email')).trim().toLowerCase();
  const password = String(mode === 'signup' ? values.get('password') : values.get('signin_password'));
  const button = mode === 'signup' ? document.querySelector('#signup-details .auth-submit') : document.querySelector('#signin-details .auth-submit');
  button.disabled = true;
  button.dataset.label = button.textContent;
  button.textContent = 'PLEASE WAIT…';
  say(mode === 'signup' ? 'Creating your account…' : mode === 'recovery' ? 'Updating your password…' : 'Signing in…');
  const pendingMessage = mode === 'signup' ? 'Creating your account…' : mode === 'recovery' ? 'Updating your password…' : 'Signing in…';
  const slowTimer = setTimeout(() => say(`${pendingMessage} This is taking longer than usual. Please keep this page open.`, ''), 7000);
  try {
    if (mode === 'recovery') {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      mode = 'signin';
      await showAccount(data.user);
      orderNotice.textContent = 'Password updated successfully.';
      orderNotice.dataset.kind = 'success';
    } else if (mode === 'signup') {
      const fullName = String(values.get('full_name')).trim();
      const phone = String(values.get('phone')).trim();
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName, phone } } });
      if (error) throw error;
      if (data.session) await showAccount(data.user);
      else say('Account created. Check your email to confirm it, then sign in.', 'success');
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await showAccount(data.user);
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
    } else if (session?.user && !currentUser && mode !== 'recovery') showAccount(session.user);
    if (!session && currentUser) {
      currentUser = null;
      accountPanel.hidden = true;
      authCard.hidden = false;
      say('Your session ended. Sign in again to access your account.', 'error');
    }
  });
  supabase.auth.getUser().then(({ data }) => { if (data.user) showAccount(data.user); });
  window.addEventListener('beforeunload', () => subscription.unsubscribe(), { once: true });
}
updateMode();
