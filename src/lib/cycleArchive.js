const fs = require('fs/promises');
const path = require('path');

/**
 * Snapshot of a lived cycle before the main file is overwritten by a new Save.
 * Previously only autoRestart wrote history ({timestamp}-SYMBOL-exchange.json),
 * while the normal flow Stop → Cancel → Calculate → Save overwrote an interrupted
 * or finished cycle irreversibly — the history of real fills was lost.
 *
 * Archive only if the cycle actually reached the exchange: there is at least one
 * order with an orderId. An empty re-saved calculation doesn't spam archives.
 *
 * @param {string} filePath - path to the main SYMBOL-exchange.json file.
 * @returns {Promise<string|null>} archive path or null (nothing to archive).
 */
async function archiveIfActive(filePath) {
  let prev;
  try {
    prev = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null; // file doesn't exist yet (first Save) or is corrupt — nothing to archive
  }

  const hadActivity = [...(prev.BUY || []), ...(prev.SELL || [])].some(
    (o) => o && o.orderId != null
  );
  if (!hadActivity) return null;

  // Same name as autoRestart archives — the recovery scan skips them (^\d+-)
  const archivePath = path.join(
    path.dirname(filePath),
    `${Date.now()}-${path.basename(filePath)}`
  );
  await fs.copyFile(filePath, archivePath);
  return archivePath;
}

module.exports = { archiveIfActive };
