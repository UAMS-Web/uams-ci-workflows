# uams-ci-workflows
Shared reusable GitHub Actions workflows for UAMS-Web repositories

- `.github/workflows/ci.yml`: the CI chain (Composer validate, synced files, no-emoji, Pint, Rector, PHPStan, mutation testing, Pest and optional jobs) a repository calls instead of keeping its own copy.
- `.github/workflows/runner-legs.yml`: checks that a caller's run reached the runners each job is classified for.
- `.github/workflows/pr-body-checks.yml`: the `Attribution footer` and `Closing keywords` checks on a pull-request body.

The documentation (a walkthrough, task guides, every input and job, and troubleshooting) is in the [wiki](https://github.com/UAMS-Web/uams-ci-workflows/wiki).

## Quick start

Call the chain from the repository's own `.github/workflows/ci.yml`, pinned to a release tag, and add the `CI` job a ruleset requires:

```yaml
jobs:
  checks:
    uses: UAMS-Web/uams-ci-workflows/.github/workflows/ci.yml@<tag>
  ci:
    name: CI
    needs: [checks]
    if: always()
    # fails unless every needed job reports success; copy the steps from the caller template
```

The caller template, with the `CI` job's steps, is `.claude/skills/code-quality/templates/ci.yml` in `UAMS-Web/uams-claude-skills`. The wiki's [Calling the CI chain](https://github.com/UAMS-Web/uams-ci-workflows/wiki/Calling-the-CI-chain) walks through it, including what the calling repository must carry.

## Development

The scripts under `scripts/` back steps of the workflows; `node --test scripts/*.test.mjs` runs their tests, which plant a missing leg, an extra leg and a job that never started in a list taken from a real run. The wiki pages live in `docs/wiki/` and are published by the `Publish wiki` workflow; edit them there through a pull request.

## License

See [LICENSE](LICENSE).

<!-- cspell:ignore UAMS -->
