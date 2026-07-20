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

    // Hybrid-grid and Auto-exit switches: restore from the saved param (same pattern
    // as Restart). Old configs carry neither field, which reads as off.
    const restoreSwitch = (id, key) => {
      const sw = document.getElementById(id);
      if (!sw) return;
      const input = sw.querySelector('input');
      const on = String(data.param[key]) === 'on';
      input.checked = on;
      if (on) input.setAttribute('checked', '');
      else input.removeAttribute('checked');
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
    };

    restoreSwitch('settings-hybrid', 'field-hybrid');
    restoreSwitch('settings-auto-exit', 'field-autoExit');
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

    // "Grid from order" must show the LIVE scalp floor, not the saved config: while
    // a cycle runs the switch (or a hand edit) aims it via field-gridArm, and that
    // is what #gridStartIndex obeys. Showing field-gridLevel here would make the
    // field lie about what the robot is actually doing. Direct .value, same reason
    // as the loop above.
    const arm = obj.param['field-gridArm'];
    const level = document.getElementById('field-gridLevel');
    if (level && arm) level.value = String(arm);

    // We do NOT build the table here: it's authoritatively rendered by
    // loadDataCalculator.calculate() (called right after in getStateCalculator) with
    // a single `tbody.innerHTML = html` — with status colors and real-fill badges.
    // A duplicate render here appended rows `innerHTML += row` without clearing
    // tbody → a "double" table flickered on every robot auto-poll.
  }
}
