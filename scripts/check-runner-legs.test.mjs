// Run with `node --test scripts/*.test.mjs`. The fixtures are a real run: UAMS-Web/wordpress-plugin-template's `CI`
// run on 7b964ac4fd546666e2822735a153e652ebb6c893, its caller workflow at that commit, and `ci.yml` at
// v0.10.1, the tag that caller pins. The planted mismatches are edits of that run's check run names.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseWorkflow, parseCallerInputs, compareLegs, expectedRunners } from './check-runner-legs.mjs'

const isTrue = (value) => String(value).toLowerCase() === 'true'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'fixtures', 'runner-legs')
const workflowPath = join(fixtures, 'ci-v0.10.1.yml')
const callerPath = join(fixtures, 'template-7b964ac-ci.yml')
const namesPath = join(fixtures, 'template-7b964ac-check-runs.txt')
const workflow = parseWorkflow(readFileSync(workflowPath, 'utf8'))
const caller = parseCallerInputs(readFileSync(callerPath, 'utf8'))
const realNames = readFileSync(namesPath, 'utf8').split('\n').filter((l) => l !== '')

const findingsFor = (names, inputs = caller) => compareLegs(workflow, inputs, names).findings

test('the real run passes against the workflow it called', () => {
    assert.deepEqual(findingsFor(realNames), [])
})

test('the real run reached all three runners for pest and mutate-ignore', () => {
    for (const job of ['Pest', 'Mutation annotations (none inert)']) {
        for (const os of ['ubuntu-latest', 'windows-latest', 'macos-latest']) {
            assert.ok(realNames.includes(`checks / ${job} (${os})`), `${job} on ${os} is in the fixture`)
        }
    }
})

test('a leg missing from a three-runner job fails, naming the job and the runners it ran on', () => {
    const names = realNames.filter((n) => n !== 'checks / Pest (macos-latest)')
    const findings = findingsFor(names)
    assert.equal(findings.length, 1)
    assert.match(findings[0], /job `pest` ran on ubuntu-latest, windows-latest, expected macos-latest, ubuntu-latest, windows-latest \(missing macos-latest\)/)
})

test('an extra leg on a Linux-only job fails', () => {
    const findings = findingsFor([...realNames, 'checks / Pint (windows-latest)'])
    assert.equal(findings.length, 1)
    assert.match(findings[0], /job `pint` .*unexpected windows-latest/)
})

test('a job skipped before its matrix expanded fails', () => {
    const names = realNames.filter((n) => !n.startsWith('checks / Pest (')).concat('checks / Pest (${{ matrix.os }})')
    const findings = findingsFor(names)
    assert.equal(findings.length, 1)
    assert.match(findings[0], /job `pest` ran on no runner, .*skipped before its matrix expanded/)
})

test('an unexpanded check run beside a full set of legs still fails', () => {
    const findings = findingsFor([...realNames, 'checks / Pest (${{ matrix.os }})'])
    assert.equal(findings.length, 1)
    assert.match(findings[0], /job `pest` ran on macos-latest, ubuntu-latest, windows-latest, .*\(skipped before its matrix expanded\)/)
})

test('a job its input switched off that ran anyway fails', () => {
    const names = realNames.filter((n) => !n.startsWith('checks / Vite build')).concat('checks / Vite build (ubuntu-latest)')
    const findings = findingsFor(names)
    assert.equal(findings.length, 1)
    assert.match(findings[0], /job `vite-build` is switched off by `vite-build` but ran on ubuntu-latest/)
})

test('a check run no job names fails', () => {
    const findings = findingsFor([...realNames, 'checks / Something new (ubuntu-latest)'])
    assert.equal(findings.length, 1)
    assert.match(findings[0], /matches no job/)
})

test('check runs of other workflows and jobs are not read', () => {
    assert.deepEqual(findingsFor([...realNames, 'Analyze (python)', 'Integration (single)', 'CI']), [])
})

