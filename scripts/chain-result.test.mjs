// Run with `node --test scripts/*.test.mjs`. Covers the two inputs of UAMS-Web/uams-ci-workflows#68 by running the
// workflow's own steps, extracted from `.github/workflows/ci.yml`:
//
// - `mutate-advisory`: the `result` job's `Every needed job succeeded` step, given each needed job's result and the
//   `env:` values its expressions take for the caller's inputs. With the input on, a failing `mutate` leaves the step
//   green; with it off (the default), the same failure turns it red.
// - `mutate-submodules`: the `mutate` job's `Check out the named submodules` step, run in a scratch caller tree whose
//   submodules are local repositories, and the job's checkout, which persists no credentials when that step runs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { chainResult, declaredInputs, declaredSecrets, defaultInputs, evaluate, runStep, stepOf, usesSteps } from './chain-result.mjs'
import { jobBlocks } from './php-pin.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const text = readFileSync(join(here, '..', '.github', 'workflows', 'ci.yml'), 'utf8')
const defaults = defaultInputs(text)
const advisory = { ...defaults, 'mutate-advisory': true }

// mutate-advisory

test('mutate-advisory is a boolean that defaults to false', () => {
    assert.deepEqual(declaredInputs(text)['mutate-advisory'], { type: 'boolean', default: false })
})

test('every needed job succeeding passes, with the input off and on', () => {
    assert.equal(chainResult(text, {}, defaults).status, 0)
    assert.equal(chainResult(text, {}, advisory).status, 0)
})

test('with the input off, a failing mutate fails the result, as before', () => {
    const r = chainResult(text, { mutate: 'failure' }, defaults)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /::error::mutate reported failure/)
})

for (const result of ['failure', 'cancelled', 'skipped']) {
    test(`with the input on, a mutate that reports ${result} leaves the result green and warns`, () => {
        const r = chainResult(text, { mutate: result }, advisory)
        assert.equal(r.status, 0, r.stdout)
        assert.match(r.stdout, new RegExp(`::warning::mutate reported ${result}, which mutate-advisory keeps out of this result`))
        assert.doesNotMatch(r.stdout, /::error::/)
    })

    test(`with the input off, a mutate that reports ${result} fails the result`, () => {
        assert.equal(chainResult(text, { mutate: result }, defaults).status, 1)
    })
}

test('the input keeps only mutate out: a failing pest, mutate-plan or mutate-ignore still fails the result', () => {
    for (const id of ['pest', 'mutate-plan', 'mutate-ignore', 'phpstan']) {
        const r = chainResult(text, { [id]: 'failure' }, advisory)
        assert.equal(r.status, 1, id)
        assert.match(r.stdout, new RegExp(`::error::${id} reported failure`))
    }
})

test('with the input on, a failing mutate beside a failing pest still fails, naming pest only', () => {
    const r = chainResult(text, { mutate: 'failure', pest: 'failure' }, advisory)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /::error::pest reported failure/)
    assert.doesNotMatch(r.stdout, /::error::mutate reported/)
})

test('mutate: false still accepts the skip with the input off, as before', () => {
    const off = { ...defaults, mutate: false }
    assert.equal(chainResult(text, { mutate: 'skipped', 'mutate-plan': 'skipped', 'mutate-ignore': 'skipped' }, off).status, 0)
})

test('ADVISORY names mutate only when the input is on', () => {
    const raw = stepOf(text, 'result', 'Every needed job succeeded').env.ADVISORY
    assert.equal(evaluate(raw, defaults), '')
    assert.equal(evaluate(raw, advisory), 'mutate ')
})

test('control: with the advisory line taken out of the step, the input no longer keeps a failure out', () => {
    const line = '            if [[ " $ADVISORY" == *" $id "* ]]; then echo "::warning::$id reported $result, which mutate-advisory keeps out of this result"; continue; fi\n'
    const without = text.replace(line, '')
    assert.notEqual(without, text)
    assert.equal(chainResult(without, { mutate: 'failure' }, advisory).status, 1)
})

test('control: with the ADVISORY expression pointed at pest, a failing mutate fails again', () => {
    const wrong = text.replace("ADVISORY: ${{ inputs.mutate-advisory && 'mutate ' || '' }}", "ADVISORY: ${{ inputs.mutate-advisory && 'pest ' || '' }}")
    assert.notEqual(wrong, text)
    assert.equal(chainResult(wrong, { mutate: 'failure' }, advisory).status, 1)
    assert.equal(chainResult(wrong, { pest: 'failure' }, advisory).status, 0)
})

