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
  const selectedProvince = provinces.find((item) => item.code === localProvince.value);
  const expectedZone = selectedProvince ? { luzon: 'Luzon', visayas: 'Visayas', mindanao: 'Mindanao' }[selectedProvince.islandGroupCode] : localProvince.value === 'NCR' ? 'Luzon' : '';
  regionField.setCustomValidity(form.elements.delivery_type.value === 'local' && expectedZone && region && region !== expectedZone ? `Choose ${expectedZone} for the selected province.` : '');
  if (!region) shippingNote.textContent = 'Choose a destination region to see shipping information. The shop will contact you about shipping separately.';
  else if (!courierField.value) shippingNote.textContent = 'Choose a courier to see shipping information. The shop will contact you about shipping separately.';
  else if (courierField.value === 'lalamove') shippingNote.textContent = 'Lalamove: ₱0 delivery fee through the website. Pay the rider directly on delivery. The shop will contact you about delivery.';
  else if (international) shippingNote.textContent = `PhilPost estimated rate: ${currency(region === 'Asia' ? 3100 : 4100)}. The shop will contact you about the estimate separately. Actual cost may differ: staff will email the official proof and privately arrange any refund or request payment of the balance outside the website.`;
  else shippingNote.textContent = `J&T rates for ${region}: small items ${currency(domesticSmallRates[region])}; billiard cues ${currency(300)}; ball sets ${currency(500)}. The shop will contact you about the fee separately.`;
}
// Location lists use PSGC API data.
const addressStatus = document.querySelector('#address-status');
const addressRetry = document.querySelector('#address-retry');
const deliveryFields = document.querySelector('#delivery-fields');
const savedAddressSummary = document.querySelector('#saved-address-summary');
const localProvince = form.elements.local_province;
const localCity = form.elements.local_city;
const localBarangay = form.elements.local_barangay;
const countrySelect = form.elements.country_select;
let retryAddress = null;
let provinces = [];
let requestVersion = 0;
const psgc = 'https://psgc.gitlab.io/api';
const labelFor = (item) => item.name;
function fillLocations(select, placeholder, data) {
  select.replaceChildren(new Option(placeholder, ''));
  [...data].sort((a, b) => a.name.localeCompare(b.name)).forEach((item) => select.add(new Option(labelFor(item), item.code)));
}
async function locations(path) {
  const response = await fetch(`${psgc}/${path}/`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Location list unavailable');
  const result = await response.json();
  if (!Array.isArray(result) || !result.length) throw new Error('Location list unavailable');
  return result;
}
function updateAddressFields(local) {
  ['province', 'city', 'barangay'].forEach((part) => {
    const localInput = form.elements[`local_${part}`];
    const internationalInput = part === 'barangay' ? null : form.elements[`manual_${part}`];
    document.querySelector(`#local-${part}-label`).hidden = !local;
    localInput.disabled = !local; localInput.required = local;
    if (internationalInput) {
      document.querySelector(`#manual-${part}-label`).hidden = local;
      internationalInput.disabled = local; internationalInput.required = !local && part === 'city';
    }
  });
  addressRetry.hidden = !local || !retryAddress;
  if (!local) addressStatus.textContent = '';
}
function addressFailure(message, retry) {
  retryAddress = retry;
  if (form.elements.delivery_type.value === 'local' && !deliveryFields.hidden) {
    addressStatus.textContent = message;
    addressRetry.hidden = false;
  }
}
function addressReady() {
  retryAddress = null; addressRetry.hidden = true; addressStatus.textContent = '';
}
addressRetry.addEventListener('click', () => { if (retryAddress) retryAddress(); });
async function loadProvinces() {
  try {
    provinces = await locations('provinces');
    addressReady();
    const previousCode = localProvince.value;
    const previousName = localProvince.selectedOptions[0]?.textContent;
    fillLocations(localProvince, 'Select province / Metro Manila', [...provinces, { code: 'NCR', name: 'Metro Manila', islandGroupCode: 'luzon' }]);
    if (previousCode && ![...localProvince.options].some((option) => option.value === previousCode)) localProvince.add(new Option(previousName || previousCode, previousCode));
    if (previousCode) localProvince.value = previousCode;
  } catch {
    addressFailure('Address list could not load. Please retry.', loadProvinces);
  }
}
localProvince.addEventListener('change', async () => {
  const version = ++requestVersion;
  fillLocations(localCity, 'Loading cities…', []); fillLocations(localBarangay, 'Select city first', []);
  const selected = [...provinces, {code:'NCR', islandGroupCode:'luzon'}].find((item) => item.code === localProvince.value);
  if (!selected) { fillLocations(localCity, 'Select province first', []); return; }
  const zone = { luzon:'Luzon', visayas:'Visayas', mindanao:'Mindanao' }[selected.islandGroupCode];
  if (zone) { regionField.value = zone; updateShipping(); }
  try {
    const path = selected.code === 'NCR' ? 'regions/130000000/cities-municipalities' : `provinces/${selected.code}/cities-municipalities`;
    const list = await locations(path);
    if (version === requestVersion) { fillLocations(localCity, 'Select city / municipality', list); addressReady(); }
  } catch {
    if (version === requestVersion) addressFailure('City list could not load. Please retry.', () => localProvince.dispatchEvent(new Event('change')));
  }
});
localCity.addEventListener('change', async () => {
  const version = ++requestVersion;
  fillLocations(localBarangay, localCity.value ? 'Loading barangays…' : 'Select city first', []);
  if (!localCity.value) return;
  try {
    const list = await locations(`cities-municipalities/${localCity.value}/barangays`);
    if (version === requestVersion) { fillLocations(localBarangay, 'Select barangay', list); addressReady(); }
  } catch {
    if (version === requestVersion) addressFailure('Barangay list could not load. Please retry.', () => localCity.dispatchEvent(new Event('change')));
  }
});
// Intl provides localized country names without an external address service.
try {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const countries = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b); const name = names.of(code);
    if (name && name !== code && code !== 'PH') countries.push({ code: name, name });
  }
  fillLocations(countrySelect, 'Choose a country', countries);
  countrySelect.add(new Option('Other country', '__other__'));
} catch {
  ['Australia','Canada','China','Japan','Singapore','United Kingdom','United States','Other country'].forEach((country) => countrySelect.add(new Option(country, country === 'Other country' ? '__other__' : country)));
}
function updateOtherCountry() {
  const active = !countrySelect.disabled && countrySelect.value === '__other__';
  document.querySelector('#other-country-label').hidden = !active;
  form.elements.other_country.disabled = !active;
  form.elements.other_country.required = active;
}
countrySelect.addEventListener('change', updateOtherCountry);
function updateDeliveryType() {
  requestVersion++;
  const local = form.elements.delivery_type.value === 'local';
  document.querySelector('#country-label').hidden = local;
  countrySelect.disabled = local; countrySelect.required = !local; updateOtherCountry();
  regionField.innerHTML = local
    ? '<option value="">Select a region</option><option value="Luzon">Luzon</option><option value="Visayas">Visayas</option><option value="Mindanao">Mindanao</option>'
    : '<option value="">Choose destination zone</option><option value="Asia">Asia</option><option value="Outside Asia">Outside Asia</option>';
  updateAddressFields(local);
  updateShipping();
}
form.querySelectorAll('[name="delivery_type"]').forEach((radio) => radio.addEventListener('change', updateDeliveryType));
regionField.addEventListener('change', updateShipping);
const provincesReady = loadProvinces();
courierField.addEventListener('change', updateShipping);

