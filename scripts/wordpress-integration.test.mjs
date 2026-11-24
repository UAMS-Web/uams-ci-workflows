// Run with `node --test scripts/*.test.mjs`. Covers UAMS-Web/uams-ci-workflows#78: the scripts of the composite action
// `.github/actions/wordpress-integration`, run as they are with `docker`, `curl`, `tar`, `php` and `sleep` replaced by
// stubs on PATH that record their arguments, and the step of `ci.yml`'s `mutate` job that uses the action. The live
// half (a real database, WordPress and suite) is the `wordpress-integration` job of `script-tests.yml`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { declaredInputs, stepOf } from './chain-result.mjs'
import { jobBlocks } from './php-pin.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const action = join(root, '.github', 'actions', 'wordpress-integration')
const actionText = readFileSync(join(action, 'action.yml'), 'utf8').replace(/\r\n/g, '\n')
const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8').replace(/\r\n/g, '\n')

const DB = { DB_IMAGE: 'mysql:8.0', DB_NAME: 'wordpress_tests', DB_USER: 'root', DB_PASSWORD: '', DB_PORT: '3306' }

// Runs one of the action's scripts in a scratch workspace. `stubs` maps a command to the body of its bash stub, and
// `lock` is written as tests/Integration/composer.lock.
function run(script, { env = {}, stubs = {}, lock } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'wp-int-'))
    try {
        const bin = join(dir, 'bin')
        const temp = join(dir, 'temp')
        for (const d of [bin, temp, join(dir, 'tests', 'Integration')]) mkdirSync(d, { recursive: true })
        for (const [name, body] of Object.entries(stubs)) {
            writeFileSync(join(bin, name), `#!/usr/bin/env bash\nprintf '%s' "${name}" >> "$CALLS"\nprintf ' [%s]' "$@" >> "$CALLS"\nprintf '\\n' >> "$CALLS"\n${body}\n`)
            chmodSync(join(bin, name), 0o755)
        }
        if (lock !== undefined) writeFileSync(join(dir, 'tests', 'Integration', 'composer.lock'), JSON.stringify(lock))
        const exported = join(dir, 'github-env')
        const calls = join(dir, 'calls')
        writeFileSync(exported, '')
        writeFileSync(calls, '')
        const r = spawnSync('bash', [join(action, script)], {
            cwd: dir,
            encoding: 'utf8',
            env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_OS: 'Linux', RUNNER_TEMP: temp, GITHUB_ENV: exported, CALLS: calls, ...env },
        })
        return {
            status: r.status,
            out: r.stdout + r.stderr,
            exported: readFileSync(exported, 'utf8').split('\n').filter(Boolean),
            calls: readFileSync(calls, 'utf8').split('\n').filter(Boolean),
            temp,
            tarballLeft: existsSync(join(temp, 'wordpress.tar.gz')),
        }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

// start-database.sh

const docker = { docker: 'exit 0' }

test('root with no password starts a container that allows one, on the loopback address', () => {
    const r = run('start-database.sh', { env: DB, stubs: docker })
    assert.equal(r.status, 0, r.out)
    assert.equal(r.calls[0], 'docker [rm] [-f] [wordpress-integration-db]')
    assert.match(r.calls[1], /^docker \[run\] \[-d\] .*\[-p\] \[127\.0\.0\.1:3306:3306\]/)
    assert.match(r.calls[1], /\[MYSQL_ALLOW_EMPTY_PASSWORD=yes\]/)
    assert.match(r.calls[1], /\[MYSQL_DATABASE=wordpress_tests\].*\[mysql:8\.0\]$/)
})

test('root with a password sets it and allows no empty one', () => {
    const r = run('start-database.sh', { env: { ...DB, DB_PASSWORD: 'a b$c' }, stubs: docker })
    assert.equal(r.status, 0, r.out)
    assert.match(r.calls[1], /\[MYSQL_ROOT_PASSWORD=a b\$c\].*\[MARIADB_ROOT_PASSWORD=a b\$c\]/)
    assert.doesNotMatch(r.calls[1], /ALLOW_EMPTY/)
})

