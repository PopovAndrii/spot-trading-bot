const fs = require('fs/promises');
const path = require('path');

/**
 * Atomic file write: write to a temp file in the same directory, then fs.rename
 * (atomic within one filesystem). A crash/restart exactly at write time won't
 * leave broken JSON in the main file — it stays either fully old or fully new.
 * Protects the single source of truth about open orders.
 * See REQUIREMENTS.md item 22.
 *
 * @param {string} filePath - target path.
 * @param {string|Buffer} data - contents.
 * @param {string} [encoding='utf8'] - encoding.
 */
async function writeFileAtomic(filePath, data, encoding = 'utf8') {
  const dir = path.dirname(filePath);
  // temp in the same directory (rename is atomic only within one filesystem);
  // leading dot + pid + time → won't collide with configs/archives.
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);

  try {
    await fs.writeFile(tmp, data, encoding);
    await fs.rename(tmp, filePath);
  } catch (err) {
    // clean up the leftover if rename didn't happen (otherwise .tmp files pile up)
    try { await fs.unlink(tmp); } catch (_) { /* already gone — ok */ }
    throw err;
  }
}

module.exports = { writeFileAtomic };
