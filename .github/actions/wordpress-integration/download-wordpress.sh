#!/usr/bin/env bash
# Downloads WordPress to $RUNNER_TEMP/wordpress and exports WP_TESTS_ABSPATH. Reads INTEGRATION_PATH and WORDPRESS_VERSION.
set -euo pipefail

fail() { echo "::error::$1"; exit 1; }

version=$WORDPRESS_VERSION
source="the wordpress-version input"
if [ -z "$version" ]; then
  lock="$INTEGRATION_PATH/composer.lock"
  [ -f "$lock" ] || fail "There is no $lock to read the WordPress version from; commit it, or pass the version"
  version=$(jq -r '[((.packages // []) + (."packages-dev" // []))[] | select(.name == "wp-phpunit/wp-phpunit") | .version][0] // empty' "$lock")
  [ -n "$version" ] || fail "$lock does not lock wp-phpunit/wp-phpunit, so the WordPress version cannot be read from it; pass the version"
  source="wp-phpunit/wp-phpunit in $lock"
fi
version=${version#v}
[[ "$version" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?(-(beta|RC)[0-9]+)?$ ]] || fail "The WordPress version is '$version' (from $source), which is not a release number"
# wordpress.org publishes a dot-zero release without the `.0`: `wordpress-6.8.tar.gz`, `wordpress-6.8-RC1.tar.gz`.
if [[ "$version" =~ ^([0-9]+\.[0-9]+)\.0(-.*)?$ ]]; then version="${BASH_REMATCH[1]}${BASH_REMATCH[2]:-}"; fi

target="$RUNNER_TEMP/wordpress"
rm -rf "$target"
mkdir -p "$target"
curl -fsSL --retry 3 -o "$RUNNER_TEMP/wordpress.tar.gz" "https://wordpress.org/wordpress-$version.tar.gz"
tar -xzf "$RUNNER_TEMP/wordpress.tar.gz" --strip-components=1 -C "$target"
[ -f "$target/wp-settings.php" ] || fail "The WordPress $version download holds no wp-settings.php"
echo "WP_TESTS_ABSPATH=$target" >> "$GITHUB_ENV"
echo "WordPress $version (from $source) is in $target"