test('another user is created beside a random root password', () => {
    const r = run('start-database.sh', { env: { ...DB, DB_USER: 'tests', DB_PASSWORD: 'x' }, stubs: docker })
    assert.equal(r.status, 0, r.out)
    assert.match(r.calls[1], /\[MYSQL_RANDOM_ROOT_PASSWORD=yes\].*\[MYSQL_USER=tests\].*\[MYSQL_PASSWORD=x\]/)
    assert.doesNotMatch(r.calls[1], /ALLOW_EMPTY|\[MYSQL_ROOT_PASSWORD/)
})

for (const [what, env, message] of [
    ['a runner that is not Linux', { RUNNER_OS: 'Windows' }, /runs on Linux only; this runner is 'Windows'/],
    ['an image that reads as an option', { DB_IMAGE: '--privileged' }, /database-image is '--privileged'/],
    ['an image with a space', { DB_IMAGE: 'mysql:8.0 --x' }, /database-image is/],
    ['an empty database name', { DB_NAME: '' }, /database-name is ''/],
    ['a user with a quote', { DB_USER: "a'b" }, /database-user is/],
    ['a port that is not a number', { DB_PORT: '3306x' }, /database-port is '3306x'/],
    ['a password with a line break', { DB_PASSWORD: 'a\nb' }, /database-password holds a line break/],
    ['a user other than root with no password', { DB_USER: 'tests' }, /only root may have an empty password/],
]) {
    test(`${what} fails before a container is started`, () => {
        const r = run('start-database.sh', { env: { ...DB, ...env }, stubs: docker })
        assert.equal(r.status, 1)
        assert.match(r.out, message)
        assert.deepEqual(r.calls, [])
    })
}

// download-wordpress.sh

const download = { curl: 'exit 0', tar: 'touch "${@: -1}/wp-settings.php"' }
const lockOf = (version, key = 'packages-dev') => ({ packages: [], 'packages-dev': [], [key]: [{ name: 'yoast/phpunit-polyfills', version: '4.0.0' }, { name: 'wp-phpunit/wp-phpunit', version }] })
const wp = (version, lock) => run('download-wordpress.sh', { env: { INTEGRATION_PATH: 'tests/Integration', WORDPRESS_VERSION: version }, stubs: download, lock })
const url = (r) => r.calls.find((c) => c.startsWith('curl'))?.match(/\[(https:[^\]]+)\]$/)?.[1]

for (const [version, published] of [['6.8.3', '6.8.3'], ['6.8.0', '6.8'], ['7.0', '7.0'], ['v7.0.7', '7.0.7'], ['6.10.0', '6.10'], ['7.2.0-RC1', '7.2-RC1'], ['7.2-beta1', '7.2-beta1']]) {
    test(`the lock's wp-phpunit ${version} downloads WordPress ${published}`, () => {
        const r = wp('', lockOf(version))
        assert.equal(r.status, 0, r.out)
        assert.equal(url(r), `https://wordpress.org/wordpress-${published}.tar.gz`)
        assert.deepEqual(r.exported, [`WP_TESTS_ABSPATH=${r.temp}/wordpress`])
    })
}

test('wp-phpunit is read from the lock whether or not it is a development package', () => {
    assert.equal(url(wp('', lockOf('6.8.3', 'packages'))), 'https://wordpress.org/wordpress-6.8.3.tar.gz')
})

test('a version the caller passes wins over the lock, and needs no lock', () => {
    assert.equal(url(wp('7.1.4', lockOf('6.8.3'))), 'https://wordpress.org/wordpress-7.1.4.tar.gz')
    assert.equal(url(wp('7.1.4')), 'https://wordpress.org/wordpress-7.1.4.tar.gz')
})

for (const [what, version, lock, message] of [
    ['no lock', '', undefined, /There is no tests\/Integration\/composer\.lock/],
    ['a lock without wp-phpunit', '', { packages: [], 'packages-dev': [{ name: 'phpunit/phpunit', version: '9.6.0' }] }, /does not lock wp-phpunit/],
    ['a lock on a branch', '', lockOf('dev-main'), /is 'dev-main'/],
    ['a version that is a path', '../x', undefined, /is '\.\.\/x'/],
    ['a version with a line break', '7.1\n7.2', undefined, /not a release number/],
]) {
    test(`${what} fails and downloads nothing`, () => {
        const r = wp(version, lock)
        assert.equal(r.status, 1)
        assert.match(r.out, message)
        assert.deepEqual(r.calls, [])
        assert.deepEqual(r.exported, [])
    })
}

