import { CancelAllOrders } from './CancelAllOrders.js';
import { DeleteCurrentSeries } from './DeleteCurrentSeries.js';
import { LoadDataCalculator } from './LoadDataCalculator.js';
import { LoadDataFromFileCalculator } from './LoadDataFromFileCalculator.js';
import { Notifications } from './ui/Notifications.js';
import { SetStrategy } from './SetStrategy.js';
import { SpotWS } from './SpotWS.js';
import { Theme } from './ui/Theme.js';

let spinBox = new UiElements.SpinBox();
new UiElements.Switch();
new UiElements.ButtonGroup();
const sl = new UiElements.Select();

const notifications = new Notifications();

const deleteCurrentSeries = new DeleteCurrentSeries(notifications);
const cancelAllOrders = new CancelAllOrders(notifications, deleteCurrentSeries);

const colors = {
  null: '',
  NEW: 'color-success',
  FILLED: 'color-primary',
  PARTIALLY_FILLED: 'color-warning',
  CANCELED: 'color-secondary',
};

const loadDataCalculator = new LoadDataCalculator(notifications, colors);
loadDataCalculator.save();
loadDataCalculator.restart();
loadDataCalculator.hybrid();
loadDataCalculator.autoExit();
loadDataCalculator.runtimeParams();
loadDataCalculator.rowActions();
loadDataCalculator.expertMode();

// Recreate the SpinBox so that it re-reads the data-step and re-syncs the
// +/- arrows to the current min/value (the balance accuracy depends on the
// strategy, and the package locks the step during initialization). Shared
// between a manual Long/Short click (SetStrategy) and landing directly on
// /spotbot/:symbol for an already-configured pair (LoadDataFromFileCalculator
// .applyState) — both write real field values into DOM inputs the SpinBox
// widget needs to re-scan.
const recreateSpinBox = () => {
  spinBox.destroy();
  spinBox = new UiElements.SpinBox();
};

const loadDataFromFileCalculator = new LoadDataFromFileCalculator(
  sl,
  notifications,
  loadDataCalculator,
  colors,
  () => spinBox,
  recreateSpinBox
);

const setStrategy = new SetStrategy(notifications, recreateSpinBox);

new SpotWS(
  notifications,
  loadDataFromFileCalculator,
  loadDataCalculator,
  cancelAllOrders,
  setStrategy
);

new Theme();

UiElements.initQuestionTooltips();
