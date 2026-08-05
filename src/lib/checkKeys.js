// Validate an API key+secret pair via a signed request to the private account
// endpoint. Only the PAIR can be checked (the secret signs the request), and only
// against its "own" baseURL: real → api.binance.com, test → testnet.
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

// First 5 characters of the key (for preview), or null if not set.
const preview = (value) => (value ? value.slice(0, 5) : null);

// Preview and presence of both pairs — for server-side rendering of the page.
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

// Real pair check: a signed account() request. Valid → 200 + permissions.
async function checkKeys(env) {
  const cfg = ENVS[env];
  if (!cfg) return { success: false, message: 'Unknown environment' };

  const key = process.env[cfg.keyVar];
  const secret = process.env[cfg.secretVar];
  if (!key || !secret) return { success: false, message: 'Keys are not set' };

  try {
    const client = new Spot(key, secret, { baseURL: cfg.baseURL, timeout: 5000 });
    const res = await client.account({ omitZeroBalances: true });
    return {
      success: true,
      canTrade: res.data?.canTrade ?? null,
      accountType: res.data?.accountType ?? null,
    };
  } catch (err) {
    const data = err.response?.data;
    // A rejected key comes back from Binance as a parsed JSON body {code, msg}.
    // Anything else — no response at all (DNS failure, refused connection, our
    // own timeout), or a response that isn't that shape (503/502/HTML "under
    // maintenance" page) — means the request never reached the account check,
    // so it must not be reported as an invalid key.
    if (!data || typeof data !== 'object' || data.code === undefined) {
      // The body is a gateway/maintenance page (HTML, plain text), not something
      // worth showing raw — the status code already says everything useful.
      const reason = err.response
        ? `HTTP ${err.response.status} ${err.response.statusText || ''}`.trim()
        : err.code || err.message || 'unknown error';
      return { success: false, offline: true, message: `Exchange unreachable (${reason})` };
    }
    const message = [data.code, data.msg || err.message].filter(Boolean).join(' ');
    return { success: false, message: message || 'Request failed' };
  }
}

module.exports = { getKeysInfo, checkKeys };
