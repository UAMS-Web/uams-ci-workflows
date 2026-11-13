# uams-ci-workflows
Shared reusable GitHub Actions workflows for UAMS-Web repositories

## Inputs of `ci.yml`

A caller passes these with `with:`. Every input has a default, so a caller that passes none runs the chain unchanged.

| Input | Type | Default | Effect |
| --- | --- | --- | --- |
| `linux-only` | boolean | `false` | Run every job on `ubuntu-latest` only, except the jobs named in `all-platform-jobs`. |
| `all-platform-jobs` | string | empty | Space-separated job ids kept on all three runners whatever `linux-only` says. Naming `mutate` changes nothing: that job runs on `ubuntu-latest` only. |
| `windows-jobs` | string | empty | Space-separated job ids that run on `ubuntu-latest` and `windows-latest` only, with no `macos-latest` leg, whether or not `linux-only` is set. A job also named in `all-platform-jobs` keeps all three runners. `mutate` is not affected: it runs on `ubuntu-latest` only. |
| `pest` | boolean | `true` | Run the `pest` job. Pass `false` where the suite runs as the caller's own jobs (private submodules, a secret, shards); the job is skipped and `Chain result` accepts the skip. |
| `mutate` | boolean | `true` | Run the `mutate` job. Pass `false` where the source holds no code a mutator changes; the job is skipped and `Chain result` accepts the skip. |
| `mutate-full-timeout-minutes` | number | `180` | Job timeout of the `mutate` job on a `schedule` or `workflow_dispatch` run, the events that run the full pass. Other events keep 45 minutes: a pull request or a push mutates only the changed PHP files under `mutate-paths`. |
| `mutate-ignore-paths` | string | empty | Space-separated paths the `mutate-ignore` job passes to `check-mutate-ignore.php`, for a source tree outside `app`, `src` and `tests` (a WordPress plugin's `includes`). Empty keeps the script's own default. A path with a space cannot be named. |
| `mutate-paths` | string | `src` | Paths the `mutate` job selects changed PHP files from on a pull request. |
| `share-floor-seconds` | number | `10` | Summed class time below which the `Slowest class` step skips its share check. `0` never skips it. |
| `encoding-guard`, `vitest`, `vite-build`, `mutation-smoke` | boolean | `false` | Switch on the optional job of that name. Each has a `<name>-command` input, except that `vitest-command` defaults to `npm run test:js` and `vite-build-command` to `npm run build`. |
| `npm-version` | string | empty | An npm version range to install globally before `npm ci` in the Node jobs. |

## PHP version

Each PHP job reads `config.platform.php` from the calling repository's `composer.json` and passes its `major.minor` to the setup action, so a repository pinned to `8.3.x` runs on PHP 8.3 and one with no pin runs on PHP 8.4. A `config.platform.php` that does not start with `major.minor` fails the job. The jobs that install PHP through the caller's `./.github/actions/setup` pass it as that action's `php-version` input, which the action must accept. `floor-lint` is the exception: it installs `floor-lint-php`, the floor, not the development PHP.

`shivammathur/setup-php` installs the newest patch of a minor and cannot install a patch, so the pin sets the minor only. Each job prints `PHP pinned: <pin>, installed: <version>` and raises a warning annotation when the two differ.

## PCOV

The `mutate` and `mutation-smoke` jobs load PCOV themselves, with a `shivammathur/setup-php` step after the caller's `./.github/actions/setup`, and fail with a message if `pcov` is not loaded. The caller's setup action therefore needs no `coverage` input; one that declares only `php-version` is enough.

## Runner legs

`runner-legs.yml` is a reusable workflow that checks a caller's own run of `ci.yml`: every job must have run on exactly the runners its `# Legs:` line names, given the inputs the caller passed. It reads the run's check runs, where a leg's name carries its runner and a job that never started keeps the literal `${{ matrix.os }}`, and it fails naming each job that ran on fewer or more runners. It proves which runners each job reached, not that each leg passed.

A caller adds it as a job beside its call, pinned to the same tag as `ci.yml` (the job fails when the two pins name different commits), and lists it in the `needs:` of its `CI` job:

```yaml
  legs:
    needs: [checks]
    if: always()
    uses: UAMS-Web/uams-ci-workflows/.github/workflows/runner-legs.yml@<the tag ci.yml is pinned to>
    permissions:
      contents: read
      actions: read
      checks: read
```

`UAMS-Web/wordpress-plugin-template` is the caller that proves each release: it leaves every three-runner job on, and Dependabot moves its pin to each new tag, so its run on that bump shows each job on its runners at that release. The script is `scripts/check-runner-legs.mjs`; `node --test scripts/*.test.mjs` runs its tests, which plant a missing leg, an extra leg and an unstarted job in a list taken from a real run.
