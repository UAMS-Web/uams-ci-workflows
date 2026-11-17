// Run with `node --test scripts/*.test.mjs`. Runs the `Plan the shards` step that `.github/workflows/ci.yml` carries in
// the `mutate-plan` job (UAMS-Web/uams-ci-workflows#62), extracted from the workflow and executed under
// `bash -eo pipefail` in a scratch git repository per case, with the environment the workflow gives it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { planScript, selectScript } from './mutate-shards.mjs'
import { jobBlocks } from './php-pin.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ciText = readFileSync(join(here, '..', '.github', 'workflows', 'ci.yml'), 'utf8')
const script = planScript(ciText)

const SINGLE = [{ id: 0, n: 1, of: 1, paths: '' }]

// Runs the step in a scratch repository holding `files` (a name to a size in bytes map), every one tracked.
function plan({ files = {}, untracked = {}, shards = '4', event = 'workflow_dispatch', paths = 'src' }) {
    const dir = mkdtempSync(join(tmpdir(), 'mutate-shards-'))
    try {
        const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
        if (git('init', '-q').status !== 0) throw new Error('git init failed')
        for (const [name, size] of Object.entries({ ...files, ...untracked })) {
            mkdirSync(join(dir, dirname(name)), { recursive: true })
            writeFileSync(join(dir, name), 'x'.repeat(size))
        }
        if (Object.keys(files).length > 0 && git('add', '--', ...Object.keys(files)).status !== 0) throw new Error('git add failed')
        writeFileSync(join(dir, 'step.sh'), script)
        writeFileSync(join(dir, 'out'), '')
        const r = spawnSync('bash', ['-eo', 'pipefail', 'step.sh'], {
            cwd: dir,
            env: {
                ...process.env,
                GITHUB_OUTPUT: join(dir, 'out').replace(/\\/g, '/'),
                EVENT: event,
                SHARDS: shards,
                MUTATE_PATHS: paths,
            },
            encoding: 'utf8',
        })
        if (r.error) throw r.error
        const out = readFileSync(join(dir, 'out'), 'utf8')
        const line = out.split('\n').find((l) => l.startsWith('shards='))
        return { status: r.status, stdout: r.stdout, stderr: r.stderr, shards: line === undefined ? null : JSON.parse(line.slice(7)) }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

const listed = (result) => result.shards.flatMap((s) => (s.paths === '' ? [] : s.paths.split(',')))

test('the workflow carries the plan step once, in the mutate-plan job', () => {
    assert.ok(script !== null, 'the `Plan the shards` step is in the `mutate-plan` job')
    assert.equal(Object.keys(jobBlocks(ciText)).filter((id) => id === 'mutate-plan').length, 1)
})

test('the default of 1 emits one leg with an empty list and reads no file', () => {
    const r = plan({ shards: '1', files: { 'src/A.php': 10 } })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.shards, SINGLE)
})

test('a pull request and a push emit one empty leg whatever the count is', () => {
    for (const event of ['pull_request', 'push']) {
        const r = plan({ event, shards: '4', files: { 'src/A.php': 10, 'src/B.php': 20 } })
        assert.equal(r.status, 0, r.stderr)
        assert.deepEqual(r.shards, SINGLE, event)
    }
})

test('a schedule and a dispatch split the tracked PHP files under mutate-paths', () => {
    for (const event of ['schedule', 'workflow_dispatch']) {
        const r = plan({ event, shards: '2', files: { 'src/A.php': 30, 'src/B.php': 20, 'src/C.php': 10 } })
        assert.equal(r.status, 0, r.stderr)
        assert.equal(r.shards.length, 2, event)
        assert.deepEqual(listed(r).sort(), ['src/A.php', 'src/B.php', 'src/C.php'], event)
        for (const s of r.shards) assert.equal(s.of, 2)
    }
})

test('the largest file goes first and each file to the lightest shard', () => {
    const r = plan({ shards: '2', files: { 'src/A.php': 30, 'src/B.php': 20, 'src/C.php': 10 } })
    assert.deepEqual(
        r.shards.map((s) => s.paths),
        ['src/A.php', 'src/B.php,src/C.php'],
    )
})

test('only tracked PHP files under mutate-paths are listed', () => {
    const r = plan({
        shards: '3',
        paths: 'src lib',
        files: { 'src/A.php': 5, 'src/readme.md': 5, 'lib/B.php': 7, 'other/C.php': 9, 'src/d.PHP': 3 },
        untracked: { 'src/Untracked.php': 100 },
    })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(listed(r).sort(), ['lib/B.php', 'src/A.php'])
})

test('a name with a space is carried whole', () => {
    const r = plan({ shards: '2', files: { 'src/with space.php': 4, 'src/B.php': 3 } })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(listed(r).sort(), ['src/B.php', 'src/with space.php'])
})

test('a count above the number of files is clamped to it, and to 100', () => {
    const three = plan({ shards: '10', files: { 'src/A.php': 3, 'src/B.php': 2, 'src/C.php': 1 } })
    assert.equal(three.shards.length, 3)
    assert.ok(three.shards.every((s) => s.paths !== ''))
    const many = Object.fromEntries(Array.from({ length: 130 }, (_, i) => [`src/F${i}.php`, i + 1]))
    const capped = plan({ shards: '500', files: many })
    assert.equal(capped.status, 0, capped.stderr)
    assert.equal(capped.shards.length, 100)
    assert.equal(listed(capped).length, 130)
})

test('empty files cannot leave a shard with none', () => {
    const r = plan({ shards: '3', files: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`src/E${i}.php`, 0])) })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.shards.length, 3)
    assert.ok(r.shards.every((s) => s.paths !== ''), JSON.stringify(r.shards))
    assert.equal(listed(r).length, 5)
})

