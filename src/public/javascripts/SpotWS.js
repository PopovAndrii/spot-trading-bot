export class SpotWS {
  constructor(
    notifications,
    loadDataFromFileCalculator,
    loadDataCalculator,
    cancelAllOrders,
    setStrategy
  ) {
    this.ws = null;

    this.notifications = notifications;

    this.loadDataFromFileCalculator = loadDataFromFileCalculator;

    this.loadDataCalculator = loadDataCalculator;

    this.cancelAllOrders = cancelAllOrders;

    this.setStrategy = setStrategy;

    this.loadDataCalculator.onRestartChange = (value) => {
      if (this.#isWebSocketOpen(this.ws)) {
        this.ws.send(JSON.stringify({ type: 'restartSync', symbol: base + quote, value }));
      }
    };

    // Manual single-order cancel → tell this symbol's bot over WS.
    // `expert` carries the Expert Mode gate to the server (rejected without it).
    this.loadDataCalculator.onCancelOrder = ({ side, index, orderId, expert }) => {
      if (this.#isWebSocketOpen(this.ws)) {
        this.ws.send(
          JSON.stringify({
            type: 'cancelOrder',
            symbol: base + quote,
            side,
            index,
            orderId,
            expert,
          })
        );
      }
    };

    // Manual re-place of a pulled order at a new price → tell the bot.
    this.loadDataCalculator.onReplaceOrder = ({ side, index, price, expert }) => {
      if (this.#isWebSocketOpen(this.ws)) {
        this.ws.send(
          JSON.stringify({ type: 'replaceOrder', symbol: base + quote, side, index, price, expert })
        );
      }
    };

    window.addEventListener('load', () => {
      this.connectWebSocket();
    });

    this.isRunning = false;
    this.btnClickHandler = null;
    this.btnStart();

    this.#watchOnStrategy();
  }

  // Long/Short picked → ask the server to open the public price stream so the
  // live price shows in .stream-currency before Start (same spot as when running).
  #watchOnStrategy() {
    const group = document.querySelector('.UIbg');
    if (!group) return;

    group.addEventListener('ui-button-group-change', () => {
      if (!this.#isWebSocketOpen(this.ws)) return;
      this.ws.send(JSON.stringify({ type: 'watchPrice', symbol: base + quote }));
    });
  }

  #isWebSocketOpen(ws) {
    return ws && ws.readyState === WebSocket.OPEN;
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    this.ws = new WebSocket(`${protocol}${location.host}`);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.notifications.showNotification('Web Socket open', 'success');
      this.ws.send(
        JSON.stringify({
          type: 'subscribe',
          symbol: base + quote,
          base: base,
          strategy: this.loadDataFromFileCalculator.getStrategyName(),
          quote: quote,
        })
      );
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.event) {
          case 'spotStatus':
            if (message.data === true) {
              this.#btnRule(true);
              this.notifications.showNotification('Table data loaded. Bot in progress.', 'success');
              this.isRunning = true;
              this.loadDataFromFileCalculator.getStateCalculator();
            } else {
              this.#btnRule(false);
              this.isRunning = false;
            }
            break;
          case 'tableData':
            this.loadDataFromFileCalculator.applyState(message.data);
            break;
          case 'updateTableData':
            if (message.data === 1) {
              this.#btnRule(true);
              this.isRunning = true;
            }
            if (message.data === 0) {
              this.#btnRule(false);
              this.isRunning = false;
              this.loadDataFromFileCalculator.getStateCalculator();
            }
            break;
          case 'restartSync':
            this.#updateRestartSwitch(message.data);
            break;
          case 'cancelOrderResult':
            // Result of a manual single-order cancel
            this.notifications.showNotification(
              message.data?.message || 'Cancel result',
              message.data?.success ? 'success' : 'warning',
              5000
            );
            // failed cancel → release the held ✕ so the order can be retried
            // (on success the ＋ render clears the hold itself)
            if (message.data && message.data.success === false) {
              this.loadDataCalculator.clearPendingCancel(message.data.side, message.data.index);
            }
            break;
          case 'replaceOrderResult':
            // Result of a manual single-order re-place
            this.notifications.showNotification(
              message.data?.message || 'Re-place result',
              message.data?.success ? 'success' : 'warning',
              5000
            );
            break;
          case 'notification':
            // generic server-side notification (e.g. price stream lost/restored).
            // persist:true → a non-dismissing toast (duration false), like STOP —
            // e.g. the fund-recovery stats when a cycle is stopped.
            this.notifications.showNotification(
              message.data.message,
              message.data.type || 'info',
              message.data.persist ? false : undefined
            );
            break;
          case 'updatePrice':
            const text = document.querySelector('.stream-currency');

            if (text) {
              const tickEl = document.querySelector('#field-tickSize');
              const tick = parseInt(tickEl?.value, 10);
              const price = parseFloat(message.data.c);
              const out = Number.isFinite(tick) ? price.toFixed(tick) : String(price);
              text.innerHTML = `${message.data.s} ${out}`;
            }

            break;
        }
      } catch (err) {
        console.error('❌ WS Parsing error in browse:', err);
        this.notifications.showNotification(`WS Parsing error in browse: ${err}`, 'danger');
      }
    };

    this.ws.onclose = (event) => {
      this.notifications.showNotification(`Web Socket closed: ${event.code}`, 'info');

      this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;

      if (this.reconnectAttempts > 8) {
        this.notifications.showNotification(
          'WebSocket: connection lost. Reload the page — the session may have expired.',
          'danger',
          false
        );
        return;
      }

      const delay = Math.min(2000 * 2 ** (this.reconnectAttempts - 1), 30000);
      setTimeout(() => {
        this.notifications.showNotification(
          `Web Socket Reconnecting (${this.reconnectAttempts})...`,
          'warning'
        );
        this.connectWebSocket();
      }, delay);
    };

    this.ws.onerror = (err) => {
      console.error('⚠️ WS in browser error:', err);
      this.notifications.showNotification(`WS in browser error: ${err}`, 'danger');
    };
  }

  btnStart() {
    const startBtn = document.getElementById('startBtn');
    if (!startBtn) return;

    if (this.btnClickHandler) {
      startBtn.removeEventListener('click', this.btnClickHandler);
    }

    const { base, quote } = JSON.parse(startBtn.dataset.value);

    this.btnClickHandler = () => {
      // test WebSocket open?
      if (!this.#isWebSocketOpen(this.ws)) {
        console.warn('⚠️ WebSocket not open');
        this.notifications.showNotification(`WebSocket not open`, 'danger');
        return;
      }

      if (!this.isRunning) {
        this.ws.send(
          JSON.stringify({
            type: 'start',
            symbol: base + quote,
            strategy: this.setStrategy.getStrategy(),
            base: base,
            quote: quote,
          })
        );
        this.#btnRule(true);
        this.notifications.showNotification('Start of Spot Trading', 'success', 8000);
        this.isRunning = true;
      } else {
        this.ws.send(
          JSON.stringify({
            type: 'stop',
            base: base,
            quote: quote,
          })
        );
        this.#btnRule();
        this.notifications.showNotification('Pause of Spot Trading', 'warning', 10000);
        this.isRunning = false;
      }
    };

    startBtn.addEventListener('ui-button-change', this.btnClickHandler);
  }

  #updateRestartSwitch(value) {
    const sw = document.getElementById('settings-calculate-restart');
    if (!sw) return;
    const input = sw.querySelector('input');
    const isOn = String(value) === 'true';
    input.checked = isOn;
    if (isOn) {
      input.setAttribute('checked', '');
      sw.setAttribute('aria-checked', 'true');
    } else {
      input.removeAttribute('checked');
      sw.setAttribute('aria-checked', 'false');
    }
  }

  #btnRule(status) {
    this.loadDataCalculator.setListenerStatus(status);
    this.cancelAllOrders.setListenerStatus(status);

    const lock = Boolean(status);

    document.querySelector('.UIbg')?.classList.toggle('params-locked', lock);
    document.getElementById('group-spinbox')?.classList.toggle('params-locked', lock);

    const settingsCalculate = document.getElementById('settings-calculate');
    settingsCalculate.disabled = Boolean(status);

    const settingsCalculateSave = document.getElementById('settings-calculate-save');
    settingsCalculateSave.disabled = Boolean(status);

    const cancelAllOrders = document.getElementById('cancel-all-orders');
    cancelAllOrders.disabled = Boolean(status);

    const deleteCurrentSeries = document.getElementById('delete-current-series');
    if (deleteCurrentSeries) deleteCurrentSeries.disabled = true;

    const startBtn = document.getElementById('startBtn');
    if (status) {
      startBtn.classList.add('danger');
      startBtn.classList.remove('success');
      startBtn.innerHTML = `Stop <svg class="icon active"><use href="/sprite.svg#stop"></use></svg>`;
    } else {
      startBtn.classList.add('success');
      startBtn.classList.remove('danger');
      startBtn.innerHTML = `Start <svg class="icon"><use href="/sprite.svg#play"></use></svg>`;
    }
  }
}
