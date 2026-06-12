const { execSync } = require('child_process');

// Идентификатор запущенной сборки — вычисляется ОДИН раз при загрузке модуля,
// не на каждый запрос. Цепочка фолбэков для commit:
//   1) process.env.GIT_COMMIT — прод/Docker (build-arg прокидывает CI);
//   2) git rev-parse при наличии .git — dev/nodemon;
//   3) 'dev' — git недоступен.
// -c safe.directory='*': в dev .git приходит bind-mount'ом от uid хоста, а процесс
// бежит под node — без этого git ругается "dubious ownership" и команда падает.
function git(args) {
  return execSync(`git -c safe.directory='*' ${args}`, {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
}

function gitShort() {
  try {
    return git('rev-parse --short HEAD');
  } catch {
    return '';
  }
}

// Незакоммиченные изменения — важно для дева: код отличается от коммита.
function gitDirty() {
  try {
    return git('status --porcelain').length > 0;
  } catch {
    return false;
  }
}

function gitBranch() {
  try {
    return git('rev-parse --abbrev-ref HEAD');
  } catch {
    return '';
  }
}

const version = require('../package.json').version;
const commit = process.env.GIT_COMMIT || gitShort() || 'dev';
const dirty = commit === process.env.GIT_COMMIT ? false : gitDirty();
// branch так же из env (prod build-arg) → git → пусто.
const branch = process.env.GIT_BRANCH || gitBranch() || '';
const startedAt = new Date().toISOString();

const buildInfo = Object.freeze({ version, branch, commit, dirty, startedAt });

module.exports = buildInfo;
