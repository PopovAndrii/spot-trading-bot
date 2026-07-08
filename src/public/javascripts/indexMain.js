import { Theme } from './ui/Theme.js';

new UiElements.Select();
new UiElements.Button();
new Theme();

const btn = document.getElementById('sendCurrency');
let navigateUrl = null;

document.getElementById('selectCurrency')?.addEventListener('ui-select-change', (e) => {
  const { value } = e.detail;
  const symbol = value?.split('?')[0] ?? '';

  navigateUrl = value ? `/spotbot/${value}` : null;
  btn.dataset.value = symbol;
  btn.querySelector('.btn-label').textContent = symbol || 'Select currency!';

  if (value) {
    btn.removeAttribute('aria-disabled');
  } else {
    btn.setAttribute('aria-disabled', 'true');
  }
});

btn?.addEventListener('ui-button-change', () => {
  console.log('test');
  if (navigateUrl) window.location.href = navigateUrl;
});

// Donation: copy the address to the clipboard (all local, no network).
// navigator.clipboard exists only in a secure context (https/localhost);
// over http://<IP> it's absent, so we keep a fallback via execCommand.
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  if (!ok) throw new Error('execCommand copy failed');
}

document.querySelectorAll('.donate-card__copy').forEach((button) => {
  button.addEventListener('ui-button-change', async () => {
    const address = button.dataset.copy;
    const label = button.querySelector('.btn-label') ?? button;
    const original = label.textContent;
    try {
      await copyText(address);
      label.textContent = 'Copied!';
    } catch {
      label.textContent = 'Copy failed';
    }
    button.classList.add('copied');
    setTimeout(() => {
      label.textContent = original;
      button.classList.remove('copied');
    }, 1500);
  });
});

// Info blocks on the home page: the "yes" button marks a block as read (localStorage)
// and hides it; on a return visit we don't show read blocks.
(() => {
  const STORE_KEY = 'index-massege-read';
  const section = document.querySelector('.index-massege');
  const items = section ? [...section.querySelectorAll('.index-massege__item')] : [];
  if (!items.length) return;

  let read;
  try {
    read = new Set(JSON.parse(localStorage.getItem(STORE_KEY) || '[]'));
  } catch {
    read = new Set();
  }
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify([...read]));
    } catch {}
  };
  const syncSection = () => {
    if (items.every((el) => el.hidden)) section.hidden = true;
  };

  items.forEach((item) => {
    const id = item.dataset.msg;
    if (id && read.has(id)) {
      item.hidden = true;
      return;
    }
    const ack = item.querySelector('.index-massege__ack');
    ack?.addEventListener('ui-button-change', () => {
      item.hidden = true;
      if (id) {
        read.add(id);
        save();
      }
      syncSection();
    });
  });

  syncSection();
})();

// Check a key pair (real | test): the server makes the signed request.
document.querySelectorAll('[data-check]').forEach((button) => {
  button.addEventListener('ui-button-change', async (e) => {
    const env = e.detail.value;
    const status = button.closest('.api-keys__group').querySelector('.api-keys__status');

    button.disabled = true;
    button.classList.remove('success', 'danger');
    if (status) status.textContent = 'checking…';

    try {
      const res = await fetch('/check-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env }),
      });
      const data = await res.json();

      button.classList.add(data.success ? 'success' : 'danger');
      if (status) {
        status.textContent = data.success
          ? `✅ valid${data.canTrade === false ? ' (canTrade: no)' : ''}`
          : `❌ ${data.message || 'invalid'}`;
      }
    } catch (err) {
      button.classList.add('danger');
      if (status) status.textContent = `❌ ${err.message}`;
    } finally {
      button.disabled = false;
    }
  });
});
