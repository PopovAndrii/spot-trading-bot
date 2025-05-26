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
git clone https://gitlab.com/AndreyPopov/exchange-crypto.git
cd ./exchange-crypto
```

The entire environment is based on Docker. It must be installed.
What's inside?
```sh
php-fpm #8.2 and packeges...
composer
nodejs
npm # packege.json
```

On a Linux system, you need to create a file /src/.env with the following contents:

```sh
APP_NAME=Exchange 💰 Cryptocurrencies

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
docker compouse up -d --build # upload image and run
docker compouse up -d # only run
docker compouse up down # stop everything
docker compouse ps # see the state of all containers in the project
docker compouse exec app bush # access the application
npm start # run project

```

## Formating ESLint (inside Docker)
- ESlint and Pretier work automatically. (spaces and tabs are formatted only by VScode) But if necessary, you can run it manually.
- Check and fix one file

```
npx eslint /var/www/lib/job.js
npx eslint /var/www/lib/job.js --fix
```

## Config .vscode/settings.json in root dirrectory

```
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

## Add your files

- [ ] [Create](https://docs.gitlab.com/ee/user/project/repository/web_editor.html#create-a-file) or [upload](https://docs.gitlab.com/ee/user/project/repository/web_editor.html#upload-a-file) files
- [ ] [Add files using the command line](https://docs.gitlab.com/topics/git/add_files/#add-files-to-a-git-repository) or push an existing Git repository with the following command:

```
cd existing_repo
git remote add origin https://gitlab.com/AndreyPopov/exchange-crypto.git
git branch -M main
git push -uf origin main
```

# Editing this README

When you're ready to make this README your own, just edit this file and use the handy template below (or feel free to structure it however you want - this is just a starting point!). Thanks to [makeareadme.com](https://www.makeareadme.com/) for this template.


