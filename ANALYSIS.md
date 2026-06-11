# Глубокий анализ проекта exchange-crypto

> Дата: 2026-06-11. Ветка: `crash` (незакоммичен фикс краша `emit('error')` в `src/lib/streamAPI.js`).
> Стек: Docker + Node.js 24 (Express 5, EJS, ws) + SCSS + `@popovandrii/ui-elements`.
> Персистентность — JSON-файлы в `src/data/` (атомарная запись через rename).

Общая оценка: архитектура для одно-пользовательского спот-робота здравая и местами
очень аккуратная (атомарная запись, авторизация WS-upgrade через общий session
middleware, write-lock на Save во время цикла, sequence-токен против гонки рендера
таблицы, тесты на чистые функции). Ниже — что чинить в первую очередь и что улучшать.

---

## 1. Критичное (может уронить процесс или деньги)

### 1.1. Краш сервера от одного WS-сообщения без `symbol`
`src/lib/websocketRouter.js:38` — `data.symbol.toUpperCase()` без проверки.
Авторизованный клиент, отправивший `{"type":"subscribe"}` (без `symbol`), бросает
TypeError внутри обработчика `ws.on('message')` → `uncaughtException` → падение
процесса вместе со всеми торговыми циклами. То же касается `data.type === 'start'`
(`data.strategy` не проверяется). Нужна валидация схемы входящих сообщений
(whitelist `type`, обязательный `symbol` по формату `/^[A-Z0-9]{3,20}$/`) и
`try/catch` вокруг всего тела обработчика.

### 1.2. Тугая петля `readLoop` при ошибке чтения конфига
`src/modules/jsonTimerSender.js:225,240` — `this.interval` присваивается только при
успешном чтении. Если первый тик упал (файла нет, битый JSON) или
`data.param['field-requestFrequency']` отсутствует/NaN, то
`setTimeout(..., undefined|NaN)` → срабатывание через 0 мс → бесконечный цикл
чтения ФС + спам в лог на полной скорости CPU. Нужен дефолт и нижний clamp:
`this.interval = Math.max(1000, Number(...) || 5000)`.

### 1.3. Гонка: `#jobItaretor` затирает live-правки параметров
Робот читает файл в начале тика (`readLoop`), долго ходит по ордерам (sleep
100–500 мс на ордер) и пишет **весь** устаревший `obj` целиком
(`jsonTimerSender.js:168,192`). Если в этот момент пользователь сменил
`field-activeOrders`/`field-requestFrequency` через `POST /calculator/param`
(который тоже делает read-modify-write всего файла) — правка молча теряется при
следующей записи итератора. `writeFileAtomic` защищает от битого JSON, но не от
lost update. Варианты: перечитывать `param` непосредственно перед записью и
мерджить; либо писать из итератора только изменённые ордера; либо однопроцессная
очередь записи на файл (mutex по symbol).

### 1.4. ✅ РЕШЕНО. Молчаливая смерть прайс-стрима
`src/lib/streamAPI.js:147-151` — после 5 неудачных реконнектов эмитится
`maxReconnectReached`, но **никто его не слушает** (ни `jsonTimerSender`, ни
`websocketRouter`). Итог: цикл продолжает крутиться по REST, а строка цены в UI
просто замирает без уведомления. Минимум — подписаться и отправить клиентам
notification + логBus; лучше — бесконечный reconnect с capped backoff (30–60 с):
для торгового робота «сдаться навсегда» хуже, чем пытаться вечно.

> Исправлено (ветка `crash`): бесконечный reconnect с потолком backoff 30 с;
> `maxReconnectReached` эмитится один раз как сигнал длительного сбоя,
> при восстановлении эмитится `reconnected`. `jsonTimerSender` слушает оба,
> пишет в logBus и ре-эмитит `streamState`; `websocketRouter` рассылает
> клиентам символа событие `notification`; `SpotWS.js` показывает его в UI.

### 1.5. Состояние «running» не переживает рестарт сервера
`pair` и `timerSenders` живут в памяти. После рестарта контейнера:
- цикл не возобновляется автоматически (открытые ордера остаются висеть на бирже,
  файл хранит их состояние, но `#jobItaretor` по ним больше не ходит);
- `pair.isRunning()` возвращает `false` → write-lock из `spotbot.js:180` не
  действует, и Save перезапишет файл с живыми `orderId`.

Стоит при старте сканировать `src/data/*.json` со `status === STARTED|REDY` +
ордерами в статусе NEW/PARTIALLY_FILLED и либо авто-резюмировать цикл, либо как
минимум помечать символ «требует внимания» в UI и блокировать Save.

---

## 2. Бэкенд

