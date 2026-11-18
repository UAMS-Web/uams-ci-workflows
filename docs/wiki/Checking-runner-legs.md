Written against v0.14.0.

`runner-legs.yml` checks a caller's own run of `ci.yml`: every job must have run on exactly the runners its `# Legs:` line names, given the inputs the caller passed. It reads the run's check runs, where a leg's name carries its runner and a job that never started keeps the literal `${{ matrix.os }}`, and fails naming each job that ran on fewer or more runners than expected. It proves which runners each job reached, not that each leg passed; `Chain result` says that.

## Steps

1. **Add a job beside the call, pinned to the same tag as `ci.yml`**, and list it in the `needs:` of the `CI` job:

   ```yaml
   jobs:
     checks:
       uses: UAMS-Web/uams-ci-workflows/.github/workflows/ci.yml@<tag>
     legs:
       needs: [checks]
       if: always()
       uses: UAMS-Web/uams-ci-workflows/.github/workflows/runner-legs.yml@<the same tag>
       permissions:
         contents: read
         actions: read
         checks: read
     ci:
       name: CI
       needs: [checks, legs]
       # ...
   ```

2. **Keep both pins on the same commit.** The check reads the classification from the `ci.yml` its own pin resolves to, so the job fails when the two pins name different commits.

3. **Keep `if: always()`.** A job skipped because a job it needs failed is skipped before its matrix expands, and that shows as a missing leg; without `if: always()` the check would not read such a run at all.

4. **If the call's job is not named `checks`,** pass its id as `caller-job`, the prefix the check runs are named under.

**Note:** the permissions are named on the job as well as inside `runner-legs.yml` because a called workflow can only narrow the token the caller grants: `actions: read` reads the run's check suite, `checks: read` its check runs.

`UAMS-Web/wordpress-plugin-template` is the caller that proves each release: it leaves every three-runner job on, so its run at a new tag shows each job on its runners at that release.

## Reference

- [Jobs](Jobs.md): each job's classification.
- [Troubleshooting](Troubleshooting.md#runner-legs-the-two-pins-differ): the pin mismatch error.

<!-- cspell:ignore UAMS -->
