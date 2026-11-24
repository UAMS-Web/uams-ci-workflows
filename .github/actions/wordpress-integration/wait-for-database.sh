#!/usr/bin/env bash
# Waits until PHP can connect to the database. Reads the WP_TESTS_DB_* values the earlier steps exported, and
# WAIT_ATTEMPTS and WAIT_SECONDS in a test.
set -euo pipefail

php -r 'exit(extension_loaded("mysqli") ? 0 : 1);' || { echo "::error::The installed PHP has no mysqli extension, which WordPress connects with; add it to the setup action's extensions"; exit 1; }

attempts=${WAIT_ATTEMPTS:-60}
last=""
for ((i = 1; i <= attempts; i++)); do
  # shellcheck disable=SC2016 # The program is PHP, so its variables are not the shell's.
  if last=$(php -r '
    mysqli_report(MYSQLI_REPORT_OFF);
    [$host, $port] = explode(":", getenv("WP_TESTS_DB_HOST"), 2) + [1 => 3306];
    $db = @mysqli_connect($host, (string) getenv("WP_TESTS_DB_USER"), (string) getenv("WP_TESTS_DB_PASSWORD"), (string) getenv("WP_TESTS_DB_NAME"), (int) $port);
    if (! $db) { echo mysqli_connect_error(); exit(1); }
    echo mysqli_get_server_info($db);
  ' 2>&1); then
    echo "Database $last answered for $WP_TESTS_DB_NAME on attempt $i"
    exit 0
  fi
  sleep "${WAIT_SECONDS:-2}"
done
docker logs --tail 50 wordpress-integration-db || true
echo "::error::The database did not accept a connection to $WP_TESTS_DB_NAME after $attempts attempts; the last answer was: $last"
exit 1
