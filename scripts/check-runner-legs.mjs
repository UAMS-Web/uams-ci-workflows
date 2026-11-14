#!/usr/bin/env node
// Checks that a caller's run of `.github/workflows/ci.yml` ran each job on the runners its `# Legs:`
// classification names, given the inputs the caller passed (UAMS-Web/uams-ci-workflows#39).
//
// A job's check run is named `<caller job> / <job name>`, with `${{ matrix.os }}` replaced by the runner
// the leg ran on. A job that never started (switched off by its input, or skipped because a job it needs
// failed) is skipped before its matrix expands, and its check run keeps the literal `${{ matrix.os }}`.
// So the check run names alone say which runners each job reached, whatever each leg concluded.
//
// Usage:
//   node scripts/check-runner-legs.mjs --workflow <ci.yml> --caller <caller workflow> --run <owner/repo> <run id>
//   node scripts/check-runner-legs.mjs --workflow <ci.yml> --caller <caller workflow> --names <file>
//
// `--run` reads the run's check suite through the REST API (with `GITHUB_TOKEN` when it is set; a public
// repository needs none) and compares the number of check runs read with the `total_count` the API states.
// `--names` reads check run names from a file, one per line, for the planted-mismatch fixtures.
// `--caller-job` (default `checks`) is the caller's job id that calls ci.yml.
//
// Exit status: 0 when every job ran on exactly its expected runners, 1 on a mismatch (each one named),
// 2 when the inputs could not be read.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const ALL_RUNNERS = ['ubuntu-latest', 'windows-latest', 'macos-latest']
const NOT_STARTED = '${{ matrix.os }}'

/** Strips matching single or double quotes around a YAML scalar. */
function unquote(value) {
    const v = value.trim()
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) return v.slice(1, -1)
    return v
}

