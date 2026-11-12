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
  announcement.textContent = text;
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
