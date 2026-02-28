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

    window.addEventListener('load', () => {
      this.connectWebSocket();
    });

    this.isRunning = false;
    this.btnClickHandler = null;
    this.btnStart();
  }

  #isWebSocketOpen(ws) {
    return ws && ws.readyState === WebSocket.OPEN;
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    this.ws = new WebSocket(`${protocol}${location.host}`);

    this.ws.onopen = () => {
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
            }
            break;
          case 'updateTableData':
            if (message.data === 1) {
              this.interval = setInterval(() => {
                if (this.#isWebSocketOpen(this.ws)) {
                  this.loadDataFromFileCalculator.getStateCalculator();
                }
              }, 20000);
            }
            if (message.data === 0) {
              if (this.interval) {
                clearInterval(this.interval);
                this.interval = null;
              }
              this.#btnRule(false);
              this.isRunning = false;
            }
            break;
          case 'updatePrice':
            const text = document.querySelector('.stream-currency');

            if (text) {
              text.innerHTML = `${message.data.s} ${parseFloat(message.data.c).toFixed(2)}`;
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
      setTimeout(() => {
        this.notifications.showNotification(`Web Socket Reconnecting...`, 'warning');
        this.connectWebSocket();
      }, 2000);

      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
    };

    this.ws.onerror = (err) => {
      console.error('⚠️ WS in browser error:', err);
      this.notifications.showNotification(`WS in browser error: ${err}`, 'danger');
    };
  }

  // not used method
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    const startBtn = document.getElementById('startBtn');
    if (startBtn && this.btnClickHandler) {
      startBtn.removeEventListener('click', this.btnClickHandler);
    }
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
        this.notifications.showNotification('Pause of Spot Trading', 'warning', false);
        this.isRunning = false;
      }
    };

    startBtn.addEventListener('ui-button-change', this.btnClickHandler);
  }

  #btnRule(status) {
    this.loadDataCalculator.setListenerStatus(status);
    this.cancelAllOrders.setListenerStatus(status);

    const settingsCalculate = document.getElementById('settings-calculate');
    settingsCalculate.classList.toggle('disabled');

    const settingsCalculateSave = document.getElementById('settings-calculate-save');
    settingsCalculateSave.classList.toggle('disabled');

    const cancelAllOrders = document.getElementById('cancel-all-orders');
    cancelAllOrders.disabled = !cancelAllOrders.disabled;

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
