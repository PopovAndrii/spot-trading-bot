import { confirmDialog } from './ui/confirmDialog.js';
import { priceDialog } from './ui/priceDialog.js';

// Safety gate: while false, the per-order cancel button only confirms
// and toasts — it does NOT send a cancel to the exchange. Keeps a live testnet
// cycle from being broken during UI testing. Flip to true (and wire the API)
// once manual cancel is ready to go live.
const ORDER_CANCEL_ENABLED = true;

export class LoadDataCalculator {
  constructor(notifications, colors = {}) {
    this.listenerStatus = true;
    this.defaultData = {};
    this.notifications = notifications;
    this._ignoreSelectChange = false;
    this.onRestartChange = null;
    this.onCancelOrder = null; // set by SpotWS — sends a 'cancelOrder' WS message
    this.onReplaceOrder = null; // set by SpotWS — sends a 'replaceOrder' WS message
    this._calcSeq = 0; // sequence token: drop stale async calculator() renders

    // Orders whose manual cancel is in flight ("side:index"). The table
    // re-renders every tick and recreates the ✕ button, so a one-off node.disabled
    // is lost; we re-render ✕ disabled while the key is here, until the order turns
    // CANCELED+manual (✕ becomes ＋) and the key is dropped.
    this._pendingCancel = new Set();

    // Change any button settings param
    document.querySelector('#group-spinbox').addEventListener('ui-spinbox-change', (e) => {
      if (this.getListenerStatus()) {
        this.getSettings();
        this.strategy = document.getElementById('field-strategy').value;
        this.calculator();
      } else {
        this.notifications.showNotification(
          'Calculator is locked. <br>Press the "Stop" button.',
          'warning',
          3000
        );
      }
    });

    // Change claculate button
    document.querySelector('#settings-calculate').addEventListener('ui-button-change', () => {
      if (this.getListenerStatus()) {
        this.getSettings();
        this.strategy = document.getElementById('field-strategy').value;
        this.calculator();
      } else {
        this.notifications.showNotification(
          'Calculator is locked. <br>Press the "Stop" button.',
          'warning',
          10000
        );
      }
    });

    // set algoritm strategy
    const select = document.getElementById('strategyList');
    select?.addEventListener('ui-select-change', (e) => {
      if (this._ignoreSelectChange) {
        this._ignoreSelectChange = false;
        return;
      }

      const hasStrategy = typeof this.strategy === 'string' && this.strategy.length > 0;
      if (!hasStrategy) return;

      if (this.getListenerStatus()) {
        this.getSettings();
        this.strategy = document.getElementById('field-strategy').value;
        this.calculator();
      } else {
        this.notifications.showNotification(
          'Calculator is locked. <br>Press the "Stop" button.',
          'warning',
          10000
        );
      }
    });

    this.orderType = colors;
  }

  setListenerStatus(status = false) {
    this.listenerStatus = status == false ? true : false;
  }

  ignoreNextSelectChange() {
    this._ignoreSelectChange = true;
  }

  getListenerStatus() {
    return this.listenerStatus;
  }

  calculate(obj) {
    this.getSettings();
    this.strategy = document.getElementById('field-strategy').value;
    this.calculator(obj);
  }

  save() {
    document.getElementById('settings-calculate-save').addEventListener('ui-button-change', () => {
      if (this.getListenerStatus()) {
        this.settingsSave();
      } else {
        this.notifications.showNotification(
          'Save is locked. Press the "Pause" button.',
          'warning',
          10000
        );
      }
    });
  }

  // Expert Mode gate. The per-order cancel (✕) / re-place (＋) controls
  // in the grid table are hidden until the Expert switch is on. The switch only
  // toggles an .expert-on class on the table; the buttons themselves are still
  // rendered every tick, so CSS — not per-render JS — does the show/hide (the
  // class lives on the stable table node, surviving the re-render).
  expertMode() {
    const sw = document.getElementById('settings-expert-mode');
    const input = document.getElementById('expert');
    const table = document.getElementById('settings-table');
    if (!sw || !table) return;

    const apply = (on) => {
      const isOn = Boolean(on);
      table.classList.toggle('expert-on', isOn);
      // danger accent on the switch itself while the controls are unlocked
      sw.classList.toggle('danger', isOn);
    };

    apply(input?.checked);
    sw.addEventListener('ui-switch-change', (e) => {
      apply(String(e.detail?.value) === 'true');
    });
  }