test('no tracked PHP file fails with the reason printed', () => {
    const r = plan({ shards: '3', files: { 'src/readme.md': 5 } })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /::error::No tracked PHP file under src/)
    assert.equal(r.shards, null)
})

test('a count that is not a whole number of 1 or more fails, for every event', () => {
    for (const event of ['workflow_dispatch', 'pull_request']) {
        for (const shards of ['0', '2.5', 'abc', '', '-1', '1e2']) {
            const r = plan({ event, shards, files: { 'src/A.php': 1 } })
            assert.equal(r.status, 1, `${event} ${JSON.stringify(shards)}`)
            assert.match(r.stdout, /not a whole number of 1 or more/)
        }
    }
})

test('a name holding a comma fails, because the list is comma-separated', () => {
    const r = plan({ shards: '2', files: { 'src/a,b.php': 5, 'src/C.php': 5 } })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /::error::A path holds a comma/)
})

test('a name holding a double quote or a backslash fails (POSIX file systems)', { skip: process.platform === 'win32' }, () => {
    for (const name of ['src/a"b.php', 'src/a\\b.php']) {
        const r = plan({ shards: '2', files: { [name]: 5, 'src/C.php': 5 } })
        assert.equal(r.status, 1, name)
        assert.match(r.stdout, /::error::A path holds a comma/)
    }
})

test('a name holding a tab fails, because the size line is tab-separated', { skip: process.platform === 'win32' }, () => {
    const r = plan({ shards: '2', files: { 'src/t	ab.php': 5, 'src/C.php': 5 } })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /::error::A path holds a comma/)
})

test('a count too long to compare fails with the friendly message', () => {
    const r = plan({ shards: '9'.repeat(25), files: { 'src/A.php': 1 } })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /not a whole number of 1 or more/)
})

test('a shard leg takes the zero-mutants pass only for changed files', () => {
    assert.doesNotMatch(jobBlocks(ciText).mutate, /"\$MODE" = "shard" \]; \} && sed/)
    assert.match(jobBlocks(ciText).mutate, /\[ "\$MODE" = "changed" \] && sed/)
})

// A small seeded generator, so a failure names its seed and reruns the same way.
function rng(seed) {
    let s = seed >>> 0
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0
        return s / 2 ** 32
    }
}

test('over generated trees every file lands in exactly one shard, none is empty, and the largest is within one file of the mean', () => {
    for (let seed = 1; seed <= 25; seed++) {
        const next = rng(seed)
        const count = 1 + Math.floor(next() * 40)
        const shards = 1 + Math.floor(next() * 12)
        const files = {}
        for (let i = 0; i < count; i++) files[`src/dir${i % 3}/F${i}.php`] = Math.floor(next() * 5000)
        const r = plan({ shards: String(shards), files })
        const note = `seed ${seed}: ${count} files, ${shards} shards asked`
        assert.equal(r.status, 0, `${note}: ${r.stderr}`)
        if (shards === 1) {
            assert.deepEqual(r.shards, SINGLE, `${note}: one job, no list`)
            continue
        }
        const got = listed(r)
        assert.deepEqual([...got].sort(), Object.keys(files).sort(), `${note}: each file exactly once`)
        const want = Math.min(shards, count, 100)
        assert.equal(r.shards.length, want, note)
        assert.ok(r.shards.every((s) => s.paths !== ''), `${note}: no shard is empty`)
        const load = r.shards.map((s) => s.paths.split(',').reduce((n, f) => n + files[f], 0))
        const total = Object.values(files).reduce((a, b) => a + b, 0)
        const biggest = Math.max(...Object.values(files))
        assert.ok(Math.max(...load) <= total / want + biggest, `${note}: max ${Math.max(...load)} mean ${total / want} biggest ${biggest}`)
    }
})

test('the same tree plans the same way twice', () => {
    const files = { 'src/A.php': 7, 'src/B.php': 7, 'src/C.php': 7, 'src/D.php': 3 }
    assert.deepEqual(plan({ shards: '3', files }).shards, plan({ shards: '3', files }).shards)
})

test('every shard carries its 1-based number, which the job name reads', () => {
    const r = plan({ shards: '3', files: { 'src/A.php': 3, 'src/B.php': 2, 'src/C.php': 1 } })
    assert.deepEqual(
        r.shards.map((s) => [s.id, s.n, s.of]),
        [
            [0, 1, 3],
            [1, 2, 3],
            [2, 3, 3],
        ],
    )
    assert.match(jobBlocks(ciText).mutate, /format\(', shard \{0\} of \{1\}', matrix\.shard\.n, matrix\.shard\.of\)/)
})

// GitHub Actions expressions have no arithmetic: `matrix.shard.id + 1` is refused when the workflow is parsed, which a
// local run of a step never reaches (found on the first dispatch of UAMS-Web/uams-ci-workflows#62).
test('no expression in the workflow uses an arithmetic operator', () => {
    const offenders = []
    let scanned = 0
    for (const line of ciText.split('\n')) {
        // Lazy to the first `}}`, because a `format('{0}')` string holds single braces that end a `[^}]*` scan early.
        for (const m of line.matchAll(/\$\{\{(.*?)\}\}/g)) {
            scanned++
            const bare = m[1].replace(/'(?:[^']|'')*'/g, "''")
            if (/\s[+*\/%]\s/.test(bare)) offenders.push(m[0])
        }
    }
    assert.ok(scanned > 100, `the scan read ${scanned} expressions`)
    assert.deepEqual(offenders, [])
})

test('the aggregate job reads mutate-plan and treats it as switched off with mutate', () => {
    const jobs = jobBlocks(ciText)
    assert.match(jobs.result, /needs: \[[^\]]*\bmutate-plan\b[^\]]*\]/)
    assert.match(jobs.result, /!inputs\.mutate && 'mutate-plan '/)
    assert.match(jobs.mutate, /needs: \[rector, phpstan, mutate-plan\]/)
    assert.match(jobs.mutate, /shard: \$\{\{ fromJSON\(needs\.mutate-plan\.outputs\.shards\) \}\}/)
})

// The `mutate` leg's own step, run with a shard's matrix values. Only the shard branch is run here: the changed-files
// branches read git history and are not touched by UAMS-Web/uams-ci-workflows#62.
const selectStep = selectScript(ciText)

function select({ id = '0', of = '2', paths = '' }) {
    const dir = mkdtempSync(join(tmpdir(), 'mutate-select-'))
    try {
        writeFileSync(join(dir, 'step.sh'), selectStep)
        writeFileSync(join(dir, 'out'), '')
        const r = spawnSync('bash', ['-eo', 'pipefail', 'step.sh'], {
            cwd: dir,
            env: {
                ...process.env,
                GITHUB_OUTPUT: join(dir, 'out').replaceAll('\\', '/'),
                EVENT: 'workflow_dispatch',
                MUTATE_PATHS: 'src',
                SHARD_ID: id,
                SHARD_OF: of,
                SHARD_PATHS: paths,
            },
            encoding: 'utf8',
        })
        if (r.error) throw r.error
        return { status: r.status, stdout: r.stdout, output: readFileSync(join(dir, 'out'), 'utf8') }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

test('a shard leg selects its own list and names the shard', () => {
    assert.ok(selectStep !== null, 'the `Select the files to mutate` step is in the `mutate` job')
    const r = select({ id: '1', of: '3', paths: 'src/A.php,src/B.php' })
    assert.equal(r.status, 0, r.stdout)
    assert.equal(r.output, 'mode=shard\npaths=src/A.php,src/B.php\n')
    assert.match(r.stdout, /Mutating shard 2 of 3:\nsrc\/A\.php\nsrc\/B\.php/)
})

test('a shard leg with no files fails rather than mutating everything', () => {
    const r = select({ id: '0', of: '4', paths: '' })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /::error::Shard 1 of 4 has no files, so it would mutate everything\./)
    assert.equal(r.output, '')
})

test('a one-leg matrix does not take the shard branch', () => {
    const r = select({ id: '0', of: '1', paths: '' })
    assert.equal(r.output, 'mode=full\n')
})
