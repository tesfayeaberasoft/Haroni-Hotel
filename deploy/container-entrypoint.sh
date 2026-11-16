#!/bin/sh
set -eu

case "${PORT:-}" in
    ''|*[!0-9]*)
        echo "PORT must be set to a numeric value by the hosting platform." >&2
        exit 1
        ;;
esac

sed -i "s/__PORT__/${PORT}/g" \
    /etc/apache2/ports.conf \
    /etc/apache2/sites-available/000-default.conf

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
