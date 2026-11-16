FROM oven/bun:1.2-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/bun.lock frontend/bunfig.toml ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
ENV NITRO_PRESET=node-server
RUN bun run build

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        apache2 \
        libapache2-mod-php8.2 \
        mariadb-client \
        php8.2 \
        php8.2-mbstring \
        php8.2-mysql \
        supervisor \
    && rm -rf /var/lib/apt/lists/* \
    && a2enmod headers proxy proxy_http rewrite setenvif

COPY --from=frontend-build /build/frontend/.output /opt/frontend/.output
COPY backend/ /var/www/backend/
COPY deploy/apache-haroni.conf /etc/apache2/sites-available/000-default.conf
COPY deploy/ports.conf /etc/apache2/ports.conf
COPY deploy/mpm_prefork.conf /etc/apache2/mods-available/mpm_prefork.conf
COPY deploy/supervisord.conf /etc/supervisor/conf.d/haroni.conf
COPY deploy/container-entrypoint.sh /usr/local/bin/container-entrypoint

RUN chmod 0755 /usr/local/bin/container-entrypoint \
    && printf '%s\n' \
        'memory_limit=64M' \
        'max_execution_time=60' \
        > /etc/php/8.2/apache2/conf.d/99-dcms.ini \
    && mkdir -p /tmp/dcms-backups \
    && chown www-data:www-data /tmp/dcms-backups

ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=96 \
    APP_TIMEZONE=Africa/Addis_Ababa \
    MYSQLDUMP_BIN=mariadb-dump \
    DCMS_BACKUP_DIR=/tmp/dcms-backups

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/container-entrypoint"]
