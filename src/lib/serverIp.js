// Determines the server's PUBLIC (provider) IP address via an external service.
// Local interfaces (os.networkInterfaces) would return a LAN address (10.x/192.168.x),
// but we need the external address—so we query ipify. Cache the result.

const CACHE_TTL = 10 * 60 * 1000; // 10 min
let cachedIp = null;
let cachedAt = 0;

async function getPublicIp() {
  const now = Date.now();
  if (cachedIp && now - cachedAt < CACHE_TTL) return cachedIp;

  try {
    const res = await fetch('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);

    const { ip } = await res.json();
    if (!ip) throw new Error('empty ip in response');

    cachedIp = ip;
    cachedAt = now;
    return cachedIp;
  } catch (err) {
    console.warn('🟡 Could not resolve public IP:', err.message);
    return cachedIp; // return the previous value, if any; otherwise, return null
  }
}

module.exports = { getPublicIp };