test('a download that fails, or that holds no WordPress, exports nothing', () => {
    const env = { INTEGRATION_PATH: 'tests/Integration', WORDPRESS_VERSION: '7.1' }
    const refused = run('download-wordpress.sh', { env, stubs: { ...download, curl: 'exit 22' } })
    assert.equal(refused.status, 22)
    assert.match(refused.calls[0], /^curl \[-fsSL\]/, 'curl must fail on an HTTP error')
    assert.deepEqual(refused.exported, [])
    const empty = run('download-wordpress.sh', { env, stubs: { ...download, tar: 'exit 0' } })
    assert.equal(empty.status, 1)
    assert.match(empty.out, /holds no wp-settings\.php/)
    assert.deepEqual(empty.exported, [])
})

// export-environment.sh

const exportsOf = (env) => run('export-environment.sh', { env: { ...DB, MULTISITE: '', MORE: '', ...env } })
const base = ['WP_TESTS_DB_HOST=127.0.0.1', 'WP_TESTS_DB_NAME=wordpress_tests', 'WP_TESTS_DB_USER=root', 'WP_TESTS_DB_PASSWORD=']

test('the database variables are exported, and the install shape is left to the suite', () => {
    assert.deepEqual(exportsOf({}).exported, base)
})

test('multisite true and false export the two values of WP_MULTISITE', () => {
    assert.deepEqual(exportsOf({ MULTISITE: 'true' }).exported, [...base, 'WP_MULTISITE=1'])
    assert.deepEqual(exportsOf({ MULTISITE: 'false' }).exported, [...base, 'WP_MULTISITE=0'])
})

test('a port other than 3306 is part of the host', () => {
    assert.equal(exportsOf({ DB_PORT: '3307' }).exported[0], 'WP_TESTS_DB_HOST=127.0.0.1:3307')
})

test('env lines are exported after the others, with blank lines and indentation dropped', () => {
    const r = exportsOf({ MORE: '  SINGLE_SITE=1\r\n\n   \nURL=a=b c\nEMPTY=' })
    assert.equal(r.status, 0, r.out)
    assert.deepEqual(r.exported, [...base, 'SINGLE_SITE=1', 'URL=a=b c', 'EMPTY='])
})

test('the export script prints the names of the variables and not their values', () => {
    const r = exportsOf({ DB_PASSWORD: 'hunter2', MORE: 'A=secret-ish' })
    assert.match(r.out, /Exported: WP_TESTS_ABSPATH .*WP_TESTS_DB_PASSWORD A$/m)
    assert.doesNotMatch(r.out, /hunter2|secret-ish/)
})

for (const [what, env, message] of [
    ['a multisite value that is neither', { MULTISITE: '1' }, /multisite is '1'/],
    ['an env line with no equals sign', { MORE: 'OK=1\nNOPE' }, /not NAME=value: NOPE/],
    ['an env line whose name is not one', { MORE: '1A=x' }, /not NAME=value: 1A=x/],
    ['an env line that opens a multi-line value', { MORE: 'A<<EOF' }, /not NAME=value/],
]) {
    test(`${what} fails and exports nothing`, () => {
        const r = exportsOf(env)
        assert.equal(r.status, 1)
        assert.match(r.out, message)
        assert.deepEqual(r.exported, [])
    })
}

// wait-for-database.sh. The stub answers the mysqli check first, then refuses `REFUSALS` connections.

const phpStub = 'case "$*" in *extension_loaded*) exit "${NO_MYSQLI:-0}" ;; esac\nn=$(grep -c mysqli_connect_error "$CALLS")\nif [ "$n" -le "${REFUSALS:-0}" ]; then echo refused; exit 1; fi\necho 8.0.40'
const EXPORTED = { WP_TESTS_DB_HOST: '127.0.0.1', WP_TESTS_DB_NAME: 'wordpress_tests', WP_TESTS_DB_USER: 'root', WP_TESTS_DB_PASSWORD: '' }
const wait = (env) => run('wait-for-database.sh', { env: { ...EXPORTED, WAIT_ATTEMPTS: '3', WAIT_SECONDS: '0', ...env }, stubs: { php: phpStub, docker: 'exit 0' } })

