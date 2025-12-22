FROM node:22-bookworm

RUN apt-get update && apt-get install -y git curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www

COPY . .

USER node