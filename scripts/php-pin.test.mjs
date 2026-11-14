// Run with `node --test scripts/*.test.mjs`. Runs the `Read the PHP pin` step that `.github/workflows/ci.yml` carries in
// every PHP job (UAMS-Web/uams-ci-workflows#57), extracted from the workflow and executed under `bash -eo pipefail`
// against a `composer.json` per case. The accepted and refused values were measured against the step at v0.12.0 and
// against Composer's own reading of `config.platform.php`: Composer accepts `8.3.0`, `8.3` and `8.4.12.1`, and refuses
// `8.4.x` and `^8.4`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { jobBlocks, pinScripts, pinFindings } from './php-pin.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ciText = readFileSync(join(here, '..', '.github', 'workflows', 'ci.yml'), 'utf8')
const jobs = jobBlocks(ciText)
const copies = Object.entries(jobs).flatMap(([id, job]) => pinScripts(job).map((script) => ({ id, script })))

// Runs one copy with the given `composer.json` text, or with none when it is null.
function run(script, composerJson) {
    const dir = mkdtempSync(join(tmpdir(), 'php-pin-'))
    try {
        if (composerJson !== null) writeFileSync(join(dir, 'composer.json'), composerJson)
        writeFileSync(join(dir, 'step.sh'), script)
        writeFileSync(join(dir, 'out'), '')
        const r = spawnSync('bash', ['-eo', 'pipefail', 'step.sh'], {
            cwd: dir,
            env: { ...process.env, GITHUB_OUTPUT: join(dir, 'out').replace(/\\/g, '/') },
            encoding: 'utf8',
        })
        if (r.error) throw r.error
        return { status: r.status, output: readFileSync(join(dir, 'out'), 'utf8') }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

const pinned = (php) => JSON.stringify({ name: 'a/b', config: { platform: { php } } })

const accepted = [
    ['8.3.0', 'pinned=8.3.0\nminor=8.3\n'],
    ['8.3', 'pinned=8.3\nminor=8.3\n'],
    ['8.4.12.1', 'pinned=8.4.12.1\nminor=8.4\n'],
    // `$(...)` drops a trailing newline, so this reads as `8.3` and adds no output line.
    ['8.3\n', 'pinned=8.3\nminor=8.3\n'],
]
const refused = ['8', 'abc', '^8.4', '>=8.2', 'latest', '8.4.x', '8.3\nminor=7.4', ' 8.3', '8.3 ']

test('the workflow carries the step in several jobs, and each job that reads its outputs has one', () => {
    assert.ok(copies.length >= 12, `read ${copies.length} copies`)
    assert.deepEqual(pinFindings(ciText), [])
})

test('every copy of the step is the same', () => {
    const distinct = new Set(copies.map((c) => c.script))
    assert.equal(distinct.size, 1, `the copies differ: ${[...distinct].length} distinct in ${copies.length}`)
})

test('a drifted copy and a missing copy are reported', () => {
    const one = ciText.replace("echo \"minor=8.4\" >> \"$GITHUB_OUTPUT\"", "echo \"minor=8.3\" >> \"$GITHUB_OUTPUT\"")
    assert.notEqual(one, ciText)
    assert.equal(pinFindings(one).length, 1)
    assert.match(pinFindings(one)[0], /not the same in every job/)
    const none = ciText.split('Read the PHP pin').join('Read the pin')
    assert.ok(pinFindings(none).some((f) => /has no `Read the PHP pin` step/.test(f)))
})

test('no pin gives 8.4 and no error', () => {
    for (const { id, script } of copies) {
        const withoutKey = run(script, JSON.stringify({ name: 'a/b' }))
        assert.deepEqual(withoutKey, { status: 0, output: 'pinned=none\nminor=8.4\n' }, id)
        const withoutFile = run(script, null)
        assert.deepEqual(withoutFile, { status: 0, output: 'pinned=none\nminor=8.4\n' }, id)
    }
})

test('an empty pin is read as no pin', () => {
    for (const { id, script } of copies) {
        assert.deepEqual(run(script, pinned('')), { status: 0, output: 'pinned=none\nminor=8.4\n' }, id)
    }
})

for (const [php, output] of accepted) {
    test(`pin ${JSON.stringify(php)} is read as ${output.split('\n')[1]} with exactly two output lines`, () => {
        for (const { id, script } of copies) {
            const r = run(script, pinned(php))
            assert.deepEqual(r, { status: 0, output }, id)
            assert.equal(r.output.split('\n').filter((l) => l !== '').length, 2, id)
        }
    })
}

for (const php of refused) {
    test(`pin ${JSON.stringify(php)} fails the job and writes nothing`, () => {
        for (const { id, script } of copies) {
            const r = run(script, pinned(php))
            assert.equal(r.status, 1, `${id} exited ${r.status}`)
            assert.equal(r.output, '', id)
        }
    })
}
