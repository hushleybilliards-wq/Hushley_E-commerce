import { isSupabaseConfigured, supabase } from '../lib/supabase.js';

const form = document.querySelector('#auth-form');
const status = document.querySelector('.form-status');
const authCard = document.querySelector('#auth-card');
const accountPanel = document.querySelector('#account-panel');
const nameField = document.querySelector('.name-field');
let mode = new URLSearchParams(location.search).get('recovery') === '1' ? 'recovery' : 'signin';
let currentUser = null;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

function say(message, kind = '') {
  status.textContent = message;
  status.dataset.kind = kind;
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
  document.querySelector('#auth-title').textContent = recovery ? 'RESET PASSWORD' : signup ? 'CREATE ACCOUNT' : 'SIGN IN';
  document.querySelector('.auth-submit').textContent = recovery ? 'UPDATE PASSWORD' : signup ? 'CREATE ACCOUNT' : 'SIGN IN';
  document.querySelector('#switch-prompt').textContent = signup ? 'Already have an account?' : 'New to Hushley?';
  document.querySelector('#switch-mode').textContent = signup ? 'SIGN IN' : 'CREATE AN ACCOUNT';
  nameField.hidden = !signup;
  nameField.querySelector('input').required = signup;
  document.querySelector('.auth-switch').hidden = recovery;
  document.querySelector('#forgot-password').hidden = signup || recovery;
  form.querySelector('[name="password"]').autocomplete = signup || recovery ? 'new-password' : 'current-password';
  form.querySelector('[name="password"]').placeholder = recovery ? 'Enter a new password' : '';
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
  say('');
  updateMode();
});
document.querySelector('#forgot-password').addEventListener('click', async () => {
  if (!isSupabaseConfigured) return say('Connect the client-owned Supabase project before using password recovery.', 'error');
  const email = form.elements.email.value.trim().toLowerCase();
  if (!email) return say('Enter your email address first.', 'error');
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/account.html?recovery=1` });
  say(error ? error.message : 'If an account exists for that email, password reset instructions are on the way.', error ? 'error' : 'success');
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
  for (const field of form.querySelectorAll('input[required]')) {
    field.setCustomValidity('');
    if (!field.checkValidity()) { field.reportValidity(); field.focus(); return say('Check the highlighted details and try again.', 'error'); }
  }
  if (!isSupabaseConfigured) return say('Connect the client-owned Supabase project before using account features.', 'error');
  const values = new FormData(form);
  const email = String(values.get('email')).trim().toLowerCase();
  const password = String(values.get('password'));
  const button = document.querySelector('.auth-submit');
  button.disabled = true;
  button.dataset.label = button.textContent;
  button.textContent = 'PLEASE WAIT…';
  say(mode === 'signup' ? 'Creating your account…' : 'Signing in…');
  const pendingMessage = mode === 'signup' ? 'Creating your account…' : mode === 'recovery' ? 'Updating your password…' : 'Signing in…';
  const slowTimer = setTimeout(() => say(`${pendingMessage} This is taking longer than usual. Please keep this page open.`, ''), 7000);
  try {
    if (mode === 'recovery') {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      mode = 'signin';
      await showAccount(data.user);
      say('Password updated.', 'success');
    } else if (mode === 'signup') {
      const fullName = String(values.get('full_name')).trim();
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
      if (error) throw error;
      if (data.session) await showAccount(data.user);
      else say('Account created. Check your email to confirm it, then sign in.', 'success');
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await showAccount(data.user);
    }
  } catch (error) {
    const detail = error.message || 'We could not complete that request.';
    say(/permission|row-level|not authorized/i.test(detail) ? 'Access was denied for this action. Sign in again or contact the shop if it continues.' : /expired|jwt/i.test(detail) ? 'Your session expired. Sign in again and retry.' : detail, 'error');
  } finally {
    clearTimeout(slowTimer);
    button.disabled = false;
    button.textContent = button.dataset.label;
  }
});

document.querySelector('.config-alert').hidden = isSupabaseConfigured;
form.querySelectorAll('input,button').forEach((field) => { if (!isSupabaseConfigured) field.disabled = true; });
if (!isSupabaseConfigured) document.querySelector('#forgot-password').disabled = true;
if (!isSupabaseConfigured) document.querySelector('#switch-mode').disabled = true;
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
