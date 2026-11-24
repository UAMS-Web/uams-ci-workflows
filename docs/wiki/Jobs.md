Written against v0.17.0.

The jobs of `ci.yml`, the runners each is classified for, and the PHP and PCOV setup they share. Each job's `# Legs:` line in [`.github/workflows/ci.yml`](https://github.com/UAMS-Web/uams-ci-workflows/blob/main/.github/workflows/ci.yml) states its classification and the evidence for it; the code-quality skill's "Which jobs run on which operating system" section in `UAMS-Web/uams-claude-skills` holds that evidence. A job with no recorded evidence is classified for all three. The classification says which runners a job can run on, not which it does: a caller that passes no leg input gets `ubuntu-latest` only for every job, and `linux-only: false` runs each job on the runners named here (see [Choosing runners for each job](Choosing-runners-for-each-job.md)).

## The chain

| Job id | Check name | Runners | Switched by |
| --- | --- | --- | --- |
| `composer-validate` | Composer validate (composer.lock freshness) | Linux only | always on |
| `synced-files` | Synced files (no hand-edited rules or skills) | Linux only | always on |
| `no-emoji` | No emoji in durable records | Linux only | always on |
| `aggregate-needs` | Aggregate needs | Linux only | always on |
| `pint` | Pint | Linux only | always on |
| `rector` | Rector | Linux only | always on |
| `phpstan` | PHPStan | Linux only | always on |
| `mutate-ignore` | Mutation annotations (none inert) | all three | `mutate` or `mutate-ignore` |
| `mutate-plan` | Plan the mutation shards | Linux only | `mutate` |
| `mutate` | Mutation score (changed files, with PCOV) | `ubuntu-latest` only, whatever the inputs | `mutate` |
| `pest` | Pest | all three | `pest` |
| `encoding-guard` | Encoding guard | Linux only | `encoding-guard` |
| `vitest` | JS unit tests | all three | `vitest` |
| `vite-build` | Vite build | Linux only | `vite-build` |
| `mutation-smoke` | Mutation tooling smoke | all three | `mutation-smoke` |
| `floor-lint` | Floor lint (PHP `floor-lint-php`) | Linux only | `floor-lint` |
| `download-archive` | Download archive | Linux only | `download-archive` |
| `phpcs` | phpcs (WordPress security sniffs) | Linux only | `phpcs` |
| `guard` | Guard against tracked secrets or personal data | Linux only | `guard` |
| `dev-lint` | PHP lint (development PHP) | Linux only | `dev-lint` |
| `result` | Chain result | `ubuntu-latest` | always runs (`if: always()`) |

A check name is followed by its runner, `(<operating system>)`, and a mutation shard adds `, shard <n> of <count>`. Called from a caller's `checks` job, each reports as `checks / <check name> (<operating system>)`.

## Chain result

`result` needs every job and runs `if: always()`. It prints each needed job and its result, and fails unless each one succeeded. A `skipped` result is accepted only for a job whose input switched it off; `skipped` for any other reason, and `cancelled`, fail it. A caller's `CI` job needs the call, so `CI` passes only when `Chain result` did ([Calling the CI chain](Calling-the-CI-chain.md)).

## PHP version

Each PHP job reads `config.platform.php` from the calling repository's `composer.json` and installs its `major.minor`:

- A repository pinned to `8.3.x` (for example `8.3.0`) runs on PHP 8.3.
- A repository with no pin runs on PHP 8.4, and the job prints `No config.platform.php in composer.json; installing the default PHP 8.4.`
- A pin that is not a version of the form `major.minor` or `major.minor.patch` fails the job ([Troubleshooting](Troubleshooting.md#the-php-pin-is-not-a-version)).

The jobs that install PHP through the caller's `./.github/actions/setup` pass the minor as that action's `php-version` input, which the action must accept. `shivammathur/setup-php` installs the newest patch of a minor and cannot install a given patch, so the pin sets the minor only; each job prints `PHP pinned: <pin>, installed: <version>` and raises a warning annotation when the two differ. `floor-lint` is the exception: it installs `floor-lint-php`, the floor, not the development PHP.

## PCOV

The `mutate` and `mutation-smoke` jobs load PCOV themselves, with a `shivammathur/setup-php` step after the caller's setup action, and fail when `pcov` is not loaded. The caller's setup action therefore needs no `coverage` input; one that declares only `php-version` is enough.

## WordPress integration environment

The composite action [`.github/actions/wordpress-integration`](https://github.com/UAMS-Web/uams-ci-workflows/tree/main/.github/actions/wordpress-integration) stands up what a WordPress Integration suite needs, on Linux, in the job that uses it:

- a `mysql` or `mariadb` container on `127.0.0.1` (a composite action cannot declare `services:`);
- WordPress, at the version of `wp-phpunit/wp-phpunit` in the suite's `composer.lock` unless one is named, in `$RUNNER_TEMP/wordpress`;
- the Composer setup under `tests/Integration`;
- `WP_TESTS_ABSPATH`, `WP_TESTS_DB_HOST`, `WP_TESTS_DB_NAME`, `WP_TESTS_DB_USER` and `WP_TESTS_DB_PASSWORD`, with `WP_MULTISITE` when the install shape is named and any variable the caller adds.

The `mutate` job uses it when `mutate-wordpress` is `true`. A caller's own integration job can use it too, after its checkout and its PHP and Composer setup, pinned to the tag the call is pinned to:

```yaml
      - uses: UAMS-Web/uams-ci-workflows/.github/actions/wordpress-integration@<tag>
        with:
          multisite: ${{ matrix.mode == 'multisite' }}
      - run: composer test:integration
```

| Input | Default | Effect |
| --- | --- | --- |
| `integration-path` | `tests/Integration` | The directory of the suite's own Composer setup. |
| `wordpress-version` | empty | The WordPress version; empty reads it from the lock. |
| `multisite` | empty | `true` exports `WP_MULTISITE=1`, `false` exports `WP_MULTISITE=0`, empty exports neither. |
| `env` | empty | More variables, one `NAME=value` a line, exported last. |
| `database-image` | `mysql:8.0` | The image of the database container. |
| `database-name` | `wordpress_tests` | The database, which the suite's installer empties. |
| `database-user` | `root` | The user the suite connects as. Another user is created with privileges on that database alone. |
| `database-password` | empty | That user's password. Empty is allowed for `root` only. It is not a secret: the container ends with the runner. |
| `database-port` | `3306` | The port on `127.0.0.1`. |

The action needs a pin after v0.17.0. It sets up no licensed plugin and no plugin outside the suite's Composer setup; a caller that needs one adds its own step.

## What a caller carries

Every job checks out the caller's repository, so the caller supplies the setup action, the synced `.claude/skills/` scripts the jobs run, the Composer scripts `test:pint`, `test:refactor`, `stan`, `test` and `mutate`, and `tests/skip-baseline.json` for the `pest` job. See [Calling the CI chain](Calling-the-CI-chain.md#1-carry-what-the-jobs-check-out).

<!-- cspell:ignore UAMS PCOV phpcs phpstan shivammathur -->
