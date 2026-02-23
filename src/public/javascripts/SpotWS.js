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
          symbol: bace + quote,
          bace: bace,
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

    const toggleBtn = document.getElementById('toggleBtn');
    if (toggleBtn && this.btnClickHandler) {
      toggleBtn.removeEventListener('click', this.btnClickHandler);
    }
  }

  btnStart() {
    const toggleBtn = document.getElementById('toggleBtn');

    // delete old handler
    if (this.btnClickHandler) {
      toggleBtn.removeEventListener('click', this.btnClickHandler);
    }

    // new handler
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
            symbol: bace + quote,
            strategy: this.setStrategy.getStrategy(),
            bace: bace,
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
            bace: bace,
            quote: quote,
          })
        );
        this.#btnRule();
        this.notifications.showNotification('Pause of Spot Trading', 'warning', false);
        this.isRunning = false;
      }
    };

    toggleBtn.addEventListener('click', this.btnClickHandler);
  }

  #btnRule(status) {
    this.loadDataCalculator.setListenerStatus(status);
    this.cancelAllOrders.setListenerStatus(status);

    const toggleBtn = document.getElementById('toggleBtn');
    const settingsCalculate = document.getElementById('settings-calculate');
    const settingsCalculateSave = document.getElementById('settings-calculate-save');
    const cancelAllOrders = document.getElementById('cancel-all-orders');

    toggleBtn.classList.toggle('danger');
    if (status) {
      toggleBtn.innerHTML = `Stop <svg class="icon active"><use href="/sprite.svg#stop"></use></svg>`;
    } else {
      toggleBtn.innerHTML = `Start <svg class="icon"><use href="/sprite.svg#play"></use></svg>`;
    }

    settingsCalculate.classList.toggle('disabled');
    settingsCalculateSave.classList.toggle('disabled');
    cancelAllOrders.classList.toggle('disabled');
  }
}
