#!/usr/bin/env bash
# Waits until PHP can connect to the database. Reads DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, and WAIT_ATTEMPTS and WAIT_SECONDS in a test.
set -euo pipefail

php -r 'exit(extension_loaded("mysqli") ? 0 : 1);' || { echo "::error::The installed PHP has no mysqli extension, which WordPress connects with; add it to the setup action's extensions"; exit 1; }

attempts=${WAIT_ATTEMPTS:-60}
last=""
for ((i = 1; i <= attempts; i++)); do
  if last=$(php -r '
    mysqli_report(MYSQLI_REPORT_OFF);
    $db = @mysqli_connect("127.0.0.1", getenv("DB_USER"), (string) getenv("DB_PASSWORD"), getenv("DB_NAME"), (int) getenv("DB_PORT"));
    if (! $db) { echo mysqli_connect_error(); exit(1); }
    echo mysqli_get_server_info($db);
  ' 2>&1); then
    echo "Database $last answered on attempt $i"
    exit 0
  fi
  sleep "${WAIT_SECONDS:-2}"
done
docker logs --tail 50 wordpress-integration-db || true
echo "::error::The database did not accept a connection after $attempts attempts; the last answer was: $last"
exit 1