test('linux-only takes the three-runner jobs to ubuntu-latest, and the old linux-only run passes under it', () => {
    const inputs = { ...caller, 'linux-only': 'true' }
    assert.deepEqual(expectedRunners(workflow.jobs.pest, { ...workflow.defaults, ...inputs }), ['ubuntu-latest'])
    const linuxNames = realNames.filter((n) => !/\((windows|macos)-latest\)$/.test(n))
    assert.deepEqual(findingsFor(linuxNames, inputs), [])
    assert.equal(findingsFor(realNames, inputs).length, 2)
})

// The workflow this repository publishes, where a caller that passes no leg input runs every job on `ubuntu-latest`
// only (UAMS-Web/uams-ci-workflows#70). Check run names are built from each job's own name and the runners the
// classification expects, so each combination of inputs is compared with a run that did exactly what it asked.
const live = parseWorkflow(readFileSync(join(here, '..', '.github', 'workflows', 'ci.yml'), 'utf8'))

const namesFor = (inputs) => {
    const all = { ...live.defaults, ...inputs }
    return Object.values(live.jobs).flatMap((job) => {
        const want = expectedRunners(job, all)
        if (want === 'off') return []
        return want.map((os) => `checks / ${job.name.replace(/\$\{\{\s*matrix\.os\s*\}\}/g, os).replace(/\$\{\{.*?\}\}/g, '')}`)
    })
}
const liveFindings = (names, inputs = {}) => compareLegs(live, inputs, names).findings
const runnersOf = (id, inputs = {}) => expectedRunners(live.jobs[id], { ...live.defaults, ...inputs })

test('a caller that passes no leg input runs every job on ubuntu-latest only', () => {
    assert.equal(isTrue(live.defaults['linux-only']), true)
    for (const id of ['pest', 'mutate-ignore', 'vitest', 'mutation-smoke', 'pint', 'mutate']) {
        assert.deepEqual(runnersOf(id, { vitest: 'true', 'mutation-smoke': 'true' }), ['ubuntu-latest'], id)
    }
    const names = namesFor({ vitest: 'true', 'mutation-smoke': 'true' })
    assert.ok(names.length > 10, `built ${names.length} names`)
    assert.ok(names.every((n) => !/\((windows|macos)-latest\)$/.test(n)))
    assert.deepEqual(liveFindings(names, { vitest: 'true', 'mutation-smoke': 'true' }), [])
})

test('a Windows or macOS leg a default caller did not ask for fails, and so does a Linux leg that went missing', () => {
    const inputs = { vitest: 'true', 'mutation-smoke': 'true' }
    const names = namesFor(inputs)
    const extra = liveFindings([...names, 'checks / Pest (macos-latest)'], inputs)
    assert.equal(extra.length, 1)
    assert.match(extra[0], /job `pest` ran on macos-latest, ubuntu-latest, expected ubuntu-latest \(unexpected macos-latest\)/)
    const missing = liveFindings(names.filter((n) => n !== 'checks / Pest (ubuntu-latest)'), inputs)
    assert.equal(missing.length, 1)
    assert.match(missing[0], /job `pest` ran on no runner, expected ubuntu-latest \(missing ubuntu-latest\)/)
})

test('linux-only: false gives each job the runners its classification names', () => {
    const inputs = { 'linux-only': 'false', vitest: 'true', 'mutation-smoke': 'true' }
    for (const id of ['pest', 'mutate-ignore', 'vitest', 'mutation-smoke']) {
        assert.deepEqual(runnersOf(id, inputs).slice().sort(), ['macos-latest', 'ubuntu-latest', 'windows-latest'], id)
    }
    for (const id of ['pint', 'rector', 'phpstan']) assert.deepEqual(runnersOf(id, inputs), ['ubuntu-latest'], id)
    assert.deepEqual(runnersOf('mutate', inputs), ['ubuntu-latest'], 'mutate stays on Ubuntu')
    const names = namesFor(inputs)
    assert.deepEqual(liveFindings(names, inputs), [])
    const findings = liveFindings(names.filter((n) => n !== 'checks / Pest (macos-latest)'), inputs)
    assert.equal(findings.length, 1)
    assert.match(findings[0], /job `pest` ran on ubuntu-latest, windows-latest, expected macos-latest, ubuntu-latest, windows-latest \(missing macos-latest\)/)
})

