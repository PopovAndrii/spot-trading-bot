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
# Generate password
# node -e "console.log(require('bcrypt').hashSync('you-password-hash', 10))"
ADMIN_PASSWORD_HASH='$2b$10$duSulJ1o08aAsw8xOCg/4eAu.vasc6kdim.1G.i/IwfMcWlCVDzQ2'
SESSION_SECRET='1o08aAsw8xOCg'

# SSH_PATH=/c/Users/YourUsername/.ssh # for Windows users
SSH_PATH=~/.ssh # for Linux users 
USER=YourUsername # Windows and Linux

# GITCONFIG_PATH=/c/Users/YourUsername/.gitconfig # for Windows users
GITCONFIG_PATH=~/.gitconfig # for Linux users

PREFIX_CONTAINER_NAME=dev # or prod | If 2 containers are required to operate simultaneously
 
STATUS_APP=false # false === dev mode. Without a request on Binance 

API_KEY='you_key_form_binance_api'
API_SECRET='you_secret_key_form_binance_api'

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



