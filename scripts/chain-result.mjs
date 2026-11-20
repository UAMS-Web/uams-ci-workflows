// Reads steps out of `.github/workflows/ci.yml` so the tests of UAMS-Web/uams-ci-workflows#68 run the workflow's own
// text and not a retyped copy: the `result` job's `Every needed job succeeded` step, with the expressions its `env:`
// block computes from the caller's inputs, and the `mutate` job's `Check the submodule input` step and checkout.
//
// The `env:` expressions are evaluated over a fixed allow-list of tokens: `inputs.<name>`, single-quoted strings,
// `!`, `&&`, `||`, parentheses, commas and `format()` whose template is placeholders only. `&&` and `||` return an
// operand in a workflow expression as in JavaScript. A token outside the list throws, so a new construct in the
// expression makes the tests fail loudly instead of evaluating wrongly.

import { spawnSync } from 'node:child_process'
import { jobBlocks } from './php-pin.mjs'

const normalize = (text) => text.replace(/\r\n/g, '\n')

// The step named `name` in job `id`, as { env: { KEY: raw value }, run: shell or null, with: { key: raw value } },
// or null when the job or the step is missing.
export function stepOf(text, id, name) {
    const job = jobBlocks(text)[id]
    if (job === undefined) return null
    const lines = normalize(job).split('\n')
    const start = lines.findIndex((l) => l === `      - name: ${name}`)
    if (start === -1) return null
    const body = []
    for (const line of lines.slice(start + 1)) {
        if (/^ {6}- /.test(line) || /^ {0,5}\S/.test(line)) break
        body.push(line)
    }
    return parseStep(body)
}

// The steps of job `id` that use `action` (such as `actions/checkout@v7`), each parsed as stepOf parses one.
export function usesSteps(text, id, action) {
    const job = jobBlocks(text)[id]
    if (job === undefined) return []
    const lines = normalize(job).split('\n')
    const found = []
    lines.forEach((line, i) => {
        if (line !== `      - uses: ${action}`) return
        const body = []
        for (const l of lines.slice(i + 1)) {
            if (/^ {6}- /.test(l) || /^ {0,5}\S/.test(l)) break
            body.push(l)
        }
        found.push(parseStep(body))
    })
    return found
}

function parseStep(body) {
    const step = { env: {}, with: {}, run: null }
    let section = null
    for (let i = 0; i < body.length; i++) {
        const line = body[i]
        const key = line.match(/^ {8}([a-z-]+):(?: (.*))?$/)
        if (key) {
            section = key[1]
            if (section === 'run' && key[2] === '|') {
                const run = []
                for (const l of body.slice(i + 1)) {
                    if (l !== '' && !/^ {10}/.test(l)) break
                    run.push(l.replace(/^ {10}/, ''))
                }
                step.run = run.join('\n').trimEnd() + '\n'
            }
            continue
        }
        const entry = line.match(/^ {10}([A-Za-z0-9_-]+): (.*)$/)
        if (entry && (section === 'env' || section === 'with')) step[section][entry[1]] = entry[2]
    }
    return step
}

const ALLOWED = /^(?:inputs\.[A-Za-z0-9_-]+|'[^']*'|format|!|&&|\|\||\(|\)|,|\s+)+$/

// The value an `env:` entry such as `${{ inputs.x && 'a ' || '' }}` takes for the given inputs, as a string.
export function evaluate(raw, inputs) {
    const m = raw.match(/^\$\{\{ (.+) \}\}$/)
    if (!m) return raw
    const expr = m[1]
    if (!ALLOWED.test(expr)) throw new Error(`the expression uses something this evaluator does not read: ${expr}`)
    const js = expr.replace(/inputs\.([A-Za-z0-9_-]+)/g, (_, name) => {
        if (!(name in inputs)) throw new Error(`no value for inputs.${name}`)
        return `inputs[${JSON.stringify(name)}]`
    })
    const format = (template, ...args) => {
        if (!/^(?:\{\d+\})*$/.test(template)) throw new Error(`format template is not placeholders only: ${template}`)
        return template.replace(/\{(\d+)\}/g, (_, n) => String(args[Number(n)] ?? ''))
    }
    return String(new Function('inputs', 'format', `return (${js})`)(inputs, format))
}

// Runs a step's shell under `bash -eo pipefail`, which is how a `shell: bash` step runs, with `env` added.
export function runStep(script, env) {
    const r = spawnSync('bash', ['-eo', 'pipefail', '-c', script], { env: { ...process.env, ...env }, encoding: 'utf8' })
    if (r.error) throw r.error
    return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

// The `result` job's verdict for `results` (a job id to a result map; every other needed job succeeds) under `inputs`.
export function chainResult(text, results, inputs) {
    const step = stepOf(text, 'result', 'Every needed job succeeded')
    if (step === null || step.run === null) throw new Error('no `Every needed job succeeded` step in the `result` job')
    const needsLine = normalize(jobBlocks(text).result).match(/^ {4}needs: \[(.+)\]$/m)
    if (!needsLine) throw new Error('the `result` job has no `needs:` list')
    const needs = Object.fromEntries(needsLine[1].split(',').map((s) => s.trim()).map((id) => [id, { result: results[id] ?? 'success', outputs: {} }]))
    const env = {}
    for (const [key, raw] of Object.entries(step.env)) env[key] = key === 'NEEDS' ? JSON.stringify(needs) : evaluate(raw, inputs)
    return { ...runStep(step.run, env), env }
}

// Every input's declared type and default, as written.
export function declaredInputs(text) {
    const block = normalize(text).match(/^ {4}inputs:\n((?: {6}.*\n)+)/m)
    if (!block) throw new Error('no `inputs:` block')
    const out = {}
    for (const m of block[1].matchAll(/^ {6}([A-Za-z0-9_-]+):\n((?: {8}.*\n)+)/gm)) {
        const type = m[2].match(/^ {8}type: (\S+)$/m)?.[1]
        let def = m[2].match(/^ {8}default: (.*)$/m)?.[1]
        if (def !== undefined && /^'.*'$/.test(def)) def = def.slice(1, -1)
        out[m[1]] = { type, default: type === 'boolean' ? def === 'true' : type === 'number' ? Number(def) : def }
    }
    return out
}

// Every input at its declared default: what a caller that passes nothing gets.
export function defaultInputs(text) {
    return Object.fromEntries(Object.entries(declaredInputs(text)).map(([k, v]) => [k, v.default]))
}

// The `secrets:` block of `on.workflow_call`, as a name to { required } map.
export function declaredSecrets(text) {
    const block = normalize(text).match(/^ {4}secrets:\n((?: {6}.*\n)+)/m)
    if (!block) return {}
    const out = {}
    for (const m of block[1].matchAll(/^ {6}([A-Za-z0-9_-]+):\n((?: {8}.*\n)+)/gm)) {
        out[m[1]] = { required: m[2].match(/^ {8}required: (\S+)$/m)?.[1] }
    }
    return out
}