test('the evaluator refuses an expression it does not read', () => {
    assert.throws(() => evaluate("${{ contains(inputs.mutate, 'x') }}", defaults), /does not read/)
})

// mutate-submodules

test("mutate-submodules is a string that defaults to empty, the recursive switch is off, and the token is optional", () => {
    assert.deepEqual(declaredInputs(text)['mutate-submodules'], { type: 'string', default: '' })
    assert.deepEqual(declaredInputs(text)['mutate-submodules-recursive'], { type: 'boolean', default: false })
    assert.deepEqual(declaredSecrets(text), { 'mutate-submodules-token': { required: 'false' } })
})

const step = () => stepOf(text, 'mutate', 'Check out the named submodules')

test('the submodule step runs only when a path is named, and reads the inputs and the token', () => {
    assert.equal(step().if, "inputs.mutate-submodules != ''")
    assert.deepEqual(step().env, {
        SUBMODULES: '${{ inputs.mutate-submodules }}',
        RECURSIVE: '${{ inputs.mutate-submodules-recursive }}',
        TOKEN: '${{ secrets.mutate-submodules-token || github.token }}',
    })
})

test('the checkout persists credentials as before by default, and none when submodules are named', () => {
    const checkouts = usesSteps(text, 'mutate', 'actions/checkout@v7')
    assert.equal(checkouts.length, 1)
    assert.deepEqual(checkouts[0].with, { 'fetch-depth': '2', 'persist-credentials': "${{ inputs.mutate-submodules == '' }}" })
    assert.equal(evaluate(checkouts[0].with['persist-credentials'], defaults), 'true')
    assert.equal(evaluate(checkouts[0].with['persist-credentials'], { ...defaults, 'mutate-submodules': 'content' }), 'false')
    const job = jobBlocks(text).mutate
    assert.ok(job.indexOf('- uses: actions/checkout@v7') < job.indexOf('- name: Check out the named submodules'))
    assert.ok(job.indexOf('- name: Check out the named submodules') < job.indexOf('- uses: ./.github/actions/setup'))
})

test('no other job checks out submodules or reads the token', () => {
    for (const [id, job] of Object.entries(jobBlocks(text))) {
        if (id === 'mutate') continue
        assert.doesNotMatch(job, /submodule|mutate-submodules-token/, id)
    }
})

// A caller tree like uams-statamic's: `content` (which nests `inner`) and `public/assets`, each its own repository,
// reached over file:// so the test needs no network. Git refuses file:// for a submodule unless
// protocol.file.allow is set, and the test sets it through GIT_CONFIG_* as a runner would carry any config: so a fetch
// that succeeds also shows that the step's own GIT_CONFIG_* entries are added to the ones already set, not in place.
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'mutate-submodules-'))
    const git = (cwd, ...args) => {
        const r = spawnSync('git', ['-c', 'protocol.file.allow=always', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, encoding: 'utf8' })
        if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
        return r.stdout
    }
    const repo = (name) => {
        const dir = join(root, name)
        mkdirSync(dir)
        git(dir, 'init', '-q')
        writeFileSync(join(dir, `${name}.txt`), name)
        git(dir, 'add', '.')
        git(dir, 'commit', '-q', '-m', name)
        return dir
    }
    const url = (dir) => pathToFileURL(dir).href
    const inner = repo('inner')
    const content = repo('content')
    git(content, 'submodule', 'add', '-q', url(inner), 'inner')
    git(content, 'commit', '-q', '-m', 'inner')
    const assets = repo('assets')
    const caller = repo('caller')
    git(caller, 'submodule', 'add', '-q', url(content), 'content')
    git(caller, 'submodule', 'add', '-q', url(assets), 'public/assets')
    git(caller, 'commit', '-q', '-m', 'submodules')
    git(root, 'clone', '-q', url(caller), 'work')
    return { root, work: join(root, 'work') }
}

const FILE_ALLOWED = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'protocol.file.allow', GIT_CONFIG_VALUE_0: 'always' }

