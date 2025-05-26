import { CancelAllOrders } from './CancelAllOrders.js';
import { LoadDataCalculator } from './LoadDataCalculator.js';
import { LoadDataFromFileCalculator } from './LoadDataFromFileCalculator.js';
import { SetStrategy } from './SetStrategy.js';
import { SpotWS } from './SpotWS.js';

new CancelAllOrders();

const loadDataCalculator = new LoadDataCalculator();
loadDataCalculator.save();

new LoadDataFromFileCalculator();
new SetStrategy();
new SpotWS();