test('a caller that still passes linux-only: true runs exactly as a caller that passes nothing', () => {
    const base = { vitest: 'true', 'mutation-smoke': 'true' }
    assert.deepEqual(namesFor({ ...base, 'linux-only': 'true' }), namesFor(base))
    assert.deepEqual(liveFindings(namesFor(base), { ...base, 'linux-only': 'true' }), [])
})

test('all-platform-jobs and windows-jobs raise the jobs they name on top of the default', () => {
    assert.deepEqual(runnersOf('pint', { 'all-platform-jobs': 'pint' }).slice().sort(), ['macos-latest', 'ubuntu-latest', 'windows-latest'])
    assert.deepEqual(runnersOf('pest', { 'windows-jobs': 'pest' }), ['ubuntu-latest', 'windows-latest'])
    assert.deepEqual(runnersOf('pest', { 'all-platform-jobs': 'pint' }), ['ubuntu-latest'], 'a job not named stays on Ubuntu')
    assert.deepEqual(runnersOf('mutate', { 'all-platform-jobs': 'mutate' }), ['ubuntu-latest'])
    const inputs = { 'all-platform-jobs': 'pint', 'windows-jobs': 'pest' }
    const names = namesFor(inputs)
    assert.deepEqual(liveFindings(names, inputs), [])
    assert.equal(liveFindings(names.filter((n) => n !== 'checks / Pint (windows-latest)'), inputs).length, 1)
})

test('all-platform-jobs and windows-jobs widen and narrow a job', () => {
    const d = workflow.defaults
    assert.deepEqual(expectedRunners(workflow.jobs.pint, { ...d, 'all-platform-jobs': 'pint' }), ['ubuntu-latest', 'windows-latest', 'macos-latest'])
    assert.deepEqual(expectedRunners(workflow.jobs.pest, { ...d, 'windows-jobs': 'pest' }), ['ubuntu-latest', 'windows-latest'])
    assert.deepEqual(expectedRunners(workflow.jobs.mutate, { ...d, 'all-platform-jobs': 'mutate' }), ['ubuntu-latest'])
    assert.deepEqual(expectedRunners(workflow.jobs.pest, { ...d, 'windows-jobs': 'pest', 'all-platform-jobs': 'pest' }), ['ubuntu-latest', 'windows-latest', 'macos-latest'])
    assert.deepEqual(expectedRunners(workflow.jobs.pest, { ...d, 'all-platform-jobs': 'pest-x' }), ['ubuntu-latest', 'windows-latest', 'macos-latest'])
    assert.deepEqual(expectedRunners(workflow.jobs.pint, { ...d, 'all-platform-jobs': 'pint-x' }), ['ubuntu-latest'])
})

test('a three-runner job whose runs-on was fixed to one runner fails', () => {
    const text = readFileSync(workflowPath, 'utf8')
        .replace('    name: Pest (${{ matrix.os }})', '    name: Pest')
        .replace(/(  pest:\n(?:    .*\n)*?)    runs-on: \$\{\{ matrix\.os \}\}/, '$1    runs-on: ubuntu-latest')
    const narrowed = parseWorkflow(text)
    assert.equal(narrowed.jobs.pest.runsOn, 'ubuntu-latest', 'the edit applied')
    const names = realNames.filter((n) => !n.startsWith('checks / Pest (')).concat('checks / Pest')
    const findings = compareLegs(narrowed, caller, names).findings
    assert.equal(findings.length, 1)
    assert.match(findings[0], /job `pest` ran on ubuntu-latest, expected macos-latest, ubuntu-latest, windows-latest \(missing macos-latest, windows-latest\)/)
})