async function restoreAddress(saved) {
  if (!saved || !['local', 'international'].includes(saved.delivery_type)) return;
  form.elements.delivery_type.value = saved.delivery_type;
  updateDeliveryType();
  form.elements.customer_name.value = saved.customer_name || '';
  form.elements.mobile.value = saved.mobile || '';
  form.elements.email.value = saved.email || form.elements.email.value;
  form.elements.address_line.value = saved.address_line || '';
  form.elements.postal_code.value = saved.postal_code || '';
  if (saved.delivery_type === 'international') {
    const country = [...countrySelect.options].find((option) => option.value === saved.country);
    countrySelect.value = country ? saved.country : '__other__';
    updateOtherCountry();
    if (!country) form.elements.other_country.value = saved.country || '';
    form.elements.manual_province.value = saved.province || '';
    form.elements.manual_city.value = saved.city || '';
  } else {
    if (!saved.province_code || !saved.province || !saved.city_code || !saved.city || !saved.barangay_code) throw new Error('Saved address is incomplete.');
    if (![...localProvince.options].some((option) => option.value === saved.province_code)) localProvince.add(new Option(saved.province, saved.province_code));
    localProvince.value = saved.province_code;
    fillLocations(localCity, 'Select city / municipality', [{ code: saved.city_code, name: saved.city }]);
    localCity.value = saved.city_code;
    // Older saved addresses did not store the barangay name; resolve only those from the directory.
    const barangays = saved.barangay ? [{ code: saved.barangay_code, name: saved.barangay }] : await locations(`cities-municipalities/${saved.city_code}/barangays`);
    fillLocations(localBarangay, 'Select barangay', barangays);
    localBarangay.value = saved.barangay_code;
    if (!localBarangay.value) throw new Error('Saved barangay is unavailable; please select your address again.');
  }
  regionField.value = saved.shipping_region || '';
  updateShipping();
  courierField.value = saved.courier || '';
  updateShipping();
  const deliveryInputs = [...deliveryFields.querySelectorAll('input, select')].filter((input) => !input.disabled);
  if (deliveryInputs.every((input) => input.checkValidity())) {
    const barangay = saved.delivery_type === 'local' ? localBarangay.selectedOptions[0]?.textContent : '';
    document.querySelector('#saved-address-text').textContent = [saved.customer_name, saved.mobile, saved.email, saved.address_line, barangay, saved.city, saved.province, saved.postal_code, saved.country].filter(Boolean).join(' · ');
    deliveryFields.hidden = true; savedAddressSummary.hidden = false;
    addressStatus.textContent = '';
  } else addressStatus.textContent = 'Please complete your saved delivery address.';
}
document.querySelector('#change-delivery-address').addEventListener('click', async () => {
  savedAddressSummary.hidden = true; deliveryFields.hidden = false; form.elements.customer_name.focus();
  if (form.elements.delivery_type.value !== 'local') return;
  const provinceCode = localProvince.value, cityCode = localCity.value, barangayCode = localBarangay.value;
  const version = ++requestVersion;
  try {
    await provincesReady;
    const cities = await locations(provinceCode === 'NCR' ? 'regions/130000000/cities-municipalities' : `provinces/${provinceCode}/cities-municipalities`);
    const barangays = await locations(`cities-municipalities/${cityCode}/barangays`);
    if (version !== requestVersion) return;
    fillLocations(localCity, 'Select city / municipality', cities); localCity.value = cityCode;
    fillLocations(localBarangay, 'Select barangay', barangays); localBarangay.value = barangayCode;
  } catch { if (version === requestVersion) addressStatus.textContent = 'Address choices could not be loaded. Your saved address remains available.'; }
});

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
  if (!user) { showGate('Sign in to place your order.'); document.querySelector('#signin-link').hidden = false; }
  else if (user.app_metadata?.role === 'admin') {
    showGate('Administrator accounts cannot place orders. Sign in with a customer account to shop.');
    document.querySelector('#signin-link').hidden = true;
  } else {
    document.querySelector('#signin-link').hidden = true;
    const { error: paymentTermsError } = await supabase.from('orders').select('payment_scope').limit(1);
    if (paymentTermsError) throw new Error('Checkout is temporarily unavailable while payment terms are being updated. Please contact the shop.');
    form.elements.customer_name.value = user.user_metadata?.full_name || '';
    form.elements.email.value = user.email || '';
    const { data: profile, error: profileError } = await supabase.from('profiles').select('full_name,phone,default_address').eq('id', user.id).maybeSingle();
    if (!profileError && profile) {
      form.elements.customer_name.value = profile.full_name || form.elements.customer_name.value;
      form.elements.mobile.value = profile.phone || '';
      try { await restoreAddress(profile.default_address); }
      catch { addressStatus.textContent = 'Your saved address could not be fully loaded. Please review the address fields.'; }
    } else if (profileError) {
      addressStatus.textContent = 'Saved address is unavailable. Please enter your delivery details.';
    }
    form.hidden = false;
  }
  } catch (error) {
    showGate(/payment terms are being updated/i.test(error.message || '') ? error.message : /permission|not authorized/i.test(error.message || '') ? 'Access was denied. Sign in again, then retry checkout.' : `We could not check your sign-in status. ${error.message || 'Please retry by refreshing the page.'}`);
    document.querySelector('#signin-link').hidden = /payment terms are being updated/i.test(error.message || '');
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
      p_address_line: [String(values.get('address_line')).trim(), values.get('delivery_type') === 'local' ? localBarangay.selectedOptions[0]?.textContent : ''].filter(Boolean).join(', Barangay '),
      p_city: values.get('delivery_type') === 'local' ? localCity.selectedOptions[0].textContent : String(values.get('manual_city') || '').trim(),
      p_province: values.get('delivery_type') === 'local' ? localProvince.selectedOptions[0].textContent : String(values.get('manual_province') || '').trim(),
      p_postal_code: String(values.get('postal_code')).trim(),
      p_country: values.get('delivery_type') === 'local' ? 'Philippines' : String(values.get('country_select') === '__other__' ? values.get('other_country') : values.get('country_select') || '').trim(),
      p_courier: String(values.get('courier')),
      p_payment_method: String(values.get('payment_method')),
      p_customer_note: String(values.get('customer_note') || '').trim() || null,
      p_shipping_region: String(values.get('shipping_region')),
      p_items: items.map(({ product, quantity, selected_options, options }) => ({ product_id: product.id, quantity, options: selected_options || options || {} })),
    };
    const { data: orderId, error } = await supabase.rpc('place_order', payload);
    if (error) throw error;
    localStorage.removeItem('hushley-cart');
    let addressSaveFailed = false;
    if (values.has('save_default_address')) {
      try {
      const { data: { user } } = await supabase.auth.getUser();
      const saved = { delivery_type: values.get('delivery_type'), customer_name: payload.p_customer_name, mobile: payload.p_mobile, email: payload.p_email,
        address_line: String(values.get('address_line')).trim(), city: payload.p_city, province: payload.p_province,
        postal_code: payload.p_postal_code, country: payload.p_country, shipping_region: payload.p_shipping_region, courier: payload.p_courier,
        province_code: localProvince.value, city_code: localCity.value, barangay_code: localBarangay.value,
        barangay: values.get('delivery_type') === 'local' ? localBarangay.selectedOptions[0]?.textContent || '' : '' };
      if (!user) addressSaveFailed = true;
      else { const result = await supabase.from('profiles').update({ default_address: saved }).eq('id', user.id).select('id').maybeSingle(); addressSaveFailed = !!result.error || !result.data; }
      } catch { addressSaveFailed = true; }
    }
    window.location.href = `/account.html?placed=${encodeURIComponent(orderId)}${addressSaveFailed ? '&address_save=failed' : ''}`;
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
