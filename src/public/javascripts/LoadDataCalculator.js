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

    // The hybrid params sit outside #group-spinbox (they are runtime decisions, not
    // build inputs — see the view), so the recompute above does not see them. While
    // the robot is IDLE they still have to redraw the table: Micro profit % moves the
    // displayed micro column. While it RUNS they are written straight to the live
    // cycle by runtimeParams(), and the table is owned by the robot's own tick.
    document.querySelector('#group-hybrid')?.addEventListener('ui-spinbox-change', () => {
      if (!this.getListenerStatus()) return;
      this.getSettings();
      this.strategy = document.getElementById('field-strategy').value;
      this.calculator();
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

  // Params the robot re-reads every tick, so an edit lands on the LIVE cycle. Written
  // ALWAYS, running or not: the robot picks the value up on its next tick, or off the
  // file on Start. (Guarding a write on "running" is what made "Grid from order" look
  // dead — the value went nowhere while the robot was stopped.)
  //
  // "Grid from order" is special only in WHERE it lands: an edit re-aims the live
  // scalp floor (field-gridArm) — that is how you say "not this order, wait for a
  // deeper one" — and leaves the saved field-gridLevel config alone, so the next
  // cycle starts from your own value again. A fresh Save rebuilds param from the
  // form, which has no field-gridArm, so a new ladder always obeys the config.
  runtimeParams() {
    const keys = {
      'field-activeOrders': 'field-activeOrders',
      'field-requestFrequency': 'field-requestFrequency',
      'field-microProfit': 'field-microProfit',
      'field-gridExit': 'field-gridExit',
      'field-gridLevel': 'field-gridArm',
    };

    document.addEventListener('ui-spinbox-change', (e) => {
      const target = keys[e.detail?.id];
      if (!target) return;
      this.saveRuntimeParam(target, e.detail.value);
    });
  }

  async saveRuntimeParam(key, value) {
    const obj = {
      pair: base + quote,
      key: key,
      value: value,
    };

    try {
      const res = await fetch('/spotbot/calculator/param', {
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

    // Hybrid grid: the switch is the source of truth (no hidden field-* input).
    // Serialize it into param as 'on'/'off' so the engine can read field-hybrid.
    this.defaultData['field-hybrid'] = document.getElementById('hybrid')?.checked ? 'on' : 'off';
  }

  // Wire the Hybrid-grid switch. It means two different things depending on the
  // cycle:
  //   idle — a build param: toggling recomputes the grid (the micro take-profit
  //     column depends on it), like a settings SpinBox change.
  //   running — a LIVE switch: the ladder must not be rebuilt, so the flip goes
  //     straight to the running cycle (switchHybrid). This is the point of it —
  //     you arm the scalp when you SEE the price oscillating on a deep order, and
  //     disarm it when you don't; the engine picks the change up on the next tick.
  hybrid() {
    const sw = document.getElementById('settings-hybrid');
    this.toggleHybridFields();
    sw?.addEventListener('ui-switch-change', (e) => {
      this.toggleHybridFields();

      if (!this.getListenerStatus()) {
        this.switchHybrid(Boolean(e.detail?.value));
        return;
      }

      this.getSettings();
      this.strategy = document.getElementById('field-strategy').value;
      this.calculator();
    });
  }

  // Flip the hybrid on the RUNNING cycle: param only, no rebuild. Arming aims the
  // scalp at the order the price is stuck on and returns that level — show it in
  // "Grid from order" so the user can see where it landed and retype it.
  async switchHybrid(on) {
    try {
      const res = await fetch('/spotbot/calculator/hybrid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { pair: base + quote, on } }),
      });

      const data = await res.json();

      // Direct .value, never spinBox.setValue: the package clamps to data-min/max
      // and does not emit ui-spinbox-change — which is what we want, the level is
      // already saved and echoing it back would re-post it.
      const level = document.getElementById('field-gridLevel');
      if (level && data.level) level.value = String(data.level);

      this.notifications.showNotification(data.message, res.ok ? 'success' : 'warning', 6000);
    } catch (err) {
      console.error('❌ switchHybrid():', err);
      return null;
    }
  }

  // The hybrid-only params (Grid from order / Micro profit % / Grid exit %)
  // are meaningful only while Hybrid grid is on, so the switch shows/hides
  // their row. Inline display beats the .line stylesheet rule when hiding and
  // reverts to it when shown. Call on init, on switch-change, and after the
  // file loader restores the switch.
  toggleHybridFields() {
    const on = document.getElementById('hybrid')?.checked;
    const group = document.getElementById('group-hybrid');
    if (group) group.style.display = on ? '' : 'none';
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

  // Per-rung micro-fire counter: how many times THIS rung's micro close fired
  // (bumped by the engine on every re-arm and stored on the close order itself —
  // long: SELL, short: BUY). Shown right in the close-price cell of that row.
  // Display only; absent/zero → no badge.
  #recycleBadge(obj, side, index) {
    const n = Number(obj?.[side]?.[index]?.hybrid) || 0;
    if (n <= 0) return '';
    return `<span class="fill-badge" title="micro fires — banked oscillations">×${n}</span>`;
  }

  // The scalp zone: orders from "Grid from order" down may run the pause-scalp,
  // everything above them is pure DCA and always will be. Tinting the rows is the
  // only way to SEE where the two strategies part — the numbers look identical.
  #zoneClass(arm, index) {
    if (!arm) return '';
    return index >= arm - 1 ? 'grid-zone' : '';
  }

  // The forecast, on every rung of the zone that is not already carrying a live
  // micro: WOULD the scalp be allowed here, once this rung fills? The engine refuses
  // a micro that crosses the split and refuses in silence, so without this you only
  // find out by running the cycle down to the rung and watching nothing happen —
  // which is exactly how a whole cycle got spent on a Grid exit % that was too tight.
  // The numbers are the calculator's (microFits / microSplit), off the planned ladder.
  #fitBadge(el, arm, index) {
    if (!arm || index < arm - 1) return ''; // above the arm: pure DCA, nothing to forecast
    if (el.microFits === undefined) return ''; // hybrid off → the calculator emits nothing

    const micro = this.strategy === 'short' ? el.microBuyCurrency : el.microSellCurrency;
    const side = this.strategy === 'short' ? 'above' : 'below';

    if (el.microFits) {
      return `<span class="fill-badge fit-badge fit-yes" title="the scalp fits here: the micro at ${micro} stays ${side} the split at ${el.microSplit}">✓</span>`;
    }
    return `<span class="fill-badge fit-badge fit-no" title="no scalp here: the micro at ${micro} crosses the split at ${el.microSplit} — raise Grid exit % or lower Micro profit %">✗</span>`;
  }

  // The micro on the rung that actually carries it (the deepest held one). It is
  // invisible in the plan columns — they show the whole-position close — so without
  // this badge the scalp is a black box: you cannot tell a resting micro from one
  // that was never placed, and least of all WHY.
  //   live    — it is on the book right now, at this price and this volume.
  //   waiting — it fits, but the price left the zone; the full close rests instead.
  //   blocked — it does NOT fit under the split, so the engine places no scalp at
  //             all and the cycle silently runs as plain DCA. This is the state
  //             that needs a knob turned, and the title says which one.
  #microBadge(view, index) {
    if (!view?.enabled || !view.micro || view.deepest == null) return '';
    if (index !== view.deepest - 1) return '';

    const { price, quantity } = view.micro;
    const side = this.strategy === 'short' ? 'above' : 'below';

    if (view.resting) {
      return `<span class="fill-badge micro-badge micro-live" title="micro resting on the book: ${quantity} @ ${price}">micro ${price} × ${quantity}</span>`;
    }
    if (!view.fits) {
      return `<span class="fill-badge micro-badge micro-blocked" title="no scalp: the micro at ${price} must stay ${side} the split at ${view.split} — raise Grid exit % or lower Micro profit %">micro ${price} ✕</span>`;
    }
    if (!view.inZone) {
      return `<span class="fill-badge micro-badge micro-wait" title="the price is out of the scalp zone (past the split at ${view.split}) — the whole-position close rests instead">micro ${price} …</span>`;
    }
    return `<span class="fill-badge micro-badge micro-live" title="micro arming: ${quantity} @ ${price}">micro ${price} × ${quantity}</span>`;
  }

  // The scalp in one line above the table: the live price against the split it is
  // measured on, the micro, the REAL whole-position close (recomputed from the
  // fills — it drifts away from the plan column as the cycle runs), and everything
  // the grid has banked so far. Hidden entirely on a classic cycle.
  #hybridBar(view, dec = 2) {
    const bar = document.getElementById('hybrid-bar');
    if (!bar) return;

    if (!view?.enabled) {
      bar.innerHTML = '';
      bar.hidden = true;
      return;
    }

    const cell = (label, value, cls = '') =>
      `<span class="hybrid-bar__cell ${cls}">${label ? `<em>${label}</em>` : ''}${value}</span>`;

    const banked = (Number(view.banked) || 0).toFixed(dec);
    const out = [];

    // Order matters: "blocked" is a real complaint and must not be printed at a
    // cycle that simply has nothing to scalp — a finished or empty position has no
    // micro for want of VOLUME, not for want of room, and telling the user to raise
    // Grid exit % there would send them chasing a number that changes nothing.
    let state = 'idle';
    let text = 'nothing held — waiting for the first fill';
    if (view.deepest == null) {
      // keep the idle line
    } else if (!view.close) {
      text = 'position closed — nothing left to scalp';
    } else if (view.arm && view.deepest < view.arm) {
      text = `order #${view.deepest} held — DCA until #${view.arm}`;
    } else if (!view.micro) {
      text = `order #${view.deepest} is already closed out — nothing left to scalp`;
    } else if (view.resting) {
      state = 'live';
      text = `scalping order #${view.deepest}`;
    } else if (!view.fits) {
      state = 'blocked';
      text = `no room for the micro on #${view.deepest} — raise Grid exit %`;
    } else if (!view.inZone) {
      state = 'wait';
      text = 'price out of the zone — full close rests';
    } else {
      state = 'live';
      text = `arming the micro on #${view.deepest}`;
    }

    out.push(cell('', text, `hybrid-bar__state is-${state}`));
    if (view.price) out.push(cell('price', view.price));
    if (view.split) out.push(cell('split', view.split));
    if (view.micro) out.push(cell('micro', `${view.micro.price} × ${view.micro.quantity}`));
    if (view.close) out.push(cell('close', `${view.close.price} × ${view.close.quantity}`));
    out.push(cell('banked', banked, Number(view.banked) > 0 ? 'is-live' : ''));

    bar.innerHTML = out.join('');
    bar.hidden = false;
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
        '<span class="row-actions row-actions--edit">' +
        `<button type="button" class="UIb xsm r-round success" data-value='${replace}' title="Re-place at a new price">` +
        '+</button>' +
        '</span>'
      );
    }

    // manual cancel in flight → hold a DISABLED ✕ until ＋ appears. Held through
    // every transient state in between (NEW still live, CANCELED before `manual`
    // is stamped, engine blips), so the per-tick re-render never shows a clickable
    // ✕ mid-cancel. Cleared only by the ＋ branch above, or by clearPendingCancel
    // on a failed cancel (SpotWS).
    if (this._pendingCancel.has(key)) {
      return (
        '<span class="row-actions"><button type="button" class="UIb xsm r-round danger"' +
        ' disabled title="Cancelling…">' +
        'x</button></span>'
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
        '<span class="row-actions"><button type="button" class="UIb xsm r-round danger"' +
        ` data-value='${cancel}' title="Cancel order">` +
        'x</button></span>'
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
      const res = await fetch('/spotbot/calculator/result', {
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
      // Hybrid v3 shows the PURE DCA plan — no column swap. The plan columns never
      // lie about the real exit: the whole-position averaged close stays the
      // displayed close. The scalp is a runtime detail on top of it, and it is
      // rendered from obj.hybridView — the engine's own numbers (Job.view), never
      // recomputed here. Absent (classic cycle, page just loaded from file) → the
      // table is exactly what it always was.
      const view = obj?.hybridView || null;
      this.#hybridBar(view, parseInt(obj?.param?.['field-tickSize'], 10) || 2);

      // The scalp zone is drawn from the LIVE floor when a cycle carries one, and
      // from the form otherwise — so the zone and the fit forecast are on screen
      // while you are still setting the numbers, with no cycle to read them from.
      // The calculator only emits microFits with hybrid on, which is the signal.
      const hybridOn = data['calculator'].some((r) => r.microFits !== undefined);
      const arm = hybridOn ? Number(view?.arm ?? this.defaultData['field-gridLevel']) || 0 : 0;

      const rows = [];
      data['calculator'].forEach((el, index) => {
        const buyAct = this.#rowAction(obj, 'BUY', index, el.buyCurrency);
        const sellAct = this.#rowAction(obj, 'SELL', index, el.sellCurrency);
        // micro-fire ×N badge on the close side that actually scalps:
        // long closes with SELL, short with BUY.
        const buyRecycle = this.strategy === 'short' ? this.#recycleBadge(obj, 'BUY', index) : '';
        const sellRecycle = this.strategy === 'long' ? this.#recycleBadge(obj, 'SELL', index) : '';
        // The close side is the one that scalps, so the micro badge goes in ITS
        // currency cell — SELL on long, BUY on short.
        const closeSide = this.strategy === 'short' ? 'BUY' : 'SELL';
        // The rung that CARRIES the micro shows the real thing; every other rung in
        // the zone shows the forecast. Never both — the live order wins its own row.
        const mark = this.#microBadge(view, index) || this.#fitBadge(el, arm, index);
        const buyMicro = closeSide === 'BUY' ? mark : '';
        const sellMicro = closeSide === 'SELL' ? mark : '';
        rows[index] = `<tr class="${this.#zoneClass(arm, index)}">
              <th class="center">${index + 1}</th>
              <td>${el.overlapRange}</td>
              <td class="${buyAct ? 'act-cell' : ''}"><span class="fill-cell">${el.buyCurrency}${buyRecycle}${buyMicro}${this.#currentPriceBadge(obj, 'BUY', index, el.buyCurrency)}${this.#fillBadge(obj, 'BUY', index, 'price')}</span>${buyAct}</td>
              <td class="${this.#backlight(obj, 'BUY', index)}"><span class="fill-cell">${el.buy}${this.#fillBadge(obj, 'BUY', index, 'qty')}</span></td>
              <td class="${this.#backlight(obj, 'SELL', index)}"><span class="fill-cell">${el.totalSell}${this.#fillBadge(obj, 'SELL', index, 'qty')}</span></td>
              <td class="${sellAct ? 'act-cell' : ''}"><span class="fill-cell">${el.sellCurrency}${sellRecycle}${sellMicro}${this.#currentPriceBadge(obj, 'SELL', index, el.sellCurrency)}${this.#fillBadge(obj, 'SELL', index, 'price')}</span>${sellAct}</td>
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
      const res = await fetch('/spotbot/calculator/save', {
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
      const res = await fetch('/spotbot/calculator/restart', {
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
