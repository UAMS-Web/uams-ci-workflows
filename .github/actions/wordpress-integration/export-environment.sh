#!/usr/bin/env bash
# Exports the variables the suite reads. Reads DB_NAME, DB_USER, DB_PASSWORD, DB_PORT, MULTISITE and MORE.
set -euo pipefail

fail() { echo "::error::$1"; exit 1; }

host=127.0.0.1
if [ "$DB_PORT" != "3306" ]; then host="127.0.0.1:$DB_PORT"; fi
lines=("WP_TESTS_DB_HOST=$host" "WP_TESTS_DB_NAME=$DB_NAME" "WP_TESTS_DB_USER=$DB_USER" "WP_TESTS_DB_PASSWORD=$DB_PASSWORD")
case "$MULTISITE" in
  '') ;;
  true) lines+=("WP_MULTISITE=1") ;;
  false) lines+=("WP_MULTISITE=0") ;;
  *) fail "multisite is '$MULTISITE'; use true, false or nothing" ;;
esac
names="WP_TESTS_ABSPATH"
while IFS= read -r line; do
  line=${line%$'\r'}
  if [[ "$line" =~ ^[[:space:]]*$ ]]; then continue; fi
  line=${line#"${line%%[![:space:]]*}"}
  [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || fail "env holds a line that is not NAME=value: $line"
  lines+=("$line")
done <<< "$MORE"
for line in "${lines[@]}"; do
  echo "$line" >> "$GITHUB_ENV"
  names="$names ${line%%=*}"
done
echo "Exported: $names"
