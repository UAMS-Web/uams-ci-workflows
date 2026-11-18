This repository publishes reusable GitHub Actions workflows for the UAMS-Web repositories: `ci.yml`, the CI chain a repository calls instead of keeping its own copy; `runner-legs.yml`, which checks that a caller's run reached the runners each job is classified for; and `pr-body-checks.yml`, which checks a pull-request body for an attribution footer and for closing keywords.

This wiki holds the walkthrough, the task guides, the reference and troubleshooting. The [README](https://github.com/UAMS-Web/uams-ci-workflows#readme) keeps the overview, a short quick start and development notes.

## Getting started

- [Quick start (README)](https://github.com/UAMS-Web/uams-ci-workflows#quick-start): the smallest caller.
- [Calling the CI chain](Calling-the-CI-chain.md): a first caller, from nothing to a required `CI` check.

## Guides

- [Choosing runners for each job](Choosing-runners-for-each-job.md): `linux-only`, `all-platform-jobs` and `windows-jobs`.
- [Turning on optional jobs](Turning-on-optional-jobs.md): the jobs that are off until a caller switches them on.
- [Running the full mutation pass](Running-the-full-mutation-pass.md): the scheduled run, its timeout and its shards.
- [Checking runner legs](Checking-runner-legs.md): adding `runner-legs.yml` beside the call.
- [Checking pull-request bodies](Checking-pull-request-bodies.md): calling `pr-body-checks.yml` and naming its required checks.

## Troubleshooting

- [Troubleshooting](Troubleshooting.md): one entry per error a run prints, with its cause and fix.

## Reference

- [Inputs](Inputs.md): every input of `ci.yml`, with its type, default and effect.
- [Jobs](Jobs.md): every job of `ci.yml`, the runners it runs on, the PHP version and PCOV, and what a caller must carry.

## Project

- [Project](Project.md): releases, the decision log, where the workflow comes from, and how to report a problem.

<!-- cspell:ignore UAMS PCOV -->