test('the wait ends on the first connection that is accepted', () => {
    assert.match(wait({}).out, /Database 8\.0\.40 answered for wordpress_tests on attempt 1/)
    const r = wait({ REFUSALS: '2' })
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /answered for wordpress_tests on attempt 3/)
})

test('a database that never accepts a connection fails, with the last answer and the container log', () => {
    const r = wait({ REFUSALS: '9' })
    assert.equal(r.status, 1)
    assert.match(r.out, /to wordpress_tests after 3 attempts; the last answer was: refused/)
    assert.ok(r.calls.includes('docker [logs] [--tail] [50] [wordpress-integration-db]'))
})

// The PHP program itself, with `mysqli_connect` unavailable to stub, is read: it must use the exported values.
test('the wait connects with the values the suite reads, so a name replaced through env is the one checked', () => {
    const script = readFileSync(join(action, 'wait-for-database.sh'), 'utf8')
    for (const name of ['HOST', 'USER', 'PASSWORD', 'NAME']) assert.match(script, new RegExp(`getenv\\("WP_TESTS_DB_${name}"\\)`))
    assert.doesNotMatch(script, /(?<!WP_TESTS_)DB_(?:PORT|NAME|USER|PASSWORD)/)
    assert.doesNotMatch(actionText.slice(actionText.indexOf('- name: Wait for the database')), /^ {6}env:/m)
})

test('a container that does not start fails with the image named', () => {
    const r = run('start-database.sh', { env: DB, stubs: { docker: '[ "$1" = run ] && exit 125; exit 0' } })
    assert.equal(r.status, 1)
    assert.match(r.out, /::error::The database container did not start from the image 'mysql:8\.0'/)
})

test('a PHP without mysqli fails before any connection', () => {
    const r = wait({ NO_MYSQLI: '1' })
    assert.equal(r.status, 1)
    assert.match(r.out, /no mysqli extension/)
    assert.equal(r.calls.length, 1)
})

// The action and the mutate job

test('every step of the action is a run step, so a job that skips it downloads nothing more', () => {
    assert.match(actionText, /^ {6}run: bash /m)
    assert.doesNotMatch(actionText, /^\s*-?\s*uses:/m)
})

test('no input reaches a shell except through an environment variable', () => {
    const runs = actionText.split('\n').filter((l) => /^ {6}run: /.test(l))
    assert.equal(runs.length, 5)
    for (const line of runs) assert.doesNotMatch(line, /\$\{\{/)
})

test('the mutate-wordpress inputs leave the mutate job as it was by default', () => {
    const inputs = declaredInputs(ci)
    assert.deepEqual(inputs['mutate-wordpress'], { type: 'boolean', default: false })
    assert.equal(inputs['mutate-wordpress-version'].default, '')
    assert.equal(inputs['mutate-wordpress-multisite'].default, '')
    assert.equal(inputs['mutate-wordpress-env'].default, '')
    assert.equal(inputs['mutate-wordpress-database-image'].default, actionText.match(/^ {2}database-image:\n(?: {4}.*\n)*? {4}default: (.+)$/m)[1])
})

test('the mutate job runs the action only for a caller that asks, and only when it mutates something', () => {
    const step = stepOf(ci, 'mutate', 'Set up the WordPress integration environment')
    assert.equal(step.if, "inputs.mutate-wordpress && steps.select.outputs.mode != 'none'")
    const job = jobBlocks(ci).mutate
    assert.match(job, /^ {8}uses: \$\/\.github\/actions\/wordpress-integration$/m)
    const order = ['Check PCOV is loaded', 'Select the files to mutate', 'Set up the WordPress integration environment', 'Run mutation testing'].map((n) => job.indexOf(`- name: ${n}\n`))
    assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), order.join())
})

test('each value the mutate job passes is an input the action declares', () => {
    const passed = Object.keys(stepOf(ci, 'mutate', 'Set up the WordPress integration environment').with)
    assert.deepEqual(passed.sort(), ['database-image', 'env', 'multisite', 'wordpress-version'])
    for (const name of passed) assert.match(actionText, new RegExp(`^ {2}${name}:$`, 'm'))
})