test('a gate written as an expression, and list and boolean inputs in any case, read as Actions reads them', () => {
    const text = readFileSync(workflowPath, 'utf8').replace('    if: inputs.vitest', '    if: ${{ inputs.vitest }}')
    assert.deepEqual(parseWorkflow(text).jobs.vitest.gates, ['vitest'])
    const d = workflow.defaults
    assert.deepEqual(expectedRunners(workflow.jobs.pint, { ...d, 'all-platform-jobs': 'Pint' }), ['ubuntu-latest', 'windows-latest', 'macos-latest'])
    assert.deepEqual(expectedRunners(workflow.jobs.pest, { ...d, 'linux-only': 'True' }), ['ubuntu-latest'])
    assert.equal(expectedRunners(workflow.jobs.vitest, { ...d, vitest: 'TRUE' }).length, 3)
})

test('a gate of two inputs joined by || is off only when both are false', () => {
    const live = parseWorkflow(readFileSync(join(here, '..', '.github', 'workflows', 'ci.yml'), 'utf8'))
    const job = live.jobs['mutate-ignore']
    const d = live.defaults
    assert.deepEqual(job.gates, ['mutate', 'mutate-ignore'])
    assert.equal(expectedRunners(job, { ...d, mutate: 'false', 'mutate-ignore': 'false' }), 'off')
    assert.equal(expectedRunners(job, { ...d, 'linux-only': 'false', mutate: 'false', 'mutate-ignore': 'true' }).length, 3)
    assert.equal(expectedRunners(job, { ...d, 'linux-only': 'false', mutate: 'true', 'mutate-ignore': 'false' }).length, 3)
    assert.equal(expectedRunners(job, { ...d, mutate: 'false', 'mutate-ignore': 'true' }).length, 1, 'the default is one runner')
    assert.deepEqual(expectedRunners(job, { ...d, mutate: 'false', 'mutate-ignore': 'true', 'linux-only': 'true' }), ['ubuntu-latest'])
})

test('every job in the workflow this repository publishes is classified', () => {
    const live = parseWorkflow(readFileSync(join(here, '..', '.github', 'workflows', 'ci.yml'), 'utf8'))
    const ids = Object.keys(live.jobs)
    assert.ok(ids.length >= 18, `read ${ids.length} jobs`)
    assert.deepEqual(ids.filter((id) => !live.jobs[id].classification), [])
})

test('the caller parser reads the `with:` of the named job only', () => {
    assert.equal(caller['pest-command'], 'composer test:unit')
    assert.equal(caller['floor-lint-php'], '8.2')
    assert.equal(caller['linux-only'], undefined)
    assert.equal(parseCallerInputs(readFileSync(callerPath, 'utf8'), 'no-such-job'), null)
})

const run = (args) => spawnSync(process.execPath, [join(here, 'check-runner-legs.mjs'), ...args], { encoding: 'utf8' })

test('the command exits 0 on the real run, 1 on a planted mismatch, 2 on nothing to compare', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-legs-'))
    const narrowed = join(dir, 'narrowed.txt')
    writeFileSync(narrowed, realNames.filter((n) => n !== 'checks / Pest (macos-latest)').join('\n'))
    const empty = join(dir, 'empty.txt')
    writeFileSync(empty, 'Analyze (python)\n')
    const base = ['--workflow', workflowPath, '--caller', callerPath, '--names']
    const ok = run([...base, namesPath])
    assert.equal(ok.status, 0, ok.stderr)
    const bad = run([...base, narrowed])
    assert.equal(bad.status, 1)
    assert.match(bad.stderr, /job `pest`.*missing macos-latest/)
    const none = run([...base, empty])
    assert.equal(none.status, 2)
    assert.match(none.stderr, /nothing was compared/)
})
