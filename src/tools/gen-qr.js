const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { DONATIONS } = require('../lib/donations');

const outDir = path.join(__dirname, '..', 'public', 'images', 'qr');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  for (const d of DONATIONS) {
    const data = d.uri || d.address;
    const file = path.join(outDir, `${d.id}.svg`);
    const svg = await QRCode.toString(data, {
      type: 'svg',
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#111111', light: '#ffffff' },
    });
    fs.writeFileSync(file, svg);
    console.log(`✓ ${d.id}: ${data} -> ${path.relative(process.cwd(), file)}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
