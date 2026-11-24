Written against v0.14.0.

One entry per error a run prints. Each heading names what the reader sees; the exact log line is under it.

- [The PHP pin is not a version](#the-php-pin-is-not-a-version)
- [A job is on but its command is empty](#a-job-is-on-but-its-command-is-empty)
- [Chain result names a job that reported skipped](#chain-result-names-a-job-that-reported-skipped)
- [PCOV is not loaded](#pcov-is-not-loaded)
- [mutate-shards is not a whole number](#mutate-shards-is-not-a-whole-number)
- [mutate-submodules names a path that is not a submodule](#mutate-submodules-names-a-path-that-is-not-a-submodule)
- [The WordPress integration environment did not start](#the-wordpress-integration-environment-did-not-start)
- [No tracked PHP file to shard](#no-tracked-php-file-to-shard)
- [A path the shard list or --path cannot carry](#a-path-the-shard-list-or---path-cannot-carry)
- [HEAD is not a merge commit](#head-is-not-a-merge-commit)
- [The guard found a tracked secret or personal-data file](#the-guard-found-a-tracked-secret-or-personal-data-file)
- [No PHP files found to lint](#no-php-files-found-to-lint)
- [Runner legs: the two pins differ](#runner-legs-the-two-pins-differ)
- [Runner legs: a job ran on the wrong runners](#runner-legs-a-job-ran-on-the-wrong-runners)
- [The PHP installed is not the patch pinned](#the-php-installed-is-not-the-patch-pinned)

## The PHP pin is not a version

```
config.platform.php is '<pin>', which is not a version of the form major.minor or major.minor.patch
```

**Cause:** the caller's `composer.json` sets `config.platform.php` to something other than a plain version, such as `8.4.x` or `^8.3`. The whole value must be a version.

**Fix:** set it to a version, for example `"8.4.0"`, or remove it to run on PHP 8.4. See [Jobs](Jobs.md#php-version).

## A job is on but its command is empty

```
mutation-smoke is on but mutation-smoke-command is empty
```

The same line is printed for `encoding-guard`, `floor-lint`, `download-archive` and `phpcs`, and `pest-command is empty` for `pest`.

**Cause:** the job was switched on with `true`, and its command input is empty.

**Fix:** pass the command input, or leave the job off. See [Turning on optional jobs](Turning-on-optional-jobs.md).

## Chain result names a job that reported skipped

```
<job id> reported skipped
```

**Cause:** a job was skipped although its input did not switch it off, usually because a job it needs failed or the run was cancelled. `Chain result` accepts `skipped` only from a job its input switched off.

**Fix:** read the failing job above it in the run; the skip follows from that failure. See [Jobs](Jobs.md#chain-result).

## PCOV is not loaded

```
PCOV is not loaded after setup-php coverage: pcov
```

**Cause:** the `mutate` or `mutation-smoke` job could not load PCOV on the installed PHP.

**Fix:** check that the caller's setup action installs the same PHP minor the job read from the pin, and does not remove extensions after it. See [Jobs](Jobs.md#pcov).

## mutate-shards is not a whole number

```
mutate-shards is '<value>', which is not a whole number of 1 or more
```

**Fix:** pass a whole number of 1 or more. See [Running the full mutation pass](Running-the-full-mutation-pass.md).

## mutate-submodules names a path that is not a submodule

```
mutate-submodules names <path>, which .gitmodules does not register as a submodule path
mutate-submodules holds no path
```

**Cause:** a path in `mutate-submodules` is not a `path =` entry of the caller's `.gitmodules`, matched exactly and with case. A submodule nested in another is reached with `mutate-submodules-recursive`, not by its path. The second line means the input holds only spaces.

**Fix:** name each submodule by the path `.gitmodules` gives it, or leave the input empty. See [Running the full mutation pass](Running-the-full-mutation-pass.md).

## The WordPress integration environment did not start

```
There is no tests/Integration/composer.lock to read the WordPress version from; commit it, or pass the version
tests/Integration/composer.lock does not lock wp-phpunit/wp-phpunit, so the WordPress version cannot be read from it; pass the version
The installed PHP has no mysqli extension, which WordPress connects with; add it to the setup action's extensions
The database container did not start from the image '<image>'
The database did not accept a connection to <name> after <n> attempts; the last answer was: <answer>
env holds a line that is not NAME=value: <line>
```

**Cause:** the `wordpress-integration` action, which the `mutate` job runs when `mutate-wordpress` is `true`, could not stand up what the suite needs. The fourth line means the image could not be pulled or run. The fifth follows the container's last log lines; it also appears when `mutate-wordpress-env` names a database the container does not hold.

**Fix:** the first two lines are answered with `mutate-wordpress-version`, the third in the caller's `.github/actions/setup/action.yml`, the fourth with `mutate-wordpress-database-image`, the others in `mutate-wordpress-env`. See [Jobs](Jobs.md#wordpress-integration-environment).

## No tracked PHP file to shard

```
No tracked PHP file under <mutate-paths>, so there is nothing to shard
```

**Cause:** a scheduled or dispatched run found no tracked PHP file under `mutate-paths`.

**Fix:** set `mutate-paths` to the directories that hold the source, or pass `mutate: false` in a repository with nothing to mutate.

## A path the shard list or --path cannot carry

```
A path holds a comma, a double quote, a backslash or a control character, which the shard list cannot carry: <path>
A changed path holds a comma or a newline, which --path cannot carry: <path>
```

**Fix:** rename the file. The mutation tooling takes its paths as one comma-separated list.

## HEAD is not a merge commit

```
HEAD is not a merge commit, so the pull request's changes cannot be read.
```

**Cause:** on a `pull_request` event the `mutate` job reads the changed files by comparing the two parents of the test merge commit GitHub creates and its own checkout receives. The commit it checked out had a single parent.

**Fix:** the job's checkout is not the caller's to change. [Report it](https://github.com/UAMS-Web/uams-ci-workflows/issues) with the run's link and the tag the caller pins.

## The guard found a tracked secret or personal-data file

```
Tracked secret or personal-data file(s) detected:
```

**Cause:** a tracked path matches a built-in pattern (`wp-config.php`, `.sql`, `.csv`, `.tsv`, `.xlsx`, `.env`, `.pem`, `.key`) or one in `guard-patterns`.

**Fix:** remove the file from the repository, and treat anything it held as exposed. A file that is genuinely safe to track needs a different name or path; the built-in patterns cannot be switched off.

## No PHP files found to lint

```
No PHP files found to lint
```

**Cause:** `dev-lint` is on and every PHP file was excluded, or the repository has none.

**Fix:** narrow `dev-lint-exclude`, or leave `dev-lint` off.

## Runner legs: the two pins differ

```
The caller pins ci.yml at <ref> (<sha>) but runner-legs.yml at <ref> (<sha>); pin both to the same tag
```

**Fix:** pin `ci.yml` and `runner-legs.yml` to the same tag. See [Checking runner legs](Checking-runner-legs.md).

## Runner legs: a job ran on the wrong runners

```
job `<id>` ran on <runners>, expected <runners> (<detail>)
```

**Cause:** a job ran on fewer or more runners than its classification and the caller's inputs give. A job skipped before its matrix expanded shows as `no runner`.

**Fix:** read the job's `# Legs:` line and the inputs passed. A job that did not start because one it needs failed is fixed by fixing that job. See [Choosing runners for each job](Choosing-runners-for-each-job.md).

## The PHP installed is not the patch pinned

```
config.platform.php pins <pin> but the runner installed <version>; setup-php installs the newest patch of a minor
```

This is a warning, not a failure. `shivammathur/setup-php` installs the newest patch of the pinned minor and cannot install a given patch. See [Jobs](Jobs.md#php-version).

<!-- cspell:ignore PCOV phpcs shivammathur -->
