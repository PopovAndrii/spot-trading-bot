export class LoadDataFromFileCalculator {
  constructor(select, notifications, loadDataCalculator, colors, getSpinBox) {
    this.selectObjectElement = select;
    this.notifications = notifications;
    this.loadDataCalculator = loadDataCalculator;
    // Getter for the current SpinBox instance: it's recreated on a strategy change
    // (setStrategy → destroy + new), so we keep a function, not a direct reference.
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
   * Applies a pair's config to the UI (strategy, Restart switch, spinboxes, table).
   * A single path for the initial fetch (getStateCalculator) and 'tableData' push
   * updates over WebSocket (SpotWS) — polling /spotbot/table is no longer needed.
   */
  applyState(data) {
    if (!data || !data.param) return;

    this.strategyName = data.param['field-strategy'];

    if (this.strategyName) {
      document.querySelector(`#${this.strategyName}`).checked = true;
    }

    if ('restart' in data) {
      const sw = document.getElementById('settings-calculate-restart');
      const input = sw.querySelector('input');

      if (String(data.restart) === 'true') {
        input.checked = true;
        input.setAttribute('checked', '');
        sw.setAttribute('aria-checked', 'true');
      } else {
        input.removeAttribute('checked');
        sw.setAttribute('aria-checked', 'false');
        input.checked = false;
      }
    }

    // Hybrid-grid switch: restore from the saved param (same pattern as Restart).
    // Old configs without field-hybrid leave it off.
    const hybridSw = document.getElementById('settings-hybrid');
    if (hybridSw) {
      const input = hybridSw.querySelector('input');
      const on = String(data.param['field-hybrid']) === 'on';
      input.checked = on;
      if (on) input.setAttribute('checked', '');
      else input.removeAttribute('checked');
      hybridSw.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    this.loadDataCalculator.toggleHybridFields();

    this.#fillInData(data);
    this.loadDataCalculator.calculate(data);
  }

  async #fillInData(obj) {
    const select = document.getElementById('strategyList');
    // set default value on strategi list
    this.loadDataCalculator.ignoreNextSelectChange();
    this.selectObjectElement.setValue(select, obj.param.strategyList);

    if (Object.keys(obj).length === 0) return;

    document.querySelectorAll('[id^="field-"]').forEach((el) => {
      const value = obj.param[el.id] ?? '';
      // Write the value DIRECTLY, without spinBox.setValue: the package always
      // clamps to data-min/max (SpinBox.d.ts: "always clamped to min/max"). A saved
      // field-indent="0" (written by restartCycle) was clamped to min 0.01 and
      // shifted the grid recompute in /calculator/result (606.36 → 606.30) — the
      // table diverged from the file and the actually placed orders. A direct .value
      // assignment does NOT emit ui-spinbox-change, so there are no extra
      // recomputes/live writes — exactly the v1.0.4 behavior. The +/- arrows are
      // locked during a cycle (params-locked), so syncing them here is cosmetic.
      el.value = value;
    });

    // We do NOT build the table here: it's authoritatively rendered by
    // loadDataCalculator.calculate() (called right after in getStateCalculator) with
    // a single `tbody.innerHTML = html` — with status colors and real-fill badges.
    // A duplicate render here appended rows `innerHTML += row` without clearing
    // tbody → a "double" table flickered on every robot auto-poll.
  }
}