### Баги
- **`POST /calculator/restart` всегда отвечает «off»** —
  `src/routes/spotbot.js:231,242`: сначала `newData.restart = String(...) === 'true'`
  (boolean), затем `newData.restart == "true"` — `true == "true"` это `false`,
  поэтому `str` всегда `"off"`. Сравнивать надо с самим boolean.
- **Нет проверки `result.success` в роутах** — `spotbot.js:33,111,140`:
  при ошибке API `message` — строка, и `exchangeInfo.message.symbols[0]` /
  `account.message.balances.find` бросают TypeError → 500-страница вместо
  внятного ответа. Express 5 ловит async-исключения, но пользователь получает
  «error page» на ровном месте.
- **`partialFillDelta` + `Object.assign(stored, delta)`** (`jsonTimerSender.js:163-167`):
  если `stored` оказался `undefined` (рассинхрон `currentOrder.id` и side),
  `Object.assign(undefined, …)` бросит. Сейчас прикрыто `.catch` в `readLoop`,
  но тик пропадёт — стоит добавить guard.

### Надёжность / безопасность
- **Session MemoryStore в проде** — утечка памяти по мере логинов, сессии
  умирают при рестарте. Для одного пользователя приемлемо, но хотя бы
  `connect-sqlite3`/file-store сделает рестарты бесшовными.
- **Cookie без `sameSite`** (`src/app.js:37-41`) — браузерные дефолты спасают
  (Lax), но для приложения, умеющего отменять ордера POST-запросом
  (`/spotbot/cancel/allorders` принимает и `urlencoded`), задать `sameSite: 'lax'`
  (а лучше `strict`) явно. CSRF-токенов нет — с `strict` и одним пользователем ок.
- **Нет `helmet`** — CSP/`X-Frame-Options`/`nosniff` бесплатные.
- **`SESSION_SECRET` не проверяется при старте** — без него express-session
  бросит на первом запросе; лучше fail-fast с понятным сообщением.
- **Нет server-side clamp для runtime-параметров** — `POST /calculator/param`
  (`spotbot.js:256`) принимает любое значение; `field-requestFrequency: 1` ×
  опрос `getOrder` на каждый ордер = риск бана Binance (-1003 / 418). UI-минимум
  1000 мс легко обходится прямым POST. Клампить на сервере и обрабатывать 429
  с backoff в `invokeAPI`.
- **Нет graceful shutdown** — ни одного `process.on('SIGTERM')` в проекте.
  `docker stop` обрывает процесс посреди прохода итератора. Записи атомарны,
  так что файл не побьётся, но правильно: закрыть HTTP, дождаться конца текущего
  прохода (`busy`), остановить стримы, и только потом выйти.

### Архитектура / качество кода
- **`UserStreamAPI` написан, но закомментирован** (`jsonTimerSender.js:253-260`).
  Это главное стратегическое улучшение: `executionReport` по user data stream
  заменяет постоянный опрос `getOrder` (weight 4/запрос) — мгновенная реакция на
  исполнение, на порядок меньше REST-трафика и риска rate-limit. Перед включением
  починить в нём: `JSON.parse` без try/catch (`UserStreamApi.js:53` — краш
  процесса на битом кадре), комментарий «Keep-alive every 30 min» при коде 5 мин,
  реконнект только при `!isStarted`.
- **Смесь CJS и ESM**: `src/lib/calculator.js` — ESM (`export class`), всё
  остальное — CommonJS с `require()`. Работает только благодаря `require(esm)`
  в Node ≥22.12 и автодетекту синтаксиса. Хрупко и неочевидно — привести к
  одному стилю.
- **Конструкторы-антипаттерны**: `Calculator` возвращает массив из конструктора
  (`new Calculator(...)` — это Array, методов класса у результата нет);
  `StreamAPI`/`UserStreamAPI`/`InvokeApi` возвращают существующий инстанс из
  `constructor`. Работает, но ломает ожидания (`instanceof`, поля). Чище —
  статические `create()`/`getInstance()` и обычный конструктор.
- **`this.running = []`** (`jsonTimerSender.js:45`) — массив, используемый как
  словарь по строковому ключу. Должен быть `Map`/объект. Притом каждый
  `JsonTimerSender` обслуживает один символ — поле могло бы быть просто boolean.
- **Мёртвый код**: `src/lib/test2.js` (копия `DynamicMartingail` + console-прогон),
  `MomentumIndicator.js` и `DynamicMartingail.js` нигде не подключены,
  `#applyStatusesToOrders`, `newMarketOrder`, `getHistory` помечены `@TODO not used`.
  Удалить или вынести в отдельную ветку экспериментов.
- **Опечатки в API-поверхности**: `Status.REDY` (READY), `#jobItaretor` (iterator),
  `clouse`, `Chenge` — мелочь, но это имена, по которым ищут.
