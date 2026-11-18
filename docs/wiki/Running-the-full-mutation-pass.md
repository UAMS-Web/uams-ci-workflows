Written against v0.14.0.

The `mutate` job mutates only what a change touches on a pull request or a push, and everything on a scheduled or manually dispatched run. The full pass is the one that catches drift from a dependency or tooling change, so a caller gives its own workflow a schedule.

## What each event mutates

| Caller's event | What is mutated | Timeout input (default) |
| --- | --- | --- |
| `pull_request`, `push` | the PHP files under `mutate-paths` that the change adds, changes or renames | `mutate-timeout-minutes` (`45`, clamped to `360`) |
| `schedule`, `workflow_dispatch` | everything `composer mutate` covers | `mutate-full-timeout-minutes` (`180`) |
| any other event, or a pushed commit with no parent | everything `composer mutate` covers | `mutate-timeout-minutes` |

A pull request or push that changes no PHP file under `mutate-paths`, or whose changed files produce no mutants, passes with a line saying there was nothing to mutate.

## Steps

1. **Add a schedule to the caller's workflow.** The caller template carries one commented out:

   ```yaml
   on:
     pull_request:
     push:
       branches: [main]
     workflow_dispatch:
     schedule:
       - cron: '17 7 * * 1'
   ```

   A schedule runs on the default branch, and GitHub disables it after 60 days without repository activity.

2. **Give the full pass enough time.** Raise `mutate-full-timeout-minutes` when the full pass outgrows 180 minutes, and `mutate-timeout-minutes` when a single changed file is large enough to outgrow 45 (a file of about 3,800 mutants has).

3. **Split a long full pass into shards.** `mutate-shards` splits a scheduled or dispatched run across that many jobs. Each shard mutates its own share of the PHP files under `mutate-paths`, balanced by file size, under `mutate-full-timeout-minutes`.

   ```yaml
   with:
     mutate-shards: 4
     mutate-full-timeout-minutes: 120
   ```

   The count is clamped to the number of files and to 100. A pull request or a push still runs one job whatever this says. Each shard's check is named `... (ubuntu-latest, shard <n> of <count>)`.

**Note:** `mutate: false` skips the job on every event, and the `mutate-ignore` job with it unless `mutate-ignore: true`. See [Inputs](Inputs.md).

## Reference

- [Inputs](Inputs.md): `mutate`, `mutate-paths`, `mutate-timeout-minutes`, `mutate-full-timeout-minutes`, `mutate-shards`.
- [Jobs](Jobs.md#pcov): how the job loads PCOV.
- [Troubleshooting](Troubleshooting.md): the errors the shard planner and the `mutate` job print.

<!-- cspell:ignore PCOV -->
