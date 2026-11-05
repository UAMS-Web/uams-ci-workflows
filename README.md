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
