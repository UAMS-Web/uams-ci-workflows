Written against v0.17.0.

The inputs of `ci.yml`, which a caller passes with `with:`. Every input has a default, so a caller that passes none runs the chain with those defaults. Job ids in a list are separated by spaces. The source of truth is the `on.workflow_call.inputs` block of [`.github/workflows/ci.yml`](https://github.com/UAMS-Web/uams-ci-workflows/blob/main/.github/workflows/ci.yml) at the tag a caller pins.

```yaml
jobs:
  checks:
    uses: UAMS-Web/uams-ci-workflows/.github/workflows/ci.yml@<tag>
    with:
      mutate-paths: src
```

## Runners

| Input | Type | Default | Effect |
| --- | --- | --- | --- |
| `linux-only` | boolean | `true` | Run every job on `ubuntu-latest` only, except the jobs named in `all-platform-jobs` or `windows-jobs`. Pass `false` to run each job on the runners its classification names. |
| `all-platform-jobs` | string | empty | Job ids run on all three runners whatever `linux-only` says. Naming `mutate` changes nothing. |
| `windows-jobs` | string | empty | Job ids run on `ubuntu-latest` and `windows-latest` only, with no `macos-latest` leg, whatever `linux-only` says. A job also named in `all-platform-jobs` keeps all three. `mutate` is not affected. |

See [Choosing runners for each job](Choosing-runners-for-each-job.md).

## Pest

| Input | Type | Default | Effect |
| --- | --- | --- | --- |
| `pest` | boolean | `true` | Run the `pest` job. Pass `false` where the suite runs as the caller's own jobs (private submodules, a secret, shards); the skip is accepted by `Chain result`. |
| `pest-command` | string | `composer test` | The command the `pest` job runs. The default runs with a JUnit report and the skip-baseline and slowest-class checks that read it; any other command runs as given, and those two checks are skipped because no report is written. |
| `share-floor-seconds` | number | `10` | Summed class time, in seconds, below which the `Slowest class` step skips its share check. `0` never skips it. |
| `global-test-symbols` | boolean | `true` | Run the `Global test symbols` step, which guards `pest --parallel` with a script of the `pest-testing` skill. Pass `false` in a repository that does not receive that skill. |

## Mutation testing

| Input | Type | Default | Effect |
| --- | --- | --- | --- |
| `mutate` | boolean | `true` | Run the `mutate` job. Pass `false` where the source holds no code a mutator changes. It also skips `mutate-ignore` unless that input is `true`. |
| `mutate-ignore` | boolean | `false` | Run the `mutate-ignore` job when `mutate` is `false`. It audits the `@pest-mutate-ignore` annotations without a mutation pass. It runs whenever `mutate` is `true`. Needs `check-mutate-ignore.php` from the `pest-testing` skill. |
| `mutate-ignore-paths` | string | empty | Paths the `mutate-ignore` job scans for annotations. Empty keeps the script's default, whichever of `app`, `src` and `tests` exist. A WordPress plugin names its source directory, such as `includes`. A path with a space cannot be named. |
| `mutate-paths` | string | `src` | Paths the `mutate` job selects changed PHP files from, the paths `composer mutate` passes to `--path`. |
| `mutate-timeout-minutes` | number | `45` | Timeout of the `mutate` job on a pull request or a push. A value above `360`, the longest job GitHub runs, is clamped to `360`. |
| `mutate-full-timeout-minutes` | number | `180` | Timeout of the `mutate` job on a `schedule` or `workflow_dispatch` run, which mutates everything. |
| `mutate-shards` | number | `1` | Number of jobs a scheduled or dispatched run splits the full pass across, balanced by file size. Clamped to the number of files and to 100. A value that is not a whole number of 1 or more fails the run. |
| `mutate-advisory` | boolean | `false` | Run the `mutate` job, every shard of it, without its result gating `Chain result`. The job still reports its own status, and `Chain result` prints a warning for it in place of failing. `mutate-plan` still gates. Added after v0.14.0. |
| `mutate-submodules` | string | empty | Paths of the caller's submodules the `mutate` job checks out, at depth 1. Empty checks out none. A path `.gitmodules` does not register as a submodule fails the job. A private submodule also needs the `mutate-submodules-token` secret. Added after v0.14.0. |
| `mutate-submodules-recursive` | boolean | `false` | Check out the submodules nested inside the ones `mutate-submodules` names as well. Added after v0.14.0. |
| `mutate-wordpress` | boolean | `false` | Stand up a WordPress integration environment in the `mutate` job before `composer mutate`: a database, a WordPress download, the Composer setup under `tests/Integration` and the `WP_TESTS_*` variables. Added after v0.17.0. |
| `mutate-wordpress-version` | string | empty | The WordPress version it downloads. Empty reads the version of `wp-phpunit/wp-phpunit` in `tests/Integration/composer.lock`. Added after v0.17.0. |
| `mutate-wordpress-multisite` | string | empty | `true` exports `WP_MULTISITE=1` and `false` exports `WP_MULTISITE=0`. Empty exports neither and leaves the choice to the suite. Added after v0.17.0. |
| `mutate-wordpress-database-image` | string | `mysql:8.0` | The image of the database container, a `mysql` or `mariadb` tag. Added after v0.17.0. |
| `mutate-wordpress-env` | string | empty | More variables to export for the suite, one `NAME=value` a line. Added after v0.17.0. |

The `mutate` job also takes one secret, passed by name with `secrets:` beside `with:`. `secrets: inherit` cannot supply it, because a repository or organization secret's name cannot hold a hyphen.

| Secret | Required | Effect |
| --- | --- | --- |
| `mutate-submodules-token` | no | A token the `mutate` job fetches the named submodules with, in place of the job's own, for a submodule in a private repository. It needs read access to every submodule named. It is never written to disk, so later steps cannot read it. Without it the fetch uses the job's own token, which reads only the calling repository. Added after v0.14.0. |

See [Running the full mutation pass](Running-the-full-mutation-pass.md).

## Optional jobs

| Input | Type | Default | Effect |
| --- | --- | --- | --- |
| `encoding-guard` | boolean | `false` | Run the `encoding-guard` job. |
| `encoding-guard-command` | string | empty | The command it runs after a locked Composer install. |
| `vitest` | boolean | `false` | Run the `vitest` job. |
| `vitest-command` | string | `npm run test:js` | The command it runs after `npm ci`. |
| `vite-build` | boolean | `false` | Run the `vite-build` job. |
| `vite-build-command` | string | `npm run build` | The command it runs after a locked Composer install and `npm ci`. |
| `mutation-smoke` | boolean | `false` | Run the `mutation-smoke` job. |
| `mutation-smoke-command` | string | empty | The command it runs with PCOV loaded, after a locked Composer install. |
| `npm-version` | string | empty | An npm version range installed globally before `npm ci` in the Node jobs. Empty keeps the npm that Node ships. |
| `floor-lint` | boolean | `false` | Run the `floor-lint` job, which parses the shipped PHP files under the supported floor. |
| `floor-lint-php` | string | `8.2` | The PHP version `floor-lint` installs. |
| `floor-lint-command` | string | `php scripts/lint-floor.php` | The command `floor-lint` runs. |
| `download-archive` | boolean | `false` | Run the `download-archive` job, which checks that the GitHub download holds only what the plugin runs. |
| `download-archive-command` | string | `node scripts/check-download-archive.mjs` | The command it runs. |
| `phpcs` | boolean | `false` | Run the `phpcs` job. |
| `phpcs-command` | string | `composer test:phpcs` | The command it runs after a locked Composer install: the WordPress security sniffs. |
| `guard` | boolean | `false` | Run the `guard` job, which fails when a tracked path looks like a secret or personal data. |
| `guard-patterns` | string | empty | Extra extended regular expressions, separated by spaces or newlines, matched against each tracked path. They add to the built-in patterns (`wp-config.php`, `.sql`, `.csv`, `.tsv`, `.xlsx`, `.env`, `.pem`, `.key`) and never replace them. |
| `dev-lint` | boolean | `false` | Run the `dev-lint` job, which runs `php -l` on every PHP file under the development PHP. |
| `dev-lint-exclude` | string | empty | Paths `dev-lint` skips, relative to the repository root, with no spaces inside a path. `vendor` and `node_modules` are always skipped. |

See [Turning on optional jobs](Turning-on-optional-jobs.md).

## `runner-legs.yml`

| Input | Type | Default | Effect |
| --- | --- | --- | --- |
| `caller-job` | string | `checks` | The id of the caller's job that calls `ci.yml`; its check runs are named `<caller-job> / <job name>`. |

See [Checking runner legs](Checking-runner-legs.md).

<!-- cspell:ignore UAMS PCOV phpcs -->
