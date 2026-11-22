Written against v0.17.0.

Every job runs as a matrix over the operating system, and a caller that passes no leg input gets `ubuntu-latest` only for every job. GitHub runs only a few macOS jobs at once, so a caller asks for Windows or macOS for a job only when it can say why, and puts the reason beside the input. Each job carries a `# Legs:` line classifying it as **Linux only** or **all three** (`ubuntu-latest`, `windows-latest` and `macos-latest`), with the evidence for that choice; [Jobs](Jobs.md) lists each job's classification.

## Steps

1. **Run everything on Linux:** pass nothing. `linux-only` defaults to `true`, so every job loses its Windows and macOS legs, except the jobs named in `all-platform-jobs` or `windows-jobs`. A caller that still passes `linux-only: true` runs the same.

2. **Run some jobs on all three runners:** name their job ids, separated by spaces, in `all-platform-jobs`. A Linux-only job gains its Windows and macOS legs, and a three-runner job keeps them.

   ```yaml
   with:
     all-platform-jobs: 'pest'
   ```

3. **Add Windows without macOS:** name the jobs in `windows-jobs`. They run on `ubuntu-latest` and `windows-latest` only, whatever `linux-only` says. A job named in both `windows-jobs` and `all-platform-jobs` keeps all three runners.

   ```yaml
   with:
     windows-jobs: 'pest mutation-smoke'
   ```

4. **Restore every job's classification:** pass `linux-only: false`. A job classified for all three (`pest`, `mutate-ignore`, `vitest` and `mutation-smoke`) runs on all three runners, and the rest stay on `ubuntu-latest`. `all-platform-jobs` and `windows-jobs` still apply on top.

   ```yaml
   with:
     linux-only: false
   ```

**Note:** the `mutate` job runs on `ubuntu-latest` only, whatever these inputs say. A Windows leg once scored mutants the tests never detect as killed ([#13](https://github.com/UAMS-Web/uams-ci-workflows/issues/13)), so naming `mutate` in either list changes nothing.

To prove which runners each job reached in a run, add [runner legs](Checking-runner-legs.md).

## Reference

- [Inputs](Inputs.md): `linux-only`, `all-platform-jobs`, `windows-jobs`.
- [Jobs](Jobs.md): each job's classification.
