Written against v0.14.0.

At the end of this page a repository runs the shared CI chain on every pull request and push to `main`, and a ruleset can require one check from it, `CI`, whatever jobs the chain gains or loses later.

The caller template is `.claude/skills/code-quality/templates/ci.yml` in [`UAMS-Web/uams-claude-skills`](https://github.com/UAMS-Web/uams-claude-skills/blob/main/shared/.claude/skills/code-quality/templates/ci.yml). The steps below are what it does; copy the template rather than retyping them.

## 1. Carry what the jobs check out

Every job checks out the calling repository, not this one, so the caller supplies:

- `.github/actions/setup/action.yml`, the composite setup action, copied from `.claude/skills/code-quality/templates/setup-action.yml`. The PHP jobs pass it a `php-version` input, so it must accept one ([Jobs](Jobs.md#php-version)).
- The synced `.claude/skills/` scripts the jobs run, such as `check-synced-files.mjs` and `check-no-emoji.mjs`.
- The Composer scripts the jobs call: `test:pint`, `test:refactor`, `stan`, `test` and `mutate`.
- For the `pest` job, `tests/skip-baseline.json`.

**Note:** a job a repository does not need cannot be deleted from the chain. Switch it off with its input where it has one ([Inputs](Inputs.md)), or write a separate workflow.

## 2. Call the chain, pinned to a tag

Add `.github/workflows/ci.yml` with a `checks` job that calls this repository's workflow at a release tag:

```yaml
jobs:
  checks:
    uses: UAMS-Web/uams-ci-workflows/.github/workflows/ci.yml@<tag>
```

The tag is what decides when a change to the chain reaches the caller: nothing changes until the tag moves. Pin a tag or a full commit hash, never a branch. The run's checks report as `checks / <job name> (<operating system>)`.

## 3. Add the `CI` job

A job reached through `uses:` reports as `<caller job id> / <job name>`, so no job of the chain can be named `CI` on its own. The caller adds one job that needs the call:

```yaml
  ci:
    name: CI
    needs: [checks]
    if: always()
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Every needed job succeeded
        env:
          RESULTS: ${{ join(needs.*.result, ' ') }}
        run: |
          echo "Needed job results: $RESULTS"
          if [ -z "$RESULTS" ]; then echo "::error::No needed job results to read"; exit 1; fi
          for result in $RESULTS; do
            if [ "$result" != "success" ]; then echo "::error::A needed job reported $result"; exit 1; fi
          done
```

The chain's last job, `Chain result`, needs every job in it and fails unless each one succeeded (or was switched off by its input), so the call reports `success` only when the whole chain did. `CI` fails on `skipped` and `cancelled` as well as on `failure`, since a call that did not run proved nothing.

## 4. Open a pull request and read the run

Open a pull request with the new workflow. The run shows the call's jobs under `checks /` and then `CI`. Read `Chain result` first: it prints each needed job and its result, and names every job that did not succeed.

## 5. Require `CI`

Once a run is green, a ruleset on `main` requires `CI` (with `Attribution footer` and `Closing keywords` from [Checking pull-request bodies](Checking-pull-request-bodies.md)). The ruleset never lists a chain job by name.

**Warning:** a private repository that gates its jobs on a `RUN_REMOTE_CI` variable adds `if: vars.RUN_REMOTE_CI == 'true'` to the `checks` job. With the switch off, a gated `CI` lets a pull request merge with no job run, and a `CI` without the gate fails every pull request. Require `CI` only where the workflow genuinely runs on every pull request.

## Next

- [Choosing runners for each job](Choosing-runners-for-each-job.md)
- [Turning on optional jobs](Turning-on-optional-jobs.md)
- [Running the full mutation pass](Running-the-full-mutation-pass.md)
- [Checking runner legs](Checking-runner-legs.md)

<!-- cspell:ignore UAMS -->
