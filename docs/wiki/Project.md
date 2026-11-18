Written against v0.14.0.

## Where the workflow comes from

`ci.yml` is published from the template `.claude/skills/code-quality/templates/ci-reusable.yml` in [`UAMS-Web/uams-claude-skills`](https://github.com/UAMS-Web/uams-claude-skills). A change to the chain is made in this repository and the template is brought to match, or the other way round; the [decision log](https://github.com/UAMS-Web/uams-ci-workflows/blob/main/docs/DECISIONS.md) records the cases where the two were reconciled. The caller template, `.claude/skills/code-quality/templates/ci.yml` there, is what a repository copies to call it.

## Releases

Each release is a tag on `main`, listed on the [releases page](https://github.com/UAMS-Web/uams-ci-workflows/releases). A caller pins a tag, so a release reaches a repository only when its pin moves. Releases are minor versions for new inputs or jobs and patch versions for fixes, while the version line is below 1.0. These pages say which release they were written against at the top of each page and in the footer.

## Decisions

The [decision log](https://github.com/UAMS-Web/uams-ci-workflows/blob/main/docs/DECISIONS.md) holds the decisions that closed, with their reasons and the alternatives rejected. Read it before proposing a change to the chain's shape.

## Developing

- The scripts under [`scripts/`](https://github.com/UAMS-Web/uams-ci-workflows/tree/main/scripts) back steps of the workflows. `node --test scripts/*.test.mjs` runs their tests, and the `Script tests` workflow runs them on a pull request that touches `scripts/` or the workflows.
- Every change goes through a pull request to `main`, as [`CONTRIBUTING.md`](https://github.com/UAMS-Web/uams-ci-workflows/blob/main/CONTRIBUTING.md) describes.
- These pages live in [`docs/wiki/`](https://github.com/UAMS-Web/uams-ci-workflows/tree/main/docs/wiki) and are published by the `Publish wiki` workflow on each published release and by hand. Each publish replaces the whole wiki, so a page edited in the browser is overwritten.

## Reporting a problem

Open an issue on the [issue tracker](https://github.com/UAMS-Web/uams-ci-workflows/issues), naming the tag the caller pins, the run, and the log line.

<!-- cspell:ignore UAMS -->
