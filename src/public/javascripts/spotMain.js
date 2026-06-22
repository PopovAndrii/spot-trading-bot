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
loadDataCalculator.runtimeParams();

const loadDataFromFileCalculator = new LoadDataFromFileCalculator(
  sl,
  notifications,
  loadDataCalculator,
  colors,
  () => spinBox
);

const setStrategy = new SetStrategy(notifications, () => {
  // Recreate the SpinBox so that it re-reads the data-step 
  // (the balance accuracy depends on the strategy, and the package locks the step during initialization).
  spinBox.destroy();
  spinBox = new UiElements.SpinBox();
});

new SpotWS(
  notifications,
  loadDataFromFileCalculator,
  loadDataCalculator,
  cancelAllOrders,
  setStrategy
);

new Theme();

UiElements.initQuestionTooltips();
