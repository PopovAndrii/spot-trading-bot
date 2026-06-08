const fs = require('fs/promises');
const path = require('path');

/**
 * Атомарная запись файла: пишем во временный файл в той же директории, затем
 * fs.rename (атомарен на одной ФС). Падение/рестарт ровно в момент записи не
 * оставит битый JSON в основном файле — он остаётся либо старым целиком, либо
 * новым целиком. Защищает единственный источник правды об открытых ордерах.
 * См. REQUIREMENTS.md п.22.
 *
 * @param {string} filePath - целевой путь.
 * @param {string|Buffer} data - содержимое.
 * @param {string} [encoding='utf8'] - кодировка.
 */
async function writeFileAtomic(filePath, data, encoding = 'utf8') {
  const dir = path.dirname(filePath);
  // temp в той же директории (rename атомарен только в пределах одной ФС);
  // лидирующая точка + pid + время → не пересекается с конфигами/архивами.
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);

  try {
    await fs.writeFile(tmp, data, encoding);
    await fs.rename(tmp, filePath);
  } catch (err) {
    // подчистить хвост, если rename не случился (иначе копятся .tmp)
    try { await fs.unlink(tmp); } catch (_) { /* уже нет — ок */ }
    throw err;
  }
}

module.exports = { writeFileAtomic };
