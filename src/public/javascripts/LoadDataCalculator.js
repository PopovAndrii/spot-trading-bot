import { confirmDialog } from './ui/confirmDialog.js';

// Item 10 safety gate: while false, the per-order cancel button only confirms
// and toasts — it does NOT send a cancel to the exchange. Keeps a live testnet
// cycle from being broken during UI testing. Flip to true (and wire the API)
// once manual cancel is ready to go live.
const ORDER_CANCEL_ENABLED = false;

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
    })

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

  // Change button restart
  restart() {
    document.getElementById('settings-calculate-restart').addEventListener('ui-switch-change', (e) => {
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
      'pair': base + quote,
      'key': key,
      'value': value,
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
      strategyList?.querySelector('[name="strategyList"]')
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

  // Per-order manual action (Item 10) in the Buy/Sell currency cell:
  //   NEW / PARTIALLY_FILLED        → hover ✕ cancel (pull the live order)
  //   CANCELED + manual (user pull) → price-edit SpinBox + ＋ re-place
  //   FILLED / bot-CANCELED / null  → nothing
  // Re-place only appears on a USER-pulled order (manual flag), never on a
  // bot-cancelled one — those are indistinguishable by status alone, which is
  // exactly why the manual marker exists.
  // data-value carries the JSON payload; the Button manager emits
  // 'ui-button-change'. Markup only — handlers are wired separately.
  #rowAction(obj, type, index) {
    const o = obj?.[type]?.[index];
    if (!o) return '';

    // user-pulled order → SpinBox (prefilled with its price) + re-place. + lifts
    // / − drops the rate by one tick. Wide min/max so the package doesn't clamp
    // the value (per the "always clamps" SpinBox behaviour) — no real bound.
    if (o.status === 'CANCELED' && o.manual) {
      const tick = parseInt(obj.param?.['field-tickSize'], 10);
      const dec = Number.isFinite(tick) ? tick : 2;
      const step = (10 ** -dec).toFixed(dec);
      const replace = JSON.stringify({ action: 'replace', side: type, index, orderId: o.orderId ?? null });
      return `<span class="row-actions row-actions--edit">`
        + `<span class="UIsp sm round" data-step="${step}" data-min="0" data-max="100000000" data-decimals="${dec}" role="spinbutton" tabindex="0" aria-label="New price">`
        +   `<button class="UIsp__btn" type="button" aria-label="Decrease value">−</button>`
        +   `<input class="UIsp__input" type="text" value="${o.price ?? ''}" inputmode="decimal">`
        +   `<button class="UIsp__btn" type="button" aria-label="Increase value">+</button>`
        + `</span>`
        + `<button type="button" class="UIb sm g-0 success" data-value='${replace}' title="Re-place at this price">`
        +   `<svg class="icon"><use href="/sprite.svg#plus"></use></svg></button>`
        + `</span>`;
    }

    // active order → hover cancel pill
    if (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED') {
      const cancel = JSON.stringify({ action: 'cancel', side: type, index, orderId: o.orderId ?? null });
      return `<span class="row-actions"><button type="button" class="UIb sm g-0 danger"`
        + ` data-value='${cancel}' title="Cancel order">`
        + `<svg class="icon"><use href="/sprite.svg#close"></use></svg></button></span>`;
    }

    return '';
  }

  // Item 10: one delegated 'ui-button-change' listener for the per-order cancel
  // buttons. The buttons are re-created on every table re-render, but the event
  // bubbles, so a single listener on the table stays valid without rebinding
  // each row. Called once at startup (spotMain).
  rowActions() {
    const table = document.getElementById('settings-table');
    table?.addEventListener('ui-button-change', async (e) => {
      const btn = e.target.closest('.UIb[data-value]');
      if (!btn) return;

      let payload;
      try { payload = JSON.parse(btn.dataset.value); } catch { return; }

      if (payload.action === 'cancel') {
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
            'warning', 6000
          );
          return;
        }
        // Real cancel: send to this symbol's bot via WS (SpotWS sets the
        // callback). The bot cancels on the exchange and marks the order
        // manual:true so the engine won't re-place it.
        this.onCancelOrder?.({ side: payload.side, index: payload.index, orderId: payload.orderId });
        return;
      }

      if (payload.action === 'replace') {
        // new price comes from the row's SpinBox (prefilled with the old price,
        // adjusted by the user with +/-)
        const input = btn.closest('.row-actions')?.querySelector('.UIsp__input');
        const price = input ? input.value : '';

        const ok = await confirmDialog({
          title: 'Re-place this order?',
          message: `${payload.side} order #${payload.index + 1} will be placed on the exchange at ${price}.`,
          confirmLabel: 'Re-place',
        });
        if (!ok) return;

        if (!ORDER_CANCEL_ENABLED) {
          this.notifications.showNotification(
            `🧪 Stub: ${payload.side} #${payload.index + 1} not re-placed at ${price} (manual cancel disabled)`,
            'warning', 6000
          );
          return;
        }
        this.onReplaceOrder?.({ side: payload.side, index: payload.index, orderId: payload.orderId, price });
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

      // Build the whole tbody as one string, then write it once. `innerHTML += row`
      // per iteration re-parses the entire tbody every time (O(n²)) and is the cause
      // of the lag. One assignment also atomically replaces the old rows (no flash).
      let html = '';
      data['calculator'].forEach((el, index) => {
        const buyAct = this.#rowAction(obj, 'BUY', index);
        const sellAct = this.#rowAction(obj, 'SELL', index);
        html += `<tr>
              <th class="center">${index + 1}</th>
              <td>${el.overlapRange}</td>
              <td class="${buyAct ? 'act-cell' : ''}"><span class="fill-cell">${el.buyCurrency}${this.#fillBadge(obj, 'BUY', index, 'price')}</span>${buyAct}</td>
              <td class="${this.#backlight(obj, 'BUY', index)}"><span class="fill-cell">${el.buy}${this.#fillBadge(obj, 'BUY', index, 'qty')}</span></td>
              <td class="${this.#backlight(obj, 'SELL', index)}"><span class="fill-cell">${el.totalSell}${this.#fillBadge(obj, 'SELL', index, 'qty')}</span></td>
              <td class="${sellAct ? 'act-cell' : ''}"><span class="fill-cell">${el.sellCurrency}${this.#fillBadge(obj, 'SELL', index, 'price')}</span>${sellAct}</td>
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

      document.querySelector('#settings-table tbody').innerHTML = html; // single DOM write

      // Re-bind the ui-elements buttons + SpinBoxes (Item 10 cancel/re-place)
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
      // 409 = server write lock: cycle is running (req 15). Surface as warning,
      // not a green "success".
      this.notifications.showNotification(data.message, res.ok ? 'success' : 'warning', 10000);
    } catch (err) {
      console.error('❌ settingsSave():', err);
      return null;
    }
  }

  async addRestartStatus(value) {
    const obj = {
      "pair": base + quote,
      "restart": value
    }

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
