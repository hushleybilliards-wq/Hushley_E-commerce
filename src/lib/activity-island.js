import '../styles/activity-island.css';

// Mirror the app's existing status messages visually without announcing them twice.
const feedbackSelector = '.toast, #admin-status, .form-status, #address-status, #checkout-gate, #account-connection, #connection-state, #checkout-connection, #option-builder-status, .product-option-error, [data-product-save-status], [data-tracking-status]';
const island = document.createElement('div');
island.className = 'activity-island';
island.setAttribute('aria-hidden', 'true');
if (typeof island.showPopover === 'function') island.setAttribute('popover', 'manual');
const icon = document.createElement('span'); icon.className = 'activity-island-icon';
const content = document.createElement('span'); content.className = 'activity-island-content';
const title = document.createElement('strong'); const message = document.createElement('span');
content.append(title, message); island.append(icon, content); document.body.append(island);
const announcement = document.createElement('div');
announcement.className = 'activity-island-announcement';
announcement.setAttribute('role', 'status'); announcement.setAttribute('aria-live', 'polite');
document.body.append(announcement);
let hideTimer;
// Keep the full instructions in the page while using concise notification copy.
const shortMessages = new Map([
  ['Connection restored. The dashboard will update automatically.', 'Back online. Dashboard updates resumed.'],
  ['Connection restored. Your orders will update automatically.', 'Back online. Order updates resumed.'],
  ['Automatic updates are temporarily unavailable. Your existing data is still shown.', 'Updates unavailable. Showing existing data.'],
  ['Could not update the catalog. We will try again.', 'Catalog update failed. Retrying.'],
  ['Could not update your orders. We will try again.', 'Order update failed. Retrying.'],
  ['Your orders have been updated.', 'Orders updated.'],
  ['You are offline. Reconnect to sign in, load orders, or upload payment proof.', 'You are offline. Reconnect to continue.'],
  ['You are offline. Reconnect before placing your order; your cart is saved on this device.', 'You are offline. Reconnect to order.'],
  ['Your session ended. Sign in again to access your account.', 'Session ended. Sign in again.'],
  ['Your email is verified. Complete your account details.', 'Email verified. Complete your details.'],
  ['Email verified. Complete your account details.', 'Email verified. Complete your details.'],
  ['Code sent. Verify your email to continue.', 'Code sent. Check your email.'],
  ['If an account exists for that email, a password reset code is on the way.', 'If the account exists, a reset code is on its way.'],
  ['If an account exists for that email, a new password reset code is on the way.', 'If the account exists, a new reset code is on its way.'],
  ['Check the highlighted details and try again.', 'Check the highlighted fields.'],
  ['Make sure both password fields match.', 'Passwords do not match.'],
  ['Enter a valid mobile number so the shop can contact you about delivery.', 'Enter a valid mobile number.'],
  ['Product is unavailable. Refresh the catalog.', 'Product unavailable. Refresh the catalog.'],
  ['No payment proof is available for this order.', 'No payment proof for this order.'],
  ['This product has reserved stock. Complete or cancel its orders before deleting it.', 'Reserved stock remains. Complete or cancel its orders first.'],
  ['This product has inventory history and cannot be deleted. Unpublish it instead.', 'Product has inventory history. Unpublish it instead.'],
  ['Payment manually approved and inventory updated.', 'Payment approved. Inventory updated.'],
  ['Payment proof rejected and stock hold released.', 'Payment rejected. Stock released.'],
  ['Shipping details saved. Contact and payment are handled separately.', 'Shipping saved. Arrange payment separately.'],
  ['Shipping quote confirmed. The order total follows the stored quote.', 'Shipping quote confirmed.'],
  ['Stock must be a whole number and cannot be below reserved stock.', 'Enter a whole number at or above reserved stock.'],
  ['Could not save your address. Please try again.', 'Address not saved. Try again.'],
  ['Address choices could not be loaded. Your saved address remains available.', 'Address choices unavailable. Your saved address is still available.'],
  ['Your saved address could not be fully loaded. Please review the address fields.', 'Review your saved address details.'],
  ['Saved address is unavailable. Please enter your delivery details.', 'Saved address unavailable. Enter delivery details.'],
  ['This is taking longer than usual. Keep this page open while we finish placing your order.', 'Order is taking longer. Keep this page open.'],
]);
function category(node, text) {
  const kind = (node.dataset.kind || '').toLowerCase();
  if (/^(saving|submitting|placing|checking|sending|loading|uploading|confirming|reviewing|deleting|refreshing)\b/i.test(text)) return 'pending';
  if (['error', 'warning', 'danger'].includes(kind)) return 'warning';
  if (kind === 'success') return 'success';
  if (/^(choose|enter|select)\b/i.test(text) || /\b(error|failed|unable|invalid|expired|denied|offline|rejected|cannot|can’t|can't|could not|not saved|not available|out of stock|too many|must|please (?:enter|choose|select|check))\b/i.test(text)) return 'warning';
  if (/\b(saving|submitting|placing|checking|sending|loading|uploading|confirming|reviewing|deleting|refreshing)\b/i.test(text)) return 'pending';
  if (/\b(saved|updated|added|approved|restored|success|completed|confirmed|cancelled|deleted|submitted|sent|received|removed)\b/i.test(text)) return 'success';
  return 'info';
}
function showActivity(text, kind) {
  clearTimeout(hideTimer);
  text = shortMessages.get(text) || text;
  island.dataset.kind = kind;
  icon.textContent = ({ success: '✓', warning: '!', pending: '…', info: 'i' })[kind];
  title.textContent = ({ success: 'Done', warning: 'Attention', pending: 'Working', info: 'Update' })[kind];
  message.textContent = text;
  if (island.hasAttribute('popover') && !island.matches(':popover-open')) { try { island.showPopover(); } catch { /* Dialog state may prevent opening; inline feedback remains available. */ } }
  island.classList.add('is-visible');
  hideTimer = setTimeout(() => { island.classList.remove('is-visible'); if (island.hasAttribute('popover') && island.matches(':popover-open')) island.hidePopover(); }, kind === 'warning' ? 9000 : 5500);
}
export function notifyActivity(text, kind = 'info') {
  if (!text) return;
  showActivity(text, kind);
  announcement.textContent = shortMessages.get(text) || text;
}
const observer = new MutationObserver((records) => {
  const changed = new Set();
  for (const record of records) {
    const node = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
    const source = node?.closest(feedbackSelector);
    if (source) changed.add(source);
  }
  for (const source of changed) {
    if (!source.isConnected || source.closest('[hidden]')) continue;
    const text = source.textContent.trim().replace(/\s+/g, ' ');
    if (text) showActivity(text, category(source, text));
  }
});
observer.observe(document.body, { subtree: true, childList: true, characterData: true });
