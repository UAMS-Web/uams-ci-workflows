#!/usr/bin/env bash
# Starts the database container. Reads DB_IMAGE, DB_NAME, DB_USER, DB_PASSWORD and DB_PORT.
set -euo pipefail

fail() { echo "::error::$1"; exit 1; }

[ "${RUNNER_OS:-}" = "Linux" ] || fail "The WordPress integration environment runs on Linux only; this runner is '${RUNNER_OS:-unknown}'"
[[ "$DB_IMAGE" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]*$ ]] || fail "database-image is '$DB_IMAGE', which is not an image name"
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || fail "database-name is '$DB_NAME'; use letters, digits and underscores"
[[ "$DB_USER" =~ ^[A-Za-z0-9_]+$ ]] || fail "database-user is '$DB_USER'; use letters, digits and underscores"
[[ "$DB_PORT" =~ ^[0-9]{1,5}$ ]] || fail "database-port is '$DB_PORT', which is not a port number"
[[ "$DB_PASSWORD" != *$'\n'* && "$DB_PASSWORD" != *$'\r'* ]] || fail "database-password holds a line break"

# Each value under both names, which a `mysql` and a `mariadb` image read.
args=()
put() { args+=(-e "MYSQL_$1=$2" -e "MARIADB_$1=$2"); }
put DATABASE "$DB_NAME"
if [ "$DB_USER" != "root" ]; then
  [ -n "$DB_PASSWORD" ] || fail "database-user is '$DB_USER' and database-password is empty; only root may have an empty password"
  put RANDOM_ROOT_PASSWORD yes
  put USER "$DB_USER"
  put PASSWORD "$DB_PASSWORD"
elif [ -n "$DB_PASSWORD" ]; then
  put ROOT_PASSWORD "$DB_PASSWORD"
else
  # A mariadb image reads this name too.
  args+=(-e MYSQL_ALLOW_EMPTY_PASSWORD=yes)
fi

# A second use of the action in one job starts from an empty database.
docker rm -f wordpress-integration-db > /dev/null 2>&1 || true
docker run -d --name wordpress-integration-db -p "127.0.0.1:$DB_PORT:3306" "${args[@]}" "$DB_IMAGE" || fail "The database container did not start from the image '$DB_IMAGE'"
