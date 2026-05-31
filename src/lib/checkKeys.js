// Проверка пары API key+secret через подписанный запрос к приватному
// эндпоинту аккаунта. Проверить можно только ПАРУ (секрет подписывает запрос),
// и только против «своего» baseURL: real → api.binance.com, test → testnet.
const { Spot } = require('@binance/connector');

const ENVS = {
  real: {
    keyVar: 'API_KEY',
    secretVar: 'API_SECRET',
    baseURL: 'https://api.binance.com',
  },
  test: {
    keyVar: 'API_KEY_TEST',
    secretVar: 'API_SECRET_TEST',
    baseURL: 'https://testnet.binance.vision/',
  },
};

// Первые 5 символов ключа (для превью) или null, если не задан.
const preview = (value) => (value ? value.slice(0, 5) : null);

// Превью и факт наличия обеих пар — для серверного рендера страницы.
function getKeysInfo() {
  const build = (env) => {
    const { keyVar, secretVar } = ENVS[env];
    const key = process.env[keyVar];
    const secret = process.env[secretVar];
    return {
      key: preview(key),
      secret: preview(secret),
      present: Boolean(key && secret),
    };
  };
  return { real: build('real'), test: build('test') };
}

// Реальная проверка пары: signed-запрос account(). Валидно → 200 + права.
async function checkKeys(env) {
  const cfg = ENVS[env];
  if (!cfg) return { success: false, message: 'Unknown environment' };

  const key = process.env[cfg.keyVar];
  const secret = process.env[cfg.secretVar];
  if (!key || !secret) return { success: false, message: 'Keys are not set' };

  try {
    const client = new Spot(key, secret, { baseURL: cfg.baseURL });
    const res = await client.account({ omitZeroBalances: true });
    return {
      success: true,
      canTrade: res.data?.canTrade ?? null,
      accountType: res.data?.accountType ?? null,
    };
  } catch (err) {
    const data = err.response?.data;
    const message = [data?.code, data?.msg || err.message].filter(Boolean).join(' ');
    return { success: false, message: message || 'Request failed' };
  }
}

module.exports = { getKeysInfo, checkKeys };
