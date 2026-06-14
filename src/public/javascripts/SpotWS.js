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
      this.reconnectAttempts = 0; // успешное подключение — сбросить backoff
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
              // начальная отрисовка; дальше таблица приходит push-событием
              // 'tableData' на каждом тике робота — поллинг не нужен
              this.loadDataFromFileCalculator.getStateCalculator();
            } else {
              // Бот не запущен (в т.ч. после падения/рестарта сервера) — снять блокировку
              this.#btnRule(false);
              this.isRunning = false;
            }
            break;
          case 'tableData':
            // push полного конфига от readLoop (только наша комната символа)
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
              // финальное обновление таблицы — показать итоговые статусы/цвета
              // (синий на закрытом SELL) без перезагрузки страницы; push больше
              // не придёт (цикл остановлен), поэтому единичный fetch
              this.loadDataFromFileCalculator.getStateCalculator();
            }
            break;
          case 'restartSync':
            this.#updateRestartSwitch(message.data);
            break;
          case 'notification':
            // generic server-side notification (e.g. price stream lost/restored).
            // persist:true → несхлопываемый тост (duration false), как у STOP —
            // напр. статистика возврата средств при остановке цикла.
            this.notifications.showNotification(
              message.data.message,
              message.data.type || 'info',
              message.data.persist ? false : undefined
            );
            break;
          case 'updatePrice':
            const text = document.querySelector('.stream-currency');

            if (text) {
              // Точность цены берём из tickSize пары (число знаков после
              // запятой), иначе дешёвые пары (DOGE/SHIB) схлопнутся в 0.00.
              // field-tickSize уже хранит decimalCount (как в LoadDataCalculator).
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

      // Экспоненциальный backoff вместо вечных ретраев каждые 2 с: при 401
      // (истёкшая сессия отбивает upgrade) клиент спамил нотификациями
      // бесконечно. После лимита — предложение перелогиниться.
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

  // not used method
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    const startBtn = document.getElementById('startBtn');
    if (startBtn && this.btnClickHandler) {
      startBtn.removeEventListener('ui-button-change', this.btnClickHandler);
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

    // Блокируем всю область параметров (стратегия + спинбоксы + select прогрессии).
    // Start и переключатель Restart остаются доступными.
    document.querySelector('.UIbg')?.classList.toggle('params-locked', lock);
    document.getElementById('group-spinbox')?.classList.toggle('params-locked', lock);

    // Блокируем Calculate и Save на время работы. Именно атрибут disabled, а не
    // класс: пакет UIb гасит клик/события только по :disabled / [aria-disabled],
    // CSS-правила для класса .disabled у UIb нет.
    const settingsCalculate = document.getElementById('settings-calculate');
    settingsCalculate.disabled = Boolean(status);

    const settingsCalculateSave = document.getElementById('settings-calculate-save');
    settingsCalculateSave.disabled = Boolean(status);

    const cancelAllOrders = document.getElementById('cancel-all-orders');
    cancelAllOrders.disabled = Boolean(status);

    // Delete current series доступна только после Cancel all orders. На любой
    // смене статуса цикла (start/stop) сбрасываем в disabled — заново её активирует
    // лишь успешная отмена ордеров (CancelAllOrders.enable()).
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
