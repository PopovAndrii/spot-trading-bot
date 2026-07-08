#!/usr/bin/env node
// Interactive setup of Binance account and keys.
// Asks for username + password, mode (test/real), and optionally Binance keys,
// generates a bcrypt hash (using the same bcrypt as login.js) and SESSION_SECRET,
// then writes everything to .env. Keys can be skipped (Enter).
// Run: npm run setup-user
// In a container: docker compose run --rm app npm run setup-user

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const bcrypt = require('bcrypt');

// ENV_OUT — where to write .env. Needed for the prod image: src is baked into the
// image, so the host directory is mounted separately (-v ./src:/out) and
// ENV_OUT=/out/.env is set (see README, Production launch section).
const ENV_PATH = process.env.ENV_OUT || path.join(__dirname, '..', '.env');
const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;

function question(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(query, (a) => {
      rl.close();
      resolve(a);
    })
  );
}

// Hidden input: show a hint, mask characters with asterisks.
function hiddenQuestion(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.stdoutMuted = true;
    rl._writeToOutput = function (str) {
      if (rl.stdoutMuted) {
        rl.output.write('\x1B[2K\x1B[200D' + query + '*'.repeat((rl.line || '').length));
      } else {
        rl.output.write(str);
      }
    };
    rl.question(query, (value) => {
      rl.output.write('\n');
      rl.close();
      resolve(value);
    });
  });
}

// Replaces the KEY=... string or adds it; leaves the rest in .env untouched.
function upsertEnv(content, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) return content.replace(re, line);
  const sep = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  return content + sep + line + '\n';
}

function getEnvValue(content, key) {
  const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

// quote for BCRTPT
const quote = (v) => `'${v}'`;

// Asks for a key+secret pair. required=true — keeps asking until entered;
// otherwise, an empty key = skip (returns null).
async function askKeyPair(title, { required = false } = {}) {
  for (;;) {
    console.log(`\n${title}${required ? ' (required)' : ' (Enter — skip)'}:`);
    const key = (await question('  API key: ')).trim();
    if (!key) {
      if (required) {
        console.log('  🔴 Keys are required for this mode');
        continue;
      }
      console.log('  ⏭  omitted');
      return null;
    }
    const secret = (await hiddenQuestion('  API secret: ')).trim();
    if (!secret) {
      if (required) {
        console.log('  🔴 secret is required');
        continue;
      }
      console.log('  🔴 secret is empty — pair skipped');
      return null;
    }
    return { key, secret };
  }
}

(async () => {
  let content = '';
  try {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  } catch {
    console.log(`🟡 ${ENV_PATH} not found — a new one will be created`);
  }

  // --- login ---
  const login = (await question('Login: ')).trim();
  if (!login) {
    console.error('🔴 Username cannot be empty');
    process.exit(1);
  }

  // --- passwd ---
  const password = await hiddenQuestion('Password: ');
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`🔴 Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
    process.exit(1);
  }
  const repeat = await hiddenQuestion('Repeat password: ');
  if (password !== repeat) {
    console.error('🔴 Passwords do not match');
    process.exit(1);
  }

  content = upsertEnv(content, 'ADMIN_LOGIN', login);
  content = upsertEnv(
    content,
    'ADMIN_PASSWORD_HASH',
    quote(bcrypt.hashSync(password, SALT_ROUNDS))
  );

  // We generate SESSION_SECRET only if it is empty/missing, to avoid logging out.
  if (!getEnvValue(content, 'SESSION_SECRET')) {
    content = upsertEnv(content, 'SESSION_SECRET', quote(crypto.randomBytes(32).toString('hex')));
    console.log('🆕 SESSION_SECRET generated');
  }

  // --- operating mode ---
  const modeAns = (await question('\nMode — [t]est / [r]eal (default test): '))
    .trim()
    .toLowerCase();
  const mode = modeAns.startsWith('r') ? 'real' : 'test';
  content = upsertEnv(content, 'BINANCE_MODE', mode);
  console.log(`   BINANCE_MODE=${mode}`);

  // --- runtime ---
  // NODE_ENV: production for defaul (development up browser-sync).
  const envAns = (
    await question('\nNODE_ENV — [p]roduction / [d]evelopment (default production): ')
  )
    .trim()
    .toLowerCase();
  const nodeEnv = envAns.startsWith('d') ? 'development' : 'production';
  content = upsertEnv(content, 'NODE_ENV', nodeEnv);
  console.log(`   NODE_ENV=${nodeEnv}`);

  // --- HTTP request logging level ---
  // off — no request logs; app — app routes only (hides the static asset flood); all — everything.
  const logAns = (await question('\nHTTP_LOG — [o]ff / [a]pp / a[l]l (default app): '))
    .trim()
    .toLowerCase();
  const httpLog = logAns.startsWith('o')
    ? 'off'
    : logAns === 'all' || logAns.startsWith('l')
      ? 'all'
      : 'app';
  content = upsertEnv(content, 'HTTP_LOG', httpLog);
  console.log(`   HTTP_LOG=${httpLog}`);

  // --- kys ---
  // Real — optional (without them, the application will fall back to testnet).
  const real = await askKeyPair('Real Binance keys');
  if (real) {
    content = upsertEnv(content, 'API_KEY', quote(real.key));
    content = upsertEnv(content, 'API_SECRET', quote(real.secret));
  }

  // Test values — required (they are used for fallback so the container doesn’t crash).
  // If already set in .env — no need to re-enter.
  const hasTestAlready =
    getEnvValue(content, 'API_KEY_TEST') && getEnvValue(content, 'API_SECRET_TEST');
  const test = await askKeyPair('Binance test keys (testnet)', { required: !hasTestAlready });
  if (test) {
    content = upsertEnv(content, 'API_KEY_TEST', quote(test.key));
    content = upsertEnv(content, 'API_SECRET_TEST', quote(test.secret));
  }

  fs.writeFileSync(ENV_PATH, content, 'utf8');
  try {
    fs.chmodSync(ENV_PATH, 0o600); // secrets — for the owner only
  } catch {
    /* in some containers, chmod may be prohibited */
  }

  console.log(`\n✅ Saved in ${ENV_PATH}`);
  console.log(`   ADMIN_LOGIN=${login}`);
  console.log('   ADMIN_PASSWORD_HASH=<bcrypt-hash is set>');

  // No more crashes: if no real keys are present, the application automatically switches to testnet.
  const hasReal = getEnvValue(content, 'API_KEY') && getEnvValue(content, 'API_SECRET');
  if (mode === 'real' && !hasReal) {
    console.log(
      '⚠️  Real mode is selected, but there are no real keys — the application will run on the testnet (fallback).'
    );
  }
  console.log('ℹ️  Restart the application so it re-reads file settings.');
  process.exit(0);
})();