function checkOut(submodules, { recursive = 'false', token = 'fixture-token', env = FILE_ALLOWED } = {}) {
    const { root, work } = fixture()
    try {
        const r = runStep(step().run, { ...env, SUBMODULES: submodules, RECURSIVE: recursive, TOKEN: token }, work)
        // Read now: the tree is removed below, after which every file would read as absent.
        const present = new Set(['content/content.txt', 'content/inner/inner.txt', 'public/assets/assets.txt'].filter((p) => existsSync(join(work, p))))
        const has = (path) => {
            if (!['content/content.txt', 'content/inner/inner.txt', 'public/assets/assets.txt'].includes(path)) throw new Error(`not a fixture file: ${path}`)
            return present.has(path)
        }
        const configs = [join(work, '.git', 'config')]
        const modules = join(work, '.git', 'modules')
        const walk = (dir) => {
            if (!existsSync(dir)) return
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const p = join(dir, entry.name)
                if (entry.isDirectory()) walk(p)
                else if (entry.name === 'config') configs.push(p)
            }
        }
        walk(modules)
        const onDisk = configs.map((p) => readFileSync(p, 'utf8')).join('\n')
        return { ...r, has, onDisk, configs: configs.length }
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
}

test('the fixture tree has both submodules registered and none checked out before the step', () => {
    const { root, work } = fixture()
    try {
        assert.equal(existsSync(join(work, 'content', 'content.txt')), false)
        assert.equal(existsSync(join(work, 'public', 'assets', 'assets.txt')), false)
        assert.match(readFileSync(join(work, '.gitmodules'), 'utf8'), /path = public\/assets/)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test('naming content checks out content only: not the asset submodule beside it, nor the one nested in it', () => {
    const r = checkOut('content')
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(r.has('content/content.txt'), true)
    assert.equal(r.has('public/assets/assets.txt'), false)
    assert.equal(r.has('content/inner/inner.txt'), false)
    assert.match(r.stdout, /^content checked out at [0-9a-f]{40}$/m)
})

test('with the recursive switch, the submodule nested in a named one is checked out too', () => {
    const r = checkOut('content', { recursive: 'true' })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(r.has('content/inner/inner.txt'), true)
    assert.equal(r.has('public/assets/assets.txt'), false)
})

test('two names check out both', () => {
    const r = checkOut('content public/assets')
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(r.has('content/content.txt'), true)
    assert.equal(r.has('public/assets/assets.txt'), true)
})

for (const name of ['missing', 'public', 'content/inner', 'Content']) {
    test(`a path .gitmodules does not register (${name}) fails the step before any fetch`, () => {
        const r = checkOut(`content ${name}`)
        assert.equal(r.status, 1)
        assert.match(r.stdout, new RegExp(`::error::mutate-submodules names ${name}, which .gitmodules does not register as a submodule path`))
        assert.equal(r.has('content/content.txt'), false)
    })
}

test('a value of spaces alone fails the step, rather than checking out every submodule', () => {
    const r = checkOut('   ')
    assert.equal(r.status, 1)
    assert.match(r.stdout, /::error::mutate-submodules holds no path/)
    assert.equal(r.has('content/content.txt'), false)
    assert.equal(r.has('public/assets/assets.txt'), false)
})

test('the token is masked in the log and written to no git config on disk', () => {
    const r = checkOut('content', { token: 'planted-token-value' })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const auth = Buffer.from('x-access-token:planted-token-value').toString('base64')
    assert.match(r.stdout, new RegExp(`^::add-mask::${auth.replace(/[+/=]/g, '\\$&')}$`, 'm'))
    assert.ok(r.configs >= 2, `read ${r.configs} config file(s), expected the caller's and the submodule's`)
    assert.doesNotMatch(r.onDisk, /planted-token-value|extraheader|AUTHORIZATION/i)
    assert.ok(!r.onDisk.includes(auth))
})

test('control: without protocol.file.allow in GIT_CONFIG_*, the same fetch fails, so the entries reach the submodule clone', () => {
    const r = checkOut('content', { env: {} })
    assert.notEqual(r.status, 0)
    assert.equal(r.has('content/content.txt'), false)
})

test('control: the config-on-disk check finds a header that a persisted checkout would leave', () => {
    const { root, work } = fixture()
    try {
        spawnSync('git', ['config', 'http.https://github.com/.extraheader', 'AUTHORIZATION: basic planted'], { cwd: work })
        assert.match(readFileSync(join(work, '.git', 'config'), 'utf8'), /extraheader/)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})
