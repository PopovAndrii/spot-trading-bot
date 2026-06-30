// The project author's donation addresses. Static: shared by everyone who deploys
// a copy of the bot. No backend/custody/external services — we just show the
// address + QR.
//
// The QR at public/images/qr/<id>.svg is generated offline from `address` (option A):
//   npm run gen-qr   (see tools/gen-qr.js — qrcode is in devDependencies only)
const DONATIONS = [
  {
    id: 'usdt-polygon',
    coin: 'USDT',
    network: 'EVM · Polygon/BNB/ETH',
    // EVM address: the same for any EVM network (Polygon/BNB/ETH/Arbitrum…).
    address: '0xBA5DFcab30DE75125A3a6950263cF088f313C59F',
    uri: '', // bare address — network/token are chosen in the wallet when sending
    qr: '/images/qr/usdt-polygon.svg',
  },
  {
    id: 'usdt-tron',
    coin: 'USDT',
    network: 'TRC-20 · Tron',
    address: 'THHNc7h7QetGmQvkkEaM1mwr5txReSQsdL',
    uri: '',
    qr: '/images/qr/usdt-tron.svg',
  },
  {
    id: 'btc',
    coin: 'BTC',
    network: 'Bitcoin',
    address: 'bc1qzgz6xcr0zexjz7y8tnvmtx8g2dekt56clw8prw',
    uri: '',
    qr: '/images/qr/btc.svg',
  },
];

module.exports = { DONATIONS };