- **Деньги в float**: `Calculator` и `rebalanceClose` считают в double и
  округляют `toFixed`. Для текущих масштабов погрешность прикрыта floor-ом по
  stepSize, но при желании убрать класс проблем целиком — `decimal.js` либо
  целочисленная арифметика в тиках/степах.
- **`job.js` — самая денежная логика (state machine ордеров) без единого теста**,
  при том что в проекте уже есть культура unit-тестов (`partialFill`,
  `rebalanceClose`). Табличные тесты переходов (`FILLED`+`CANCELED`+higherFilled
  и т.д.) дали бы максимальную защиту на строку кода.
- Дублирование `decimalCount`/`roundToStep` в двух роутах `spotbot.js:22,120` —
  вынести в `lib/format.js`.

---

## 3. WebSockets

### Сервер ↔ браузер
- **Мёртвый broadcast полного конфига каждый тик** —
  `jsonTimerSender.js:228-234` шлёт `{type:'data', data}` **всем** клиентам
  `wss.clients` (не только подписанным на символ), а фронт (`SpotWS.js`) матчит
  только `message.event` и это сообщение полностью игнорирует. Вместо этого
  таблица обновляется поллингом `getStateCalculator()` каждые 20 с. Итого: трафик
  полного JSON-конфига N раз в секунду впустую + утечка данных одного символа
  клиентам другого. Выбрать одно: либо убрать рассылку, либо (лучше) сделать её
  событием `event: 'tableData'` по комнате символа и убрать 20-секундный поллинг.
- **Нет ping/pong к браузерным клиентам** — ws-сервер не пингует; зомби-сокеты
  (закрытый ноутбук, обрыв NAT) висят в `this.clients` Sets неопределённо долго.
  Стандартный паттерн `ws`: `isAlive`/`ping` интервалом 30 с + `terminate()`.
- **Resubscribe не отписывает от старого символа** — `websocketRouter.js:37-43`:
  при повторном `subscribe` тот же `ws` остаётся в Set прежнего символа, и
  closure `currentSymbol` в обработчиках `ts.on('price')` захватывает переменную
  соединения — при смене символа рассылка может пойти не в ту комнату. Сейчас
  страница = один символ, поэтому не стреляет, но мина заложена.
- **`timerSenders` никогда не удаляются** — `JsonTimerSender` на символ живёт
  вечно (вместе со слушателями), даже когда цикл остановлен и клиентов нет.
  Маленькая, но настоящая утечка + усложняет рассуждение о состоянии.
- **Клиентский reconnect без backoff** — `SpotWS.js:128-139`: каждые 2 с навсегда,
  включая случай 401 (истекла сессия — upgrade отбивается в `bin/www`), со
  спамом нотификаций «Reconnecting…». Нужен экспоненциальный backoff и стоп после
  N попыток с предложением перелогиниться (SessionGuard уже умеет авто-логаут —
  связать).

### Сервер ↔ Binance
- `StreamAPI` — добротный (heartbeat 30 с, exp backoff, подавление unhandled
  `error`), кроме п.1.4 (лимит попыток).
- `stop()` в `StreamAPI` снимает слушатели и `close()` — но `'close'`-обработчик
  уже снят, так что `scheduleReconnect` не сработает — корректно. А вот
  `reconnect()` (`streamAPI.js:165-168`) вызывает `stop()`, который чистит
  `reconnectTimer`, но `reconnectAttempts` сбрасывается только на `open` — ок.
- На будущее: Binance рекомендует переподключаться раз в <24 ч (сервер сам рвёт
  соединение) — текущий механизм это покроет, но счётчик попыток при штатном
  суточном разрыве должен сбрасываться (сбрасывается на `open` — ок).

---

## 4. Фронтенд

- **Глобальное мутируемое состояние** — `base`, `quote`, `var orders = {}` в
  inline-`<script>` (`views/spotbot.ejs:178-183`), `orders` мутируется из
  `LoadDataCalculator.calculator()` и читается в `settingsSave()`/`SpotWS`.
  Если Save нажат до Calculate — уходит `{param}` без BUY/SELL (сервер отбивает
  400, но UX невнятный). Лучше: конфиг страницы через `data-*` атрибуты (как уже
  сделано у `startBtn`), а `orders` — приватное поле класса.
- **`updatePrice` хардкодит `toFixed(2)`** (`SpotWS.js:117`) — для дешёвых пар
  (DOGE, SHIB) цена превратится в `0.00`. Использовать `formatInfo.tickSize`,
  который уже есть на странице.
