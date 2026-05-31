# Exchange 💰 Cryptocurrencies

## Description
Automatic cryptocurrency exchange.

The main principle of the program:
- bought cheap -> sold more expensive.
- sold expensive -> bought cheaper.

The rates are calculated before they are posted on the exchange (Binance). 
That is, you have the opportunity to calculate your trading strategy before it is launched.

## Installation

```sh
git clone git@gitlab.com:AndreyPopov/exchange-crypto.git
cd ./exchange-crypto
```

The entire environment is based on Docker. It must be installed - [Docker.](https://docs.docker.com/engine/install/) And Docker Desktop on Windows
What's inside?
```sh
nodejs
npm # packege.json
```

On a Linux system, you need to create a file /src/.env with the following contents:

```sh
APP_NAME=Exchange 💰 Cryptocurrencies

# NODE_ENV=development
# for pm2 production
NODE_ENV=production

ADMIN_LOGIN=admin
# Generate login / password / secret with:  npm run setup-user
# or manually: node -e "console.log(require('bcrypt').hashSync('your-password', 10))"
ADMIN_PASSWORD_HASH='$2b$10$duSulJ1o08aAsw8xOCg/4eAu.vasc6kdim.1G.i/IwfMcWlCVDzQ2'
SESSION_SECRET='1o08aAsw8xOCg'
# STATUS_LOGIN=false # optional: disable login completely

# SSH_PATH=/c/Users/YourUsername/.ssh # for Windows users
SSH_PATH=~/.ssh # for Linux users 
USER=YourUsername # Windows and Linux

# GITCONFIG_PATH=/c/Users/YourUsername/.gitconfig # for Windows users
GITCONFIG_PATH=~/.gitconfig # for Linux users

PREFIX_CONTAINER_NAME=dev # or prod | If 2 containers are required to operate simultaneously
 
STATUS_APP=false # false === dev mode. Without a request on Binance 

# Which Binance to use: test | real (independent of NODE_ENV)
BINANCE_MODE=test

# Real keys — optional. If missing, the app falls back to testnet.
API_KEY='you_key_form_binance_api'
API_SECRET='you_secret_key_form_binance_api'

# Test keys — required (used in testnet and as the safe fallback).
API_KEY_TEST='you_testnet_key_form_binance'
API_SECRET_TEST='you_testnet_secret_form_binance'

TIMER=1000

PORT=3002

NGINX_PORT=8002
NGINX_PORT_SSL=445

```
After that, run ./int and follow the instructions.
***

In Windows, create two identical files (the contents of the file above): 
```
/.env
/src/.env
```
***

## Usage

```sh
docker compouse up -d --build # Upload image and run. First start or update images
docker compouse up -d # Only run. Typical work
docker compouse down # Stop everything
docker compouse ps # See the state of all containers in the project
docker stats # Check container loads
docker compouse exec app bush # Access the application
npm start # Run a project
npm run dev # Run a project with sass watching
npm run build-css # Build only sass file

# If production mod (For install devdevDependencies)
NODE_ENV=development npm install # for generete css style etc... 

# start script pm2
chmod +x docker-config/entrypoint.sh

# Launch the application (production)
docker compose exec app sh -c "npm run prod-start"
# Application status information (cpu logs mem) 
docker compose exec app sh -c "npm exec pm2 monit"
# Logs
docker compose exec app sh -c "npm exec pm2 logs my-app --lines 20"
# Quick logs
docker compose exec app sh -c "npm exec pm2 list"
# For restart app after reboot server
docker compose exec app sh -c "npm exec pm2 save"
# Stop
docker compose exec app sh -c "npm exec pm2 stop id|name|namespace"
```

## Account & API keys setup

Interactive script that writes the login, password and Binance keys into `src/.env`:

```sh
# locally
npm run setup-user
# inside the container
docker compose exec app bash -c "npm run setup-user"
```

It asks for:
- **Login** and **password** (min 8 chars) → stored as `ADMIN_LOGIN` + bcrypt `ADMIN_PASSWORD_HASH`; also generates `SESSION_SECRET` if it is empty.
- **Mode** — `test` / `real` → `BINANCE_MODE`.
- **Real keys** — optional (`API_KEY` / `API_SECRET`).
- **Test keys** — required (`API_KEY_TEST` / `API_SECRET_TEST`).

Restart the app afterwards so it re-reads `.env`.

`BINANCE_MODE` selects which Binance to talk to, independent of `NODE_ENV` (which only controls dev tooling / browser-sync):
- `BINANCE_MODE=test` → Binance testnet.
- `BINANCE_MODE=real` → real Binance.
- not set → falls back to `NODE_ENV=development` → testnet.

**Safe fallback:** if `real` is selected but the real keys are missing, the app automatically runs on **testnet** instead of crashing. That is why the test keys are required.

Manual one-liners (instead of the script):

```sh
# bcrypt password hash → ADMIN_PASSWORD_HASH
node -e "console.log(require('bcrypt').hashSync(process.argv[1],10))" 'your-password'
# random session secret → SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Footer — network mode indicator

The footer shows which Binance environment is actually used:

| Label | Meaning |
|-------|---------|
| `TESTNET` | test mode (`BINANCE_MODE=test`) |
| `REAL` | real mode with real keys |
| `REAL → TESTNET (no keys)` | `real` selected, but real keys are missing → running on testnet (fallback) |

## Formating ESLint (inside Docker)
- ESlint and Pretier work automatically. (spaces and tabs are formatted only by VScode) But if necessary, you can run it manually.
- Check and fix one file

```sh
npx eslint /var/www/lib/job.js
npx eslint /var/www/lib/job.js --fix
```

## Config .vscode/settings.json in root dirrectory
VScode must have the ESlint plugin from Microsoft installed.
```json
{
  "editor.formatOnSave": true,
  "editor.insertSpaces": true,
  "editor.tabSize": 2,
  "editor.detectIndentation": false,
  "editor.codeActionsOnSave": {
    "source.fixAll": true,
    "source.fixAll.eslint": true
  },
  "eslint.validate": [
    "javascript"
  ],
  "eslint.experimental.useFlatConfig": true
}
```



