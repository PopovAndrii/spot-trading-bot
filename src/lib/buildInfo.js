const { execSync } = require('child_process');

// Identifier of the running build — computed ONCE at module load, not per request.
// Fallback chain for commit:
//   1) process.env.GIT_COMMIT — prod/Docker (build-arg passed by CI);
//   2) git rev-parse when .git is present — dev/nodemon;
//   3) 'dev' — git unavailable.
// -c safe.directory='*': in dev, .git comes via a bind-mount under the host uid,
// while the process runs as node — without this git complains "dubious ownership"
// and the command fails.
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

// Uncommitted changes — important for dev: the code differs from the commit.
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
// branch likewise from env (prod build-arg) → git → empty.
const branch = process.env.GIT_BRANCH || gitBranch() || '';
const startedAt = new Date().toISOString();

const buildInfo = Object.freeze({ version, branch, commit, dirty, startedAt });

module.exports = buildInfo;