/** Drops a trailing ` # comment` from a YAML scalar line (not inside quotes, which these files never need). */
function stripComment(value) {
    const i = value.search(/\s#\s/)
    return i === -1 ? value : value.slice(0, i)
}

/**
 * Reads the reusable workflow: each input's default, and each job's name, gates, runner and classification.
 * Line-based, for the shape ci.yml is published in: two-space job ids under `jobs:`, four-space job keys.
 */
export function parseWorkflow(text) {
    const lines = text.split(/\r?\n/)
    const defaults = {}
    const jobs = {}
    let section = null
    let input = null
    let job = null
    for (const line of lines) {
        if (/^jobs:\s*$/.test(line)) { section = 'jobs'; job = null; continue }
        if (/^ {4}inputs:\s*$/.test(line) && section !== 'jobs') { section = 'inputs'; continue }
        if (section === 'inputs') {
            let m = line.match(/^ {6}([A-Za-z0-9_-]+):\s*$/)
            if (m) { input = m[1]; defaults[input] = ''; continue }
            m = line.match(/^ {8}default:\s*(.*)$/)
            if (m && input) { defaults[input] = unquote(stripComment(m[1])); continue }
            if (/^\S/.test(line) || /^ {2}\S/.test(line)) section = null
            continue
        }
        if (section !== 'jobs') continue
        let m = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/)
        if (m) { job = { id: m[1], name: m[1], gates: [], runsOn: null, legs: null }; jobs[job.id] = job; continue }
        if (!job) continue
        if ((m = line.match(/^ {4}name:\s*(.*)$/))) job.name = unquote(m[1])
        else if ((m = line.match(/^ {4}if:\s*(?:\$\{\{\s*)?(inputs\.[A-Za-z0-9_-]+(?:\s*\|\|\s*inputs\.[A-Za-z0-9_-]+)*)\s*(?:\}\})?\s*$/))) job.gates = [...m[1].matchAll(/inputs\.([A-Za-z0-9_-]+)/g)].map((g) => g[1])
        else if ((m = line.match(/^ {4}runs-on:\s*(.*)$/))) job.runsOn = unquote(m[1])
        else if ((m = line.match(/^ {4}# Legs:\s*(.*)$/))) job.legs = m[1]
    }
    for (const j of Object.values(jobs)) {
        const legs = j.legs ?? ''
        if (/^Linux only\b/.test(legs)) j.classification = 'linux'
        else if (/^all three\b/.test(legs)) j.classification = 'all'
        else if (/^Ubuntu only\b/.test(legs)) j.classification = 'pinned'
        else j.classification = null
    }
    return { defaults, jobs }
}

/**
 * Reads the `with:` inputs of the caller's job that calls ci.yml. Returns null when the job does not exist.
 * Line-based: the caller job's keys sit one indent level below the job id, and `with:` keys one below that.
 */
export function parseCallerInputs(text, callerJob = 'checks') {
    const lines = text.split(/\r?\n/)
    let inJobs = false
    let inJob = false
    let jobIndent = 0
    let withIndent = -1
    let found = false
    const inputs = {}
    for (const line of lines) {
        if (/^jobs:\s*$/.test(line)) { inJobs = true; continue }
        if (!inJobs) continue
        if (/^\S/.test(line)) { inJobs = false; inJob = false; continue }
        const id = line.match(/^( +)([A-Za-z0-9_-]+):\s*$/)
        if (id && (!inJob || id[1].length <= jobIndent)) {
            inJob = id[2] === callerJob
            jobIndent = id[1].length
            withIndent = -1
            if (inJob) found = true
            continue
        }
        if (!inJob || /^\s*(#.*)?$/.test(line)) continue
        const indent = line.match(/^ */)[0].length
        if (withIndent >= 0 && indent <= withIndent) withIndent = -1
        if (/^\s*with:\s*$/.test(line)) { withIndent = indent; continue }
        if (withIndent >= 0) {
            const kv = line.match(/^\s*([A-Za-z0-9_-]+):\s*(.*)$/)
            if (kv) inputs[kv[1]] = unquote(stripComment(kv[2]))
        }
    }
    return found ? inputs : null
}

/**
 * Whether a list input (space-separated job ids) names the job, as ci.yml's `contains(format(' {0} ', ...))`
 * does. `contains()` ignores case, so this does too.
 */
function names(list, id) {
    return ` ${list ?? ''} `.toLowerCase().includes(` ${id.toLowerCase()} `)
}

/** A boolean input as Actions reads it from a caller's `with:`; YAML also accepts `True` and `TRUE`. */
function isTrue(value) {
    return String(value ?? '').toLowerCase() === 'true'
}

/**
 * The runners a job should run on, or 'off' when its input switched it off. The expectation comes from the
 * classification alone, never from `runs-on`: a job classified for three runners whose `runs-on` was fixed to
 * one runner has lost two legs, and must be reported, not expected.
 */
export function expectedRunners(job, inputs) {
    // A gate of `inputs.a || inputs.b` switches the job off only when every named input is false.
    if (job.gates.length && !job.gates.some((g) => isTrue(inputs[g]))) return 'off'
    const fixed = !/^\$\{\{\s*matrix\.os\s*\}\}$/.test(job.runsOn ?? '')
    if (job.classification === 'pinned') return ['ubuntu-latest']
    if (fixed) return job.classification === 'all' ? [...ALL_RUNNERS] : ['ubuntu-latest']
    if (names(inputs['all-platform-jobs'], job.id)) return [...ALL_RUNNERS]
    if (names(inputs['windows-jobs'], job.id)) return ['ubuntu-latest', 'windows-latest']
    if (job.classification === 'all') return isTrue(inputs['linux-only']) ? ['ubuntu-latest'] : [...ALL_RUNNERS]
    return ['ubuntu-latest']
}

/** A pattern for a job's check run name, capturing the runner where the name carries `${{ matrix.os }}`. */
function namePattern(callerJob, job) {
    const parts = job.name.split(/(\$\{\{\s*[^}]*?\s*\}\})/)
    let source = ''
    let osGroup = false
    for (const part of parts) {
        if (/^\$\{\{\s*matrix\.os\s*\}\}$/.test(part)) { source += '(.+)'; osGroup = true }
        else if (/^\$\{\{/.test(part)) source += '.+'
        else source += part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    return { re: new RegExp(`^${callerJob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} / ${source}$`), osGroup }
}

/**
 * Compares check run names with what the workflow and the caller's inputs expect.
 * Returns { findings, report }: a finding per job that ran on fewer or more runners than expected,
 * and per check run under the caller job that no job in the workflow names.
 */
export function compareLegs(workflow, callerInputs, checkRunNames, callerJob = 'checks') {
    const inputs = { ...workflow.defaults, ...callerInputs }
    const findings = []
    const report = []
    const jobs = Object.values(workflow.jobs)
    for (const j of jobs) if (!j.classification) findings.push(`job \`${j.id}\` has no \`# Legs:\` classification`)
    const patterns = jobs.map((j) => ({ job: j, ...namePattern(callerJob, j) }))
    const seen = new Map(jobs.map((j) => [j.id, []]))
    const prefix = `${callerJob} / `
    for (const name of new Set(checkRunNames)) {
        if (!name.startsWith(prefix)) continue
        const hits = patterns.filter((p) => p.re.test(name))
        if (hits.length !== 1) {
            findings.push(hits.length === 0
                ? `check run \`${name}\` matches no job in the workflow`
                : `check run \`${name}\` matches more than one job: ${hits.map((h) => h.job.id).join(', ')}`)
            continue
        }
        const { job, re, osGroup } = hits[0]
        const runner = osGroup ? name.match(re)[1] : job.runsOn
        seen.get(job.id).push(runner)
    }
    for (const j of jobs) {
        const want = expectedRunners(j, inputs)
        const got = seen.get(j.id)
        const ran = got.filter((r) => r !== NOT_STARTED).sort()
        const notStarted = got.includes(NOT_STARTED)
        if (want === 'off') {
            report.push(`${j.id}: off by its input; ran on ${ran.length ? ran.join(', ') : 'none'}`)
            if (ran.length) findings.push(`job \`${j.id}\` is switched off by \`${j.gates.join(' || ')}\` but ran on ${ran.join(', ')}`)
            continue
        }
        const expected = [...want].sort()
        report.push(`${j.id}: expected ${expected.join(', ')}; ran on ${ran.length ? ran.join(', ') : 'none'}${notStarted ? ' (and a leg that never started)' : ''}`)
        if (ran.join() !== expected.join() || notStarted) {
            const missing = expected.filter((r) => !ran.includes(r))
            const extra = ran.filter((r) => !expected.includes(r))
            const detail = [
                missing.length ? `missing ${missing.join(', ')}` : '',
                extra.length ? `unexpected ${extra.join(', ')}` : '',
                notStarted ? 'skipped before its matrix expanded' : '',
            ].filter(Boolean).join('; ')
            findings.push(`job \`${j.id}\` ran on ${ran.length ? ran.join(', ') : 'no runner'}, expected ${expected.join(', ')} (${detail})`)
        }
    }
    return { findings, report }
}

/** Reads every check run name in a workflow run's check suite, and fails when fewer were read than the API states. */
export async function fetchCheckRunNames(repo, runId, token = process.env.GITHUB_TOKEN) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    if (token) headers.Authorization = `Bearer ${token}`
    const get = async (path) => {
        const res = await fetch(`https://api.github.com/${path}`, { headers })
        if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`)
        return res.json()
    }
    const run = await get(`repos/${repo}/actions/runs/${runId}`)
    const suite = run.check_suite_id
    if (!suite) throw new Error(`run ${runId} has no check_suite_id`)
    // `filter=latest` returns the newest check run of each name, so a re-run attempt replaces the one before it.
    const byName = new Map()
    let total = null
    let read = 0
    for (let page = 1; ; page++) {
        const body = await get(`repos/${repo}/check-suites/${suite}/check-runs?per_page=100&filter=latest&page=${page}`)
        total = body.total_count
        read += body.check_runs.length
        for (const cr of body.check_runs) if (!byName.has(cr.name) || byName.get(cr.name).id < cr.id) byName.set(cr.name, cr)
        if (body.check_runs.length < 100) break
    }
    if (read !== total) throw new Error(`read ${read} check runs of the ${total} the API states for run ${runId}`)
    return { names: [...byName.keys()], read, total, headSha: run.head_sha }
}

function parseArgs(argv) {
    const args = { callerJob: 'checks' }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === '--workflow') args.workflow = argv[++i]
        else if (a === '--caller') args.caller = argv[++i]
        else if (a === '--caller-job') args.callerJob = argv[++i]
        else if (a === '--names') args.names = argv[++i]
        else if (a === '--run') { args.repo = argv[++i]; args.runId = argv[++i] }
        else throw new Error(`unknown argument ${a}`)
    }
    if (!args.workflow || !args.caller || (!args.names && !args.runId)) throw new Error('need --workflow, --caller, and --names or --run')
    return args
}

async function main() {
    let args, workflow, callerInputs, names
    try {
        args = parseArgs(process.argv.slice(2))
        workflow = parseWorkflow(readFileSync(args.workflow, 'utf8'))
        if (Object.keys(workflow.jobs).length === 0) throw new Error(`no jobs read from ${args.workflow}`)
        callerInputs = parseCallerInputs(readFileSync(args.caller, 'utf8'), args.callerJob)
        if (callerInputs === null) throw new Error(`no job \`${args.callerJob}\` in ${args.caller}`)
        if (args.names) {
            names = readFileSync(args.names, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '')
            console.log(`Read ${names.length} check run names from ${args.names}.`)
        } else {
            const got = await fetchCheckRunNames(args.repo, args.runId)
            names = got.names
            console.log(`Read ${got.read} of ${got.total} check runs from ${args.repo} run ${args.runId} (head ${got.headSha}).`)
        }
    } catch (e) {
        console.error(`::error::${e.message}`)
        process.exit(2)
    }
    const under = names.filter((n) => n.startsWith(`${args.callerJob} / `)).length
    console.log(`${Object.keys(workflow.jobs).length} jobs in ${args.workflow}; ${under} check runs under \`${args.callerJob} / \`.`)
    console.log(`Caller inputs: ${JSON.stringify(callerInputs)}`)
    if (under === 0) {
        console.error(`::error::No check run is named \`${args.callerJob} / ...\`, so nothing was compared`)
        process.exit(2)
    }
    const { findings, report } = compareLegs(workflow, callerInputs, names, args.callerJob)
    for (const line of report) console.log(`  ${line}`)
    if (findings.length) {
        for (const f of findings) console.error(`::error::${f}`)
        process.exit(1)
    }
    console.log('Every job ran on exactly the runners its classification names for these inputs.')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main()