  // Change button restart
  restart() {
    document
      .getElementById('settings-calculate-restart')
      .addEventListener('ui-switch-change', (e) => {
        this.addRestartStatus(e.detail.value);
      });
  }

  runtimeParams() {
    const keys = ['field-activeOrders', 'field-requestFrequency'];
    document.addEventListener('ui-spinbox-change', (e) => {
      const key = e.detail?.id;
      if (!keys.includes(key)) return;
      this.saveRuntimeParam(key, e.detail.value);
    });
  }

  async saveRuntimeParam(key, value) {
    const obj = {
      pair: base + quote,
      key: key,
      value: value,
    };

    try {
      const res = await fetch(`/spotbot/calculator/param`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: obj }),
      });

      const data = await res.json();
      this.notifications.showNotification(data.message, res.ok ? 'success' : 'warning', 5000);
    } catch (err) {
      console.error('❌ saveRuntimeParam():', err);
      return null;
    }
  }

  getSettings() {
    const strategyList = document.querySelector('[id^="strategyList"]');

    const all = [
      ...document.querySelectorAll('[id^="field-"]'),
      strategyList?.querySelector('[name="strategyList"]'),
    ].filter(Boolean); // Remove null if element is not found

    all.forEach((el) => {
      const key = el.id || el.getAttribute('name');
      if (key) {
        this.defaultData[key] = el.value;
      }
    });
  }

  #backlight(obj, type, index) {
    if (Object.keys(obj).length === 0) return null;

    return this.orderType[obj[type][index]['status']];
  }

  // Badge showing the ACTUAL order execution based on the column value:
  //   kind „price“ → actual average price (cummulativeQuoteQty / executedQty)
  //   kind „qty“   → actual executed volume (executedQty)
  // Show only if the order has actually executed (executedQty > 0).
  #fillBadge(obj, type, index, kind) {
    if (!obj || Object.keys(obj).length === 0) return '';
    const o = obj[type]?.[index];
    if (!o) return '';
    const exec = Number(o.executedQty) || 0;
    if (exec <= 0) return '';
    const quote = Number(o.cummulativeQuoteQty) || 0;
    const p = obj.param || {};

    let out;
    if (kind === 'price') {
      const tick = parseInt(p['field-tickSize'], 10);
      const price = quote / exec;
      out = Number.isFinite(tick) ? price.toFixed(tick) : String(price);
    } else {
      const step = parseInt(p['field-stepSize'], 10);
      out = Number.isFinite(step) ? exec.toFixed(step) : String(exec);
    }
    return `<span class="fill-badge" title="real ${kind}">${out}</span>`;
  }

  // A live order may rest at a price different from the planned grid
  // price — a manual re-place. The column shows the plan (el.buyCurrency), so
  // surface the order's ACTUAL resting price as a badge; otherwise the table
  // lies (old price visible while the engine polls the new one). Only for live
  // orders (NEW/PARTIALLY_FILLED), compared at tick precision so an unchanged
  // order shows no badge.
  #currentPriceBadge(obj, type, index, gridPrice) {
    const o = obj?.[type]?.[index];
    if (!o || o.price == null) return '';
    if (o.status !== 'NEW' && o.status !== 'PARTIALLY_FILLED') return '';
    const tick = parseInt(obj.param?.['field-tickSize'], 10);
    const dec = Number.isFinite(tick) ? tick : 2;
    const actual = Number(o.price);
    const grid = Number(gridPrice);
    if (!Number.isFinite(actual) || !Number.isFinite(grid)) return '';
    if (actual.toFixed(dec) === grid.toFixed(dec)) return ''; // unchanged → no badge
    return `<span class="fill-badge price-badge" title="current price (re-placed)">${actual.toFixed(dec)}</span>`;
  }

  // Per-order manual action in the Buy/Sell currency cell:
  //   NEW / PARTIALLY_FILLED        → hover ✕ cancel (pull the live order)
  //   CANCELED + manual (user pull) → ＋ re-place (opens a price-editor popup)
  //   FILLED / bot-CANCELED / null  → nothing
  // Re-place only appears on a USER-pulled order (manual flag), never on a
  // bot-cancelled one — those are indistinguishable by status alone, which is
  // exactly why the manual marker exists. The new price is entered in a popup
  // (priceDialog), NOT inline: the table re-renders every tick and would reset an
  // in-row SpinBox mid-edit. The button only carries the data the popup needs.
  // data-value carries the JSON payload; the Button manager emits
  // 'ui-button-change'. Markup only — handlers are wired separately.
  #rowAction(obj, type, index, gridPrice) {
    const o = obj?.[type]?.[index];
    if (!o) return '';
    const key = `${type}:${index}`;

    // user-pulled order → ＋ opens the price editor (prefilled with this price,
    // showing the planned price as the "was" reference; step = one tick).
    if (o.status === 'CANCELED' && o.manual) {
      this._pendingCancel.delete(key); // cancel landed → stop holding the ✕
      const tick = parseInt(obj.param?.['field-tickSize'], 10);
      const dec = Number.isFinite(tick) ? tick : 2;
      const replace = JSON.stringify({
        action: 'replace',
        side: type,
        index,
        orderId: o.orderId ?? null,
        price: o.price ?? '',
        grid: gridPrice ?? '',
        dec,
      });
      return (
        `<span class="row-actions row-actions--edit">` +
        `<button type="button" class="UIb xsm r-round success" data-value='${replace}' title="Re-place at a new price">` +
        `+</button>` +
        `</span>`
      );
    }

    // manual cancel in flight → hold a DISABLED ✕ until ＋ appears. Held through
    // every transient state in between (NEW still live, CANCELED before `manual`
    // is stamped, engine blips), so the per-tick re-render never shows a clickable
    // ✕ mid-cancel. Cleared only by the ＋ branch above, or by clearPendingCancel
    // on a failed cancel (SpotWS).
    if (this._pendingCancel.has(key)) {
      return (
        `<span class="row-actions"><button type="button" class="UIb xsm r-round danger"` +
        ` disabled title="Cancelling…">` +
        `x</button></span>`
      );
    }

    // active order → hover cancel pill
    if (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED') {
      const cancel = JSON.stringify({
        action: 'cancel',
        side: type,
        index,
        orderId: o.orderId ?? null,
      });
      return (
        `<span class="row-actions"><button type="button" class="UIb xsm r-round danger"` +
        ` data-value='${cancel}' title="Cancel order">` +
        `x</button></span>`
      );
    }

    return '';
  }

  // Release a held ✕ when its manual cancel FAILED (SpotWS calls this on
  // a cancelOrderResult with success:false) — the order is still live, so the
  // next render must show a clickable ✕ again for a retry. On success we do NOT
  // clear here: the ＋ branch clears it when CANCELED+manual renders, avoiding a
  // clickable-✕ flash in the gap before the status flips.
  clearPendingCancel(side, index) {
    this._pendingCancel.delete(`${side}:${index}`);
  }

  // One delegated 'ui-button-change' listener for the per-order cancel
  // buttons. The buttons are re-created on every table re-render, but the event
  // bubbles, so a single listener on the table stays valid without rebinding
  // each row. Called once at startup (spotMain).
  rowActions() {
    const table = document.getElementById('settings-table');
    table?.addEventListener('ui-button-change', async (e) => {
      const btn = e.target.closest('.UIb[data-value]');
      if (!btn) return;

      let payload;
      try {
        payload = JSON.parse(btn.dataset.value);
      } catch {
        return;
      }

      // Expert Mode gate is server-enforced, not only CSS: emit a manual order op
      // only while the switch is on (source of truth = .expert-on on the table).
      // Buttons are hidden otherwise, so this also drops a stray/replayed event.
      // The flag travels to the bot, which rejects cancel/replace without it.
      const expertOn = table.classList.contains('expert-on');
      if ((payload.action === 'cancel' || payload.action === 'replace') && !expertOn) {
        this.notifications.showNotification(
          'Enable Expert Mode to manage individual orders',
          'warning',
          5000
        );
        return;
      }

      if (payload.action === 'cancel') {
        // already cancelling this one (button held disabled across re-renders)
        if (this._pendingCancel.has(`${payload.side}:${payload.index}`)) return;

        const ok = await confirmDialog({
          title: 'Cancel this order?',
          message: `${payload.side} order #${payload.index + 1} will be cancelled on the exchange.`,
          confirmLabel: 'Cancel order',
          danger: true,
        });
        if (!ok) return;

        if (!ORDER_CANCEL_ENABLED) {
          this.notifications.showNotification(
            `🧪 Stub: ${payload.side} #${payload.index + 1} not cancelled (manual cancel disabled)`,
            'warning',
            6000
          );
          return;
        }
        // Real cancel: send to this symbol's bot via WS (SpotWS sets the
        // callback). The bot cancels on the exchange and marks the order
        // manual:true so the engine won't re-place it.
        this.onCancelOrder?.({
          side: payload.side,
          index: payload.index,
          orderId: payload.orderId,
          expert: true,
        });
        // Hold the ✕ disabled until the order turns CANCELED+manual (✕ → ＋):
        // the key survives the per-tick re-render (node.disabled would not), and
        // the current node is disabled too for instant feedback before re-render.
        this._pendingCancel.add(`${payload.side}:${payload.index}`);
        btn.setAttribute('disabled', '');
        return;
      }

      if (payload.action === 'replace') {
        // New price is entered in a popup (not inline): the table re-renders each
        // tick and would reset an in-row SpinBox. Prefilled with the order price,
        // step = one tick, planned price shown as the "was" reference.
        const dec = Number.isFinite(payload.dec) ? payload.dec : 2;
        const step = (10 ** -dec).toFixed(dec);
        const price = await priceDialog({
          title: `Re-place ${payload.side} #${payload.index + 1}`,
          message: 'Set a new price for this order.',
          price: payload.price,
          originalPrice: payload.grid,
          step,
          decimals: dec,
          confirmLabel: 'Re-place',
        });
        if (price == null) return; // dismissed

        if (!ORDER_CANCEL_ENABLED) {
          this.notifications.showNotification(
            `🧪 Stub: ${payload.side} #${payload.index + 1} not re-placed at ${price} (manual cancel disabled)`,
            'warning',
            6000
          );
          return;
        }
        this.onReplaceOrder?.({
          side: payload.side,
          index: payload.index,
          orderId: payload.orderId,
          price,
          expert: true,
        });
        return;
      }
    });
  }

  async calculator(obj = {}) {
    // Bump the token for this call. If a newer call starts while we await the
    // fetch, ours becomes stale and must not touch the DOM (prevents the
    // duplicated/“double” table from overlapping rapid recalcs).
    const seq = ++this._calcSeq;
    try {
      const res = await fetch(`/spotbot/calculator/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: this.strategy, settings: this.defaultData }),
      });

      const data = await res.json();

      if (seq !== this._calcSeq) return; // superseded by a newer recalc → drop

      orders = {
        id: 'hash-hash',
        status: 0, // 0 - calc(can deletad), 1 - in process, 3 - not done(error etc)
        pair: base + quote,
        param: {},
        date_added: new Date().toISOString(),
        date_modified: null,
        BUY: [],
        SELL: [],
      };

      // Build each row indexed by its logical order index, then join once. `innerHTML += row`
      // per iteration re-parses the entire tbody every time (O(n²)) and is the cause
      // of the lag. One assignment also atomically replaces the old rows (no flash).
      // Short strategy: the grid reads top-down as a fall (safety buys) on long, but
      // unnaturally so on short — flip the VISUAL row order only (rows.reverse()) so the
      // first order sits at the bottom and safety sells climb upward. Data binding stays
      // keyed by `index` (order number, badges, status backlight, cancel/replace
      // side:index), so only the DOM order changes — numbering keeps index+1 (№1 bottom).
      const rows = [];
      data['calculator'].forEach((el, index) => {
        const buyAct = this.#rowAction(obj, 'BUY', index, el.buyCurrency);
        const sellAct = this.#rowAction(obj, 'SELL', index, el.sellCurrency);
        rows[index] = `<tr>
              <th class="center">${index + 1}</th>
              <td>${el.overlapRange}</td>
              <td class="${buyAct ? 'act-cell' : ''}"><span class="fill-cell">${el.buyCurrency}${this.#currentPriceBadge(obj, 'BUY', index, el.buyCurrency)}${this.#fillBadge(obj, 'BUY', index, 'price')}</span>${buyAct}</td>
              <td class="${this.#backlight(obj, 'BUY', index)}"><span class="fill-cell">${el.buy}${this.#fillBadge(obj, 'BUY', index, 'qty')}</span></td>
              <td class="${this.#backlight(obj, 'SELL', index)}"><span class="fill-cell">${el.totalSell}${this.#fillBadge(obj, 'SELL', index, 'qty')}</span></td>
              <td class="${sellAct ? 'act-cell' : ''}"><span class="fill-cell">${el.sellCurrency}${this.#currentPriceBadge(obj, 'SELL', index, el.sellCurrency)}${this.#fillBadge(obj, 'SELL', index, 'price')}</span>${sellAct}</td>
              <td>${el.didBuy}</td>
              <td>${el.calcBalance}</td>
          </tr>`;

        orders['BUY'][index] = {
          status: null,
          symbol: base + quote,
          side: 'BUY',
          type: 'LIMIT',
          quantity: el.buy,
          price: el.buyCurrency,
          timeInForce: 'GTC',
          orderId: null,
        };

        orders['SELL'][index] = {
          status: null,
          symbol: base + quote,
          side: 'SELL',
          type: 'LIMIT',
          quantity: el.totalSell,
          price: el.sellCurrency,
          timeInForce: 'GTC',
          orderId: null,
        };
      });

      // Short: flip visual order so №1 ends up at the bottom (safety sells climb up).
      if (this.strategy === 'short') rows.reverse();
      document.querySelector('#settings-table tbody').innerHTML = rows.join(''); // single DOM write

      // Re-bind the ui-elements buttons + SpinBoxes (manual cancel/re-place)
      // freshly rendered into the new rows. scan() skips already-bound nodes, so
      // this is cheap and idempotent on every tick.
      UiElements.getButtonManager().scan();
      UiElements.getSpinBoxManager().scan();
    } catch (err) {
      console.error('❌ calculator():', err);
      return null;
    }
  }

  async settingsSave() {
    orders.param = this.defaultData;
    const restartInput = document
      .getElementById('settings-calculate-restart')
      ?.querySelector('input');
    orders.restart = Boolean(restartInput?.checked);

    try {
      const res = await fetch(`/spotbot/calculator/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: orders }),
      });

      const data = await res.json();
      // 409 = server write lock: cycle is running. Surface as warning,
      // not a green "success".
      this.notifications.showNotification(data.message, res.ok ? 'success' : 'warning', 10000);
    } catch (err) {
      console.error('❌ settingsSave():', err);
      return null;
    }
  }

  async addRestartStatus(value) {
    const obj = {
      pair: base + quote,
      restart: value,
    };

    try {
      const res = await fetch(`/spotbot/calculator/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: obj }),
      });

      const data = await res.json();
      this.notifications.showNotification(data.message, 'success', 10000);
      if (this.onRestartChange) this.onRestartChange(value);
    } catch (err) {
      console.error('❌ addRestartStatus(value):', err);
      return null;
    }
  }
}
