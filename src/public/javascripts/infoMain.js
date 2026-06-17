import { Theme } from './ui/Theme.js';
import { LoadInfo } from './LoadInfo.js';
import { Notifications } from './ui/Notifications.js';

const notifications = new Notifications();

new LoadInfo(notifications);
new Theme();

UiElements.initQuestionTooltips();
