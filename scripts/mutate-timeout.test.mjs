// Run with `node --test scripts/*.test.mjs`. Covers the `mutate` job's `timeout-minutes` expression
// (UAMS-Web/uams-ci-workflows#59): the default stays the old 45 minutes, a caller's `mutate-timeout-minutes`
// replaces it for pull requests and pushes, a value above GitHub's 360-minute job maximum is clamped, and a scheduled
// or dispatched run still takes `mutate-full-timeout-minutes`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { timeoutExpression, timeoutFor, declaredInput } from './mutate-timeout.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const text = readFileSync(join(here, '..', '.github', 'workflows', 'ci.yml'), 'utf8')

// What a caller that passes nothing gets: each input at its declared default.
const defaults = {
    'mutate-timeout-minutes': declaredInput(text, 'mutate-timeout-minutes')?.default,
    'mutate-full-timeout-minutes': declaredInput(text, 'mutate-full-timeout-minutes')?.default,
}
const withInput = (minutes) => ({ ...defaults, 'mutate-timeout-minutes': minutes })

test('the input is declared as a number with default 45, and the full-run input keeps 180', () => {
    assert.deepEqual(declaredInput(text, 'mutate-timeout-minutes'), { type: 'number', default: 45 })
    assert.deepEqual(declaredInput(text, 'mutate-full-timeout-minutes'), { type: 'number', default: 180 })
})

for (const event of ['pull_request', 'push']) {
    test(`a ${event} run that passes nothing gets exactly the old 45 minutes`, () => {
        assert.equal(timeoutFor(text, event, defaults), 45)
    })

    test(`a ${event} run that passes mutate-timeout-minutes: 240 gets 240`, () => {
        assert.equal(timeoutFor(text, event, withInput(240)), 240)
    })

    test(`a ${event} run above 360 is clamped to 360, and 360 itself is kept`, () => {
        assert.equal(timeoutFor(text, event, withInput(361)), 360)
        assert.equal(timeoutFor(text, event, withInput(5000)), 360)
        assert.equal(timeoutFor(text, event, withInput(360)), 360)
        assert.equal(timeoutFor(text, event, withInput(359)), 359)
    })
}

for (const event of ['schedule', 'workflow_dispatch']) {
    test(`a ${event} run takes mutate-full-timeout-minutes whatever mutate-timeout-minutes says`, () => {
        assert.equal(timeoutFor(text, event, defaults), 180)
        assert.equal(timeoutFor(text, event, { ...withInput(240), 'mutate-full-timeout-minutes': 200 }), 200)
    })
}

test('the checks fail on the literal the job had before: a fixed 45 ignores the input', () => {
    const before = text.replace(timeoutExpression(text), "(github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && inputs.mutate-full-timeout-minutes || 45")
    assert.notEqual(before, text)
    assert.equal(timeoutFor(before, 'pull_request', withInput(240)), 45)
    assert.notEqual(timeoutFor(before, 'pull_request', withInput(240)), timeoutFor(text, 'pull_request', withInput(240)))
})

test('the checks fail on an expression without the clamp', () => {
    const unclamped = text.replace('(inputs.mutate-timeout-minutes > 360 && 360 || inputs.mutate-timeout-minutes)', 'inputs.mutate-timeout-minutes')
    assert.notEqual(unclamped, text)
    assert.equal(timeoutFor(unclamped, 'pull_request', withInput(500)), 500)
})

test('an expression with a function in it is refused, not guessed at', () => {
    const odd = text.replace('inputs.mutate-full-timeout-minutes ||', 'fromJSON(inputs.mutate-full-timeout-minutes) ||')
    assert.notEqual(odd, text)
    assert.throws(() => timeoutFor(odd, 'pull_request', defaults), /does not read/)
})
