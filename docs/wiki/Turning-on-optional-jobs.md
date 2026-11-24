Written against v0.17.0.

Several jobs are off until the caller passes `true` for the input of the same name. Most run a command the caller names in a `<job>-command` input. A job switched off reports `skipped`, and `Chain result` accepts that skip; a job switched on and skipped for any other reason fails the chain.

## Steps

1. **Pick the jobs.** The optional jobs, what they run and their command inputs:

   | Job | Runs | Command input (default) |
   | --- | --- | --- |
   | `encoding-guard` | the command after a locked Composer install | `encoding-guard-command` (none) |
   | `vitest` | the command after `npm ci` | `vitest-command` (`npm run test:js`) |
   | `vite-build` | the command after a locked Composer install and `npm ci` | `vite-build-command` (`npm run build`) |
   | `mutation-smoke` | the command with PCOV loaded | `mutation-smoke-command` (none) |
   | `floor-lint` | the command under the repository's supported floor PHP, `floor-lint-php` (`8.2`) | `floor-lint-command` (`php scripts/lint-floor.php`) |
   | `download-archive` | a check that the GitHub download holds only what the plugin runs | `download-archive-command` (`node scripts/check-download-archive.mjs`) |
   | `phpcs` | the WordPress security sniffs after a locked Composer install | `phpcs-command` (`composer test:phpcs`) |
   | `guard` | a check that no tracked path looks like a secret or personal data | `guard-patterns` (extra patterns, none) |
   | `dev-lint` | `php -l` on every PHP file under the development PHP | `dev-lint-exclude` (paths to skip, none) |

2. **Switch each on, and name a command where it has no default.** A job switched on with an empty command fails with `<job> is on but <job>-command is empty`.

   ```yaml
   with:
     vitest: true
     mutation-smoke: true
     mutation-smoke-command: '<the command that smoke-tests the mutation tooling>'
   ```

3. **For a WordPress plugin,** the caller template's example turns on the plugin jobs and switches off what a plugin does not run:

   ```yaml
   with:
     mutate: false
     mutate-ignore-paths: includes
     floor-lint: true
     floor-lint-php: '8.2'
     download-archive: true
     phpcs: true
     pest-command: composer test:unit
   ```

   A plugin that does not receive the `pest-testing` skill also passes `global-test-symbols: false`. Its WordPress integration matrix stays a plain job in the caller, listed in the `needs:` of its `CI` job; that job can use the [`wordpress-integration` action](Jobs.md#wordpress-integration-environment). A plugin whose mutation pass boots WordPress passes `mutate-wordpress: true` ([Running the full mutation pass](Running-the-full-mutation-pass.md)).

**Note:** `guard-patterns` adds to the built-in patterns (`wp-config.php`, `.sql`, `.csv`, `.tsv`, `.xlsx`, `.env`, `.pem`, `.key`) and never replaces them. `dev-lint` always skips `vendor` and `node_modules`.

## Reference

- [Inputs](Inputs.md): every input and its default.
- [Jobs](Jobs.md): which runners each optional job uses.

<!-- cspell:ignore PCOV phpcs -->
