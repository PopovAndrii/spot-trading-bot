const fs = require('fs/promises');
const path = require('path');

/**
 * Снапшот прожитого цикла перед перезаписью основного файла новым Save.
 * Раньше историю писал только autoRestart ({timestamp}-SYMBOL-exchange.json),
 * а обычный поток Stop → Cancel → Calculate → Save затирал прерванный или
 * завершённый цикл безвозвратно — терялась история реальных исполнений.
 *
 * Архивируем только если цикл реально выходил на биржу: есть хотя бы один
 * ордер с orderId. Пустой пересохранённый расчёт архивом не спамит.
 *
 * @param {string} filePath - путь к основному файлу SYMBOL-exchange.json.
 * @returns {Promise<string|null>} путь архива либо null (нечего архивировать).
 */
async function archiveIfActive(filePath) {
  let prev;
  try {
    prev = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null; // файла ещё нет (первый Save) или он битый — архивировать нечего
  }

  const hadActivity = [...(prev.BUY || []), ...(prev.SELL || [])].some(
    (o) => o && o.orderId != null
  );
  if (!hadActivity) return null;

  // То же имя, что у архивов autoRestart — recovery-скан их пропускает (^\d+-)
  const archivePath = path.join(
    path.dirname(filePath),
    `${Date.now()}-${path.basename(filePath)}`
  );
  await fs.copyFile(filePath, archivePath);
  return archivePath;
}

module.exports = { archiveIfActive };
