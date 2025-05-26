FROM php:8.2-fpm

ARG USER
ARG UID
ARG GID

RUN ln -snf /usr/share/zoneinfo/UTC /etc/localtime && echo UTC > /etc/timezone

RUN curl -sS https://deb.nodesource.com/setup_22.x ./node_setup.bash | bash -

RUN apt-get update && apt-get install -y \
    git \
    curl \
    libfreetype-dev libjpeg-dev libpng-dev libwebp-dev \
    libxml2-dev \
    libonig-dev \
    libpq-dev \
    libzip-dev \
    nodejs

RUN pecl install redis xdebug && docker-php-ext-enable redis xdebug && \
    docker-php-ext-install bcmath exif mbstring pcntl zip\
    mysqli pdo_mysql \
    pgsql pdo_pgsql && \
    docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp && \
    docker-php-ext-install gd && \
    rm -rf /var/lib/apt/lists/*

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

RUN useradd -G www-data,root -u $UID -d /home/$USER $USER
RUN mkdir -p /home/$USER/.composer && \
    chown -R $USER:$USER /home/$USER

WORKDIR /var/www

USER $USER