- **Инвертированная семантика `setListenerStatus`** —
  `LoadDataCalculator.js:67-69`: `setListenerStatus(true)` делает
  `listenerStatus = false`. Каждое чтение кода требует двойного отрицания;
  переименовать в `setLocked(bool)` без инверсии.
- **`disconnect()` снимает не тот listener** — `SpotWS.js:160-162` удаляет
  `'click'`, а вешали `'ui-button-change'` (:210). Метод помечен «not used», но
  тогда его лучше удалить, чем хранить с багом.
- **`#updateRestartSwitch` руками крутит DOM свитча** (`SpotWS.js:213-226`) —
  судя по коммиту «adopt ui-elements 0.3.0 silent setValue», у пакета уже есть
  программный API — использовать его, чтобы не зависеть от внутренней разметки
  `UIsw`.
- **20-секундный поллинг таблицы** поверх живого WS (см. п.3) — после перевода
  на push событие `tableData` интервал и `getStateCalculator` уйдут совсем.
- Хорошее: батч-рендер tbody одной записью innerHTML с sequence-токеном против
  гонок; `params-locked` через `:disabled`-семантику пакета; разнесение
  «расчётных» и «runtime»-параметров в разметке с комментарием почему.
- **SCSS** — современный (`@use`, переменные, темизация через `data-theme`),
  замечаний по существу нет. Единственное: тематические цвета статусов
  (`color-success/primary/warning/secondary`) задаются строками в JS
  (`spotMain.js:18-24`) — при переименовании классов в SCSS связь не проверяется;
  можно вынести в `data-*` на таблице.

---

## 5. Docker / инфраструктура

- **Образ не самодостаточен** — `docker-config/Dockerfile` это `node:24-slim` +
  curl/procps, весь код и `node_modules` приходят bind-mount-ом
  (`compose.prod.yml`). «Прод-образ» нельзя выкатить как артефакт: на новой
  машине нужен git clone + npm install вручную. Рекомендация: multi-stage
  (`COPY package*.json` → `npm ci --omit=dev` → `COPY src`) и собранный CSS в
  образ; bind-mount оставить только в dev-compose.
- **Нет `healthcheck`** — curl ставится в образ ровно для этого, но в compose
  его нет. `test: curl -fsS http://localhost:${PORT}/api/ping` (302 на /login
  curl без `-f`-ошибки не даёт; либо открыть `/api/ping` до auth-гарда — он и
  так в QUIET_PATHS логгера).
- `pm2-runtime` внутри контейнера + `restart: unless-stopped` — двойной
  супервизор. Допустимо (pm2 даст рестарт без пересоздания контейнера), но
  тогда настроить pm2 на форвард SIGTERM с таймаутом, когда появится graceful
  shutdown (п.2).
- `src/data/` в `.gitignore` и не закоммичен — правильно; но это единственное
  хранилище денег-состояния. Стоит добавить в README/cron бэкап каталога
  (он уже частично версионируется самим роботом — архивы `{timestamp}-SYMBOL`).
- `.env` симлинк в корне + `env_file required:false` + `setup-user` — удобная
  схема; проверить, что права на `src/.env` 600.

---

## 6. Приоритетный план действий

| # | Что | Где | Усилие |
|---|-----|-----|--------|
| 1 | Валидация WS-сообщений + try/catch обработчика (краш) | `websocketRouter.js` | S |
| 2 | Clamp/дефолт интервала `readLoop` (тугая петля) | `jsonTimerSender.js` | S |
| 3 | Фикс «всегда off» в `/calculator/restart` | `spotbot.js:242` | S |
| 4 | ✅ Реакция на `maxReconnectReached` / бесконечный backoff | `streamAPI.js` + router | S |
| 5 | Гонка param: мердж перед записью итератора | `jsonTimerSender.js` | M |
| 6 | Server-side clamp runtime-параметров + 429-backoff | `spotbot.js`, `invokeAPI.js` | S |
| 7 | Восстановление после рестарта (скан data/, лок Save) | `bin/www`, `pair.js` | M |
| 8 | Юнит-тесты на `job.js` (state machine) | `src/test/` | M |
| 9 | Убрать мёртвый broadcast `type:'data'` или сделать push-обновление таблицы | router + `SpotWS.js` | M |
| 10 | Включить `UserStreamAPI` (executionReport вместо опроса) | `jsonTimerSender.js` | L |
| 11 | helmet + sameSite + file session store + fail-fast SECRET | `app.js` | S |
| 12 | Graceful shutdown (SIGTERM) | `bin/www` | S |
| 13 | Multi-stage Dockerfile + healthcheck | `docker-config/` | M |
| 14 | Чистка мёртвого кода, унификация CJS/ESM, переименования | везде | M |

S — до часа, M — до полудня, L — день+.
