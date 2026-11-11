import { isSupabaseConfigured, supabase } from '../lib/supabase.js';

const form = document.querySelector('#auth-form');
const authCard = document.querySelector('#auth-card');
const accountPanel = document.querySelector('#account-panel');
let mode = new URLSearchParams(location.search).get('recovery') === '1' ? 'recovery' : 'signin';
let signupStage = 1;
let recoveryStage = 1;
let recoveryEmail = '';
let currentUser = null;
let pendingSignup = null;
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
  if (/invalid.*(otp|token)|token.*(expired|invalid)|otp.*(expired|invalid)/i.test(detail)) return 'That code is invalid or expired. Check the latest code and try again.';
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
function selectedChannel() { return form.elements.signup_channel.value; }
function normalizedPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
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
  changeEmail.hidden = !signup || signupStage !== 2;
  const progressLabels = [['VERIFY CONTACT', signupStage === 1], ['DETAILS', signupStage === 2], ['CODE', signupStage === 3]];
  progressLabels.forEach(([label, active], index) => {
    const step = document.querySelector(`[data-progress-step="${index + 1}"]`);
    step.classList.toggle('is-current', active);
    step.classList.toggle('is-complete', signupStage > index + 1);
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
  const emailChannel = channel === 'email';
  const label = document.querySelector('#email-label');
  label.textContent = recovery ? 'EMAIL ADDRESS' : initialStep ? (emailChannel ? 'EMAIL ADDRESS TO VERIFY' : 'MOBILE NUMBER TO VERIFY') : (signup && !otpVisible ? (emailChannel ? 'VERIFIED EMAIL ADDRESS' : 'VERIFIED MOBILE NUMBER') : 'EMAIL OR MOBILE NUMBER');
  identifier.type = initialStep && emailChannel || recovery ? 'email' : 'text';
  identifier.inputMode = initialStep && !emailChannel ? 'tel' : 'email';
  identifier.placeholder = initialStep ? (emailChannel ? 'name@example.com' : '+63 9XX XXX XXXX') : 'Email address or +63 mobile number';
  document.querySelector('#identifier-icon').textContent = initialStep && !emailChannel ? 'call' : 'mail';
  document.querySelector('.contact-email-field').hidden = channel !== 'phone';
  document.querySelector('.phone-field').hidden = channel === 'phone';
  signupDetails.querySelector('.auth-submit').textContent = 'SEND VERIFICATION CODE →';
  document.querySelector('#verify-signup-code').textContent = 'VERIFY CODE';
  signinDetails.querySelector('.auth-submit').textContent = recovery ? 'UPDATE PASSWORD' : 'SIGN IN →';
  signinDetails.querySelector('.auth-field > span:first-child').textContent = recovery ? 'NEW PASSWORD' : 'PASSWORD';
  form.elements.signin_password.autocomplete = recovery ? 'new-password' : 'current-password';
  form.elements.signin_password.minLength = recoveryPassword ? 8 : 0;
  form.elements.signin_password.placeholder = recovery ? 'At least 8 characters' : 'Enter your password';
  document.querySelector('.auth-switch').hidden = recovery;
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
  currentUser = user;
  authCard.hidden = true;
  accountPanel.hidden = false;
  document.querySelector('#account-email').textContent = user.email || user.phone || user.user_metadata?.contact_email || '';
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
  pendingSignup = null;
  say('');
  updateMode();
});
document.querySelector('#continue-signup').addEventListener('click', () => {
  const identifier = form.elements.identifier;
  const channel = selectedChannel();
  identifier.setCustomValidity('');
  if (channel === 'email') {
    identifier.type = 'email';
    identifier.value = identifier.value.trim().toLowerCase();
    if (!identifier.value || !identifier.checkValidity()) {
      identifier.setCustomValidity('Enter a valid email address.');
      identifier.reportValidity(); identifier.focus(); return;
    }
  } else {
    const phone = normalizedPhone(identifier.value);
    if (!phone) {
      identifier.setCustomValidity('Enter a valid phone number with a country code, such as +63 9XX XXX XXXX.');
      identifier.reportValidity(); identifier.focus(); return;
    }
    identifier.value = phone;
  }
  signupStage = 2;
  updateMode();
  form.elements.full_name.focus();
});
form.elements.identifier.addEventListener('input', () => form.elements.identifier.setCustomValidity(''));
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
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/account.html?recovery=1` });
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
        const response = await supabase.auth.resetPasswordForEmail(recoveryEmail, { redirectTo: `${location.origin}/account.html?recovery=1` });
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
  if (mode === 'signup' && signupStage === 2 && form.elements.password.value !== form.elements.confirm_password.value) {
    form.elements.confirm_password.setCustomValidity('Passwords do not match.');
    form.elements.confirm_password.reportValidity();
    form.elements.confirm_password.focus();
    return say('Make sure both password fields match.', 'error');
  }
  if (mode === 'signup' && signupStage === 2 && selectedChannel() === 'email' && !normalizedPhone(form.elements.phone.value)) {
    form.elements.phone.setCustomValidity('Enter a valid mobile number, including country code.');
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
  const pendingMessage = mode === 'signup' ? (signupStage === 2 ? 'Creating your account and sending a verification code…' : 'Verifying your code…') : mode === 'recovery' ? (recoveryStage === 2 ? 'Verifying reset code…' : 'Updating your password…') : 'Signing in…';
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
      const phone = channel === 'phone' ? normalizedPhone(identifier) : normalizedPhone(String(values.get('phone')));
      const email = channel === 'email' ? identifier.toLowerCase() : String(values.get('contact_email')).trim().toLowerCase();
      const metadata = channel === 'phone' ? { full_name: fullName, phone, contact_email: email } : { full_name: fullName, phone };
      const credentials = channel === 'phone'
        ? { phone, password, options: { channel: 'sms', data: metadata } }
        : { email, password, options: { data: metadata } };
      const { data, error } = await supabase.auth.signUp(credentials);
      if (error) throw error;
      if (data.session) {
        await supabase.auth.signOut();
        throw new Error('OTP confirmation is disabled in the connected Supabase Auth settings. Enable email or phone confirmations before customers can sign up.');
      }
      pendingSignup = { channel, email, phone, destination: channel === 'email' ? email : phone };
      document.querySelector('#otp-destination').textContent = `Enter the one-time code sent to ${pendingSignup.destination}.`;
      signupStage = 3;
      updateMode();
      startResendCooldown();
      form.elements.otp_code.focus();
      say('Code sent. It must be verified before your account can sign in.', 'success');
    } else if (mode === 'signup' && signupStage === 3) {
      if (!pendingSignup) throw new Error('Your verification request expired. Start signup again to request a new code.');
      const token = String(values.get('otp_code') || '').replace(/\s+/g, '');
      const response = pendingSignup.channel === 'email'
        ? await supabase.auth.verifyOtp({ email: pendingSignup.email, token, type: 'email' })
        : await supabase.auth.verifyOtp({ phone: pendingSignup.phone, token, type: 'sms' });
      if (response.error) throw response.error;
      if (!response.data?.session || !response.data?.user) throw new Error('Supabase did not return a verified account session. Check Auth confirmation settings and try again.');
      clearInterval(resendTimer);
      resendTimer = null;
      pendingSignup = null;
      signupStage = 1;
      mode = 'signin';
      updateMode();
      await showAccount(response.data.user);
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
    } else if (session?.user && !currentUser && mode !== 'recovery' && mode !== 'signup') showAccount(session.user);
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
