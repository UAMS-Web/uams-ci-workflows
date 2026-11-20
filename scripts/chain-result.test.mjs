// Run with `node --test scripts/*.test.mjs`. Covers the two inputs of UAMS-Web/uams-ci-workflows#68 by running the
// workflow's own steps, extracted from `.github/workflows/ci.yml`:
//
// - `mutate-advisory`: the `result` job's `Every needed job succeeded` step, given each needed job's result and the
//   `env:` values its expressions take for the caller's inputs. With the input on, a failing `mutate` leaves the step
//   green; with it off (the default), the same failure turns it red.
// - `mutate-submodules`: the `mutate` job's `Check the submodule input` step for each value, and the job's checkout,
//   which passes the input and the `mutate-submodules-token` secret to actions/checkout.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
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

test("mutate-submodules is a string that defaults to 'false', and the token secret is optional", () => {
    assert.deepEqual(declaredInputs(text)['mutate-submodules'], { type: 'string', default: 'false' })
    assert.deepEqual(declaredSecrets(text), { 'mutate-submodules-token': { required: 'false' } })
})

const check = () => stepOf(text, 'mutate', 'Check the submodule input')

for (const value of ['false', 'true', 'recursive']) {
    test(`the submodule check accepts ${value}`, () => {
        const r = runStep(check().run, { SUBMODULES: value })
        assert.equal(r.status, 0, r.stdout)
        assert.match(r.stdout, new RegExp(`mutate-submodules is ${value}\\.`))
    })
}

for (const value of ['', 'TRUE', 'yes', 'recursive ', '1']) {
    test(`the submodule check refuses ${JSON.stringify(value)}, which actions/checkout would read as false`, () => {
        const r = runStep(check().run, { SUBMODULES: value })
        assert.equal(r.status, 1)
        assert.match(r.stdout, /::error::mutate-submodules is '.*', which is not false, true or recursive/)
    })
}

test('the check reads the input, and runs before the checkout', () => {
    assert.equal(check().env.SUBMODULES, '${{ inputs.mutate-submodules }}')
    const job = jobBlocks(text).mutate
    assert.ok(job.indexOf('- name: Check the submodule input') < job.indexOf('- uses: actions/checkout@v7'))
})

test('the mutate checkout passes the input and the caller token, falling back to the job token', () => {
    const checkouts = usesSteps(text, 'mutate', 'actions/checkout@v7')
    assert.equal(checkouts.length, 1)
    assert.deepEqual(checkouts[0].with, {
        'fetch-depth': '2',
        submodules: '${{ inputs.mutate-submodules }}',
        token: '${{ secrets.mutate-submodules-token || github.token }}',
    })
})

test('no other job checks out submodules or reads the token', () => {
    for (const [id, job] of Object.entries(jobBlocks(text))) {
        if (id === 'mutate') continue
        assert.doesNotMatch(job, /submodules:|mutate-submodules-token/, id)
    }
})

test('control: the checkout assertion fails on the checkout the job had before', () => {
    const before = text.replace(
        '          fetch-depth: 2\n          submodules: ${{ inputs.mutate-submodules }}\n          token: ${{ secrets.mutate-submodules-token || github.token }}\n',
        '          fetch-depth: 2\n',
    )
    assert.notEqual(before, text)
    assert.deepEqual(usesSteps(before, 'mutate', 'actions/checkout@v7')[0].with, { 'fetch-depth': '2' })
})
