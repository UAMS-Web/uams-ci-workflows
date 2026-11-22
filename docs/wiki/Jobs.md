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

## What a caller carries

Every job checks out the caller's repository, so the caller supplies the setup action, the synced `.claude/skills/` scripts the jobs run, the Composer scripts `test:pint`, `test:refactor`, `stan`, `test` and `mutate`, and `tests/skip-baseline.json` for the `pest` job. See [Calling the CI chain](Calling-the-CI-chain.md#1-carry-what-the-jobs-check-out).

<!-- cspell:ignore UAMS PCOV phpcs phpstan shivammathur -->
