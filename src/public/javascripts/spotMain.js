import { CancelAllOrders } from './CancelAllOrders.js';
import { LoadDataCalculator } from './LoadDataCalculator.js';
import { LoadDataFromFileCalculator } from './LoadDataFromFileCalculator.js';
import { Notifications } from './ui/Notifications.js';
import { SetStrategy } from './SetStrategy.js';
import { SpotWS } from './SpotWS.js';
import { Theme } from './ui/Theme.js';

new UiElements.SpinBox();
new UiElements.Switch();
new UiElements.ButtonGroup();
const sl = new UiElements.Select();

const notifications = new Notifications();

const cancelAllOrders = new CancelAllOrders(notifications);

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

const loadDataFromFileCalculator = new LoadDataFromFileCalculator(
  sl,
  notifications,
  loadDataCalculator,
  colors
);

const setStrategy = new SetStrategy(notifications);

new SpotWS(
  notifications,
  loadDataFromFileCalculator,
  loadDataCalculator,
  cancelAllOrders,
  setStrategy
);

new Theme();
