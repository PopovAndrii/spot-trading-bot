export class LoadDataFromFileCalculator {
  constructor(select, notifications, loadDataCalculator, colors, getSpinBox) {
    this.selectObjectElement = select;
    this.notifications = notifications;
    this.loadDataCalculator = loadDataCalculator;
    // Геттер текущего инстанса SpinBox: он пересоздаётся при смене стратегии
    // (setStrategy → destroy + new), поэтому держим функцию, а не прямую ссылку.
    this.getSpinBox = getSpinBox;

    this.orderType = colors;

    document.addEventListener('DOMContentLoaded', () => {
      this.getStateCalculator();
    });

    this.strategyName = null;
  }

  getStrategyName() {
    return this.strategyName ? this.strategyName : null;
  }

  async getStateCalculator() {
    const res = await this.notifications.fetchWithHandling(
      `/spotbot/table/${base + quote}?symbol=${base + quote}&base=${base}&quote=${quote}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: base + quote }),
      },
      { '404-': 'Trading pair settings file not found', '500-': 'Server Error' }
    );

    if (Object.keys(res.data).length === 0) return;

    this.applyState(res.data);
  }

  /**
   * Применяет конфиг пары к UI (стратегия, свитч Restart, спинбоксы, таблица).
   * Единый путь для начального fetch (getStateCalculator) и push-обновлений
   * 'tableData' по WebSocket (SpotWS) — поллинг /spotbot/table больше не нужен.
   */
  applyState(data) {
    if (!data || !data.param) return;

    this.strategyName = data.param['field-strategy'];

    if (this.strategyName) {
      document.querySelector(`#${this.strategyName}`).checked = true
    }

    if ('restart' in data) {
      const sw = document.getElementById('settings-calculate-restart');
      const input = sw.querySelector('input');

      if (String(data.restart) === 'true') {
        input.checked = true
        input.setAttribute('checked', '')
        sw.setAttribute('aria-checked', 'true');
      } else {
        input.removeAttribute('checked');
        sw.setAttribute('aria-checked', 'false');
        input.checked = false
      }
    }

    this.#fillInData(data);
    this.loadDataCalculator.calculate(data);
  }

  async #fillInData(obj) {
    const select = document.getElementById('strategyList');
    // set default value on strategi list
    this.loadDataCalculator.ignoreNextSelectChange();
    this.selectObjectElement.setValue(select, obj.param.strategyList)

    if (Object.keys(obj).length === 0) return;

    const spinBox = this.getSpinBox?.();
    document.querySelectorAll('[id^="field-"]').forEach((el) => {
      const value = obj.param[el.id] ?? '';
      const spin = el.closest('.UIsp');
      // Спинбоксы: setValue({ silent }) ставит значение И синхронизирует стрелки +/-
      // БЕЗ эмита ui-spinbox-change (иначе на каждом авто-опросе шли бы лишние
      // пересчёты и live-записи). flash:false — без анимации на фоновом обновлении.
      // Скрытые поля (strategy/tickSize/stepSize) — обычным присваиванием.
      if (spin && spinBox) {
        spinBox.setValue(spin, value, { silent: true, flash: false });
      } else {
        el.value = value;
      }
    });

    // Таблицу НЕ строим здесь: её авторитетно рендерит loadDataCalculator.calculate()
    // (вызывается сразу после в getStateCalculator) одним `tbody.innerHTML = html` —
    // со статус-цветами и бейджами реального исполнения. Дублирующий рендер тут
    // дописывал строки `innerHTML += row` без очистки tbody → «двойная» таблица
    // мелькала при каждом автоопросе робота (REQUIREMENTS.md п.26).
  }
}
