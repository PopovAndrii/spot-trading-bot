// Which Binance environment to use: testnet or production.
// Explicit BINANCE_MODE (test|real) takes priority; if not set,
// backward compatibility with old behavior (NODE_ENV=development → testnet).
// This decouples “which Binance” and “dev tools” (NODE_ENV launches browser-sync).

// Regardless of whether keys are present.
function requestedTestnet() {
  const mode = process.env.BINANCE_MODE;
  if (mode === 'test') return true;
  if (mode === 'real') return false;
  return process.env.NODE_ENV === 'development';
}

// What is actually used. Safe fallback: if real is selected but there are no real
// keys — fall back to testnet so the container doesn’t crash.
function isTestnet() {
  if (requestedTestnet()) return true;
  return !(process.env.API_KEY && process.env.API_SECRET);
}

module.exports = { isTestnet, requestedTestnet };
