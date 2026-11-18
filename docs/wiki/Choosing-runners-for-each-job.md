Written against v0.14.0.

Every job runs as a matrix over the operating system. Each job carries a `# Legs:` line classifying it as **Linux only** or **all three** (`ubuntu-latest`, `windows-latest` and `macos-latest`), with the evidence for that choice, and runs on those runners until the caller says otherwise. [Jobs](Jobs.md) lists each job's classification.

## Steps

1. **Run everything on Linux:** pass `linux-only: true`. Every job loses its Windows and macOS legs, except the jobs named in `all-platform-jobs`.

   ```yaml
   with:
     linux-only: true
   ```

2. **Keep some jobs on all three runners:** name their job ids, separated by spaces, in `all-platform-jobs`. A Linux-only job gains its Windows and macOS legs, and a three-runner job keeps them under `linux-only`.

   ```yaml
   with:
     linux-only: true
     all-platform-jobs: 'pest'
   ```

3. **Add Windows without macOS:** name the jobs in `windows-jobs`. They run on `ubuntu-latest` and `windows-latest` only, whatever `linux-only` says. A job named in both `windows-jobs` and `all-platform-jobs` keeps all three runners.

   ```yaml
   with:
     windows-jobs: 'pest mutation-smoke'
   ```

**Note:** the `mutate` job runs on `ubuntu-latest` only, whatever these inputs say. A Windows leg once scored mutants the tests never detect as killed ([#13](https://github.com/UAMS-Web/uams-ci-workflows/issues/13)), so naming `mutate` in either list changes nothing.

To prove which runners each job reached in a run, add [runner legs](Checking-runner-legs.md).

## Reference

- [Inputs](Inputs.md): `linux-only`, `all-platform-jobs`, `windows-jobs`.
- [Jobs](Jobs.md): each job's classification.
