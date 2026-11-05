# uams-ci-workflows
Shared reusable GitHub Actions workflows for UAMS-Web repositories

## Inputs of `ci.yml`

A caller passes these with `with:`. Every input has a default, so a caller that passes none runs the chain unchanged.

| Input | Type | Default | Effect |
| --- | --- | --- | --- |
| `linux-only` | boolean | `false` | Run every job on `ubuntu-latest` only, except the jobs named in `all-platform-jobs`. |
| `all-platform-jobs` | string | empty | Space-separated job ids kept on all three runners whatever `linux-only` says. |
| `pest` | boolean | `true` | Run the `pest` job. Pass `false` where the suite runs as the caller's own jobs (private submodules, a secret, shards); the job is skipped and `Chain result` accepts the skip. |
| `mutate` | boolean | `true` | Run the `mutate` job. Pass `false` where the source holds no code a mutator changes; the job is skipped and `Chain result` accepts the skip. |
| `mutate-paths` | string | `src` | Paths the `mutate` job selects changed PHP files from on a pull request. |
| `share-floor-seconds` | number | `10` | Summed class time below which the `Slowest class` step skips its share check. `0` never skips it. |
| `encoding-guard`, `vitest`, `vite-build`, `mutation-smoke` | boolean | `false` | Switch on the optional job of that name. Each has a `<name>-command` input, except that `vitest-command` defaults to `npm run test:js` and `vite-build-command` to `npm run build`. |
| `npm-version` | string | empty | An npm version range to install globally before `npm ci` in the Node jobs. |
