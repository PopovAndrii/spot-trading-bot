// Донат-адреса автора проекта. Статика: одни на всех, кто развернёт копию бота.
// Никакого бекенда/кастоди/внешних сервисов — просто показываем адрес + QR.
//
// QR в public/images/qr/<id>.svg генерируется офлайн из `address` (вариант A):
//   npm run gen-qr   (см. tools/gen-qr.js — qrcode только в devDependencies)
const DONATIONS = [
  {
    id: 'usdt-polygon',
    coin: 'USDT',
    network: 'EVM · Polygon/BNB/ETH',
    // EVM-адрес: один и тот же для любой EVM-сети (Polygon/BNB/ETH/Arbitrum…).
    address: '0xBA5DFcab30DE75125A3a6950263cF088f313C59F',
    uri: '', // голый адрес — сеть/токен выбираются в кошельке при отправке
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
