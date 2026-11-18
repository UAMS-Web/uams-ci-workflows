Written against v0.14.0.

`pr-body-checks.yml` runs the two checks that read a pull-request body. `Attribution footer` fails a body carrying the harness attribution footer or a session link. `Closing keywords` fails a body holding a closing directive across a line break, or one that leaves a linked issue unclosed. Both read the body from the API, so an edit that lands between the event and the run is still the text checked.

## Steps

1. **Call it on all five trigger types,** because a body can change at any of them:

   ```yaml
   on:
     pull_request:
       types: [opened, edited, reopened, ready_for_review, synchronize]
   jobs:
     checks:
       uses: UAMS-Web/uams-ci-workflows/.github/workflows/pr-body-checks.yml@<tag or commit>
       permissions:
         contents: read
         pull-requests: read
         issues: read
   ```

2. **Add one job per required context.** A called job reports as `<caller job id> / <job name>`, so it cannot be the context `Attribution footer` or `Closing keywords` itself. The workflow exposes each job's result as an output, `footer` and `keywords`, and the caller adds one small job per context, named exactly as the ruleset requires, that fails unless its output is `success`. Give each `if: always() && vars.RUN_REMOTE_CI != 'false'`: without the second clause they run and fail while the switch is off, because a skipped output is not `success`.

3. **Carry the scripts.** The jobs check out the caller and run the synced scripts under `.claude/skills/writing-pull-requests/scripts/`, so the caller must have them.

4. **Require the two contexts** in the ruleset, beside `CI` ([Calling the CI chain](Calling-the-CI-chain.md#5-require-ci)).

**Note:** both jobs carry `if: vars.RUN_REMOTE_CI != 'false'`, read from the caller's variables, so a private repository with the switch off skips them and bills no minutes. A skipped required check counts as success, so a skipped run means nothing read the pull request.

**Note:** the footer job does not check a pull request opened by `dependabot[bot]`. Its body is generated from upstream release notes nobody on the repository wrote or can edit; the step prints why it skipped.

This repository runs the same checks on its own pull requests from this file's `pull_request` trigger, not through a caller: a caller here would call itself ([#41](https://github.com/UAMS-Web/uams-ci-workflows/issues/41)).

## Reference

- [Troubleshooting](Troubleshooting.md)

<!-- cspell:ignore UAMS -->
