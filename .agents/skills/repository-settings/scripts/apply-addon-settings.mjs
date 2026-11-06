#!/usr/bin/env node
// apply-addon-settings.mjs: bring ONE new Statamic add-on repository to the settings standard,
// and read every change back (UAMS-Web/uams-claude-skills#460).
//
// A person runs it from the root of the new repository's checkout, after creating the repository
// from the add-on template. It covers the steps the template README lists as living outside the
// repository:
//   1. the merge, security and feature settings the `repository-settings` baseline fixes
//      (squash only, PR_TITLE and PR_BODY, auto-merge off, update-branch on, and the rest);
//   2. the organization default-branch rules (deletion, force push, pull request required): set
//      through the `ruleset_family` property when the organization defines it, otherwise named for
//      the owner, because adding a repository id to an organization ruleset needs `admin:org`;
//   3. the `required_checks` property values `pr-body` and `ci-aggregate`, so the organization rulesets
//      require the aggregate `CI` check and the two pull-request-body checks; no per-job repository
//      ruleset is planned or written.
// It then prints what stays with a human: the manifest entry and the sync dispatch, the wiki's
// first page, tags and Packagist.
//
// A settings change needs the owner's yes at run time, so the default run only READS and prints the
// plan. `--apply` asks "Apply N changes? [y/N]" before the first write; `--yes` answers for a
// scripted run the owner has already approved. Every write goes through writeGuard(), an allow-list
// of four calls on the one named repository, so nothing else can be written from here.
//
// Usage, from the repository root of the new add-on's checkout:
//     node .claude/skills/repository-settings/scripts/apply-addon-settings.mjs <owner>/<repo> [--apply] [--yes]
//
// Nothing is read from the checkout: the command works from the API alone, so it needs neither the
// template's scripts nor any dependency installed (UAMS-Web/uams-claude-skills#521).
//
// EXIT CODES
//     0  nothing to change, a plan printed, or everything applied and read back clean
//     1  applied, but the read-back still shows a departure
//     2  the instrument is broken: a control failed, an argument is wrong, a read or write failed,
//        or the run was not confirmed

import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import {
    ATOMIC_CHECKS,
    BASELINE,
    CHECKS_PROPERTY,
    FAMILIES,
    OPEN,
    RULESET_PROPERTY,
    departures,
    ghApi,
    matchingSnapshot,
    readSnapshot,
    visibilityOf,
} from './check-repository-settings.mjs'

/** The repository ruleset an earlier version of this command wrote; it is no longer planned, and an existing one is reported. */
export const RULESET_NAME = 'main: required checks'

/** The `required_checks` value this command adds: the organization ruleset requiring the aggregate `CI` check. */
export const AGGREGATE_VALUE = 'ci-aggregate'

/** The `ruleset_family` value a new add-on takes: the default-branch rules only; its required checks come from `NEW_ADDON_CHECKS` (UAMS-Web/uams-claude-skills#511). */
export const NEW_ADDON_FAMILY = 'base'

/** The `required_checks` values a new add-on holds. */
export const NEW_ADDON_CHECKS = ['pr-body', AGGREGATE_VALUE]

/** Baseline rows a PATCH of the repository can set. */
export const SETTINGS_ROWS = [
    'allow_squash_merge', 'allow_merge_commit', 'allow_rebase_merge', 'squash_merge_commit_title', 'squash_merge_commit_message',
    'allow_auto_merge', 'allow_update_branch', 'web_commit_signoff_required', 'has_issues', 'has_projects', 'has_discussions',
]

/** Rows the rulesets steps own: they are judged by the read-back of those steps, not by the settings pass. */
export const RULESET_ROWS = ['rule_deletion', 'rule_non_fast_forward', 'rule_pull_request', 'rule_required_status_checks', 'ruleset_family', 'required_checks']

const DEFAULT_RULES = ['deletion', 'non_fast_forward', 'pull_request']
const ORG_SCHEMA_READ = /^orgs\/[\w.-]+\/properties\/schema$/

/** Read-only `gh api`: the checker's allow-list, plus the organization's property schema. */
export function ghRead(args) {
    if (args.length === 1 && ORG_SCHEMA_READ.test(args[0])) {
        const result = spawnSync('gh', ['api', args[0]], { encoding: 'utf8' })
        return { status: result.status ?? 2, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    return ghApi(args)
}

/**
 * The only writes this command can make, all on one repository: PATCH of the repository and PATCH of
 * its property values. Returns the call, or throws.
 */
export function writeGuard(target, method, path) {
    const base = `repos/${target}`
    const allowed = [
        ['PATCH', (p) => p === base],
        ['PATCH', (p) => p === `${base}/properties/values`],
    ]
    if (!/^[\w.-]+\/[\w.-]+$/.test(target) || !allowed.some(([m, test]) => m === method && test(path))) {
        throw new Error(`refusing a write that is not one of the two this command makes: ${method} ${path}`)
    }
    return { method, path }
}

/** A writer bound to one repository: sends the JSON body on stdin so no shell sees it. */
export function makeWriter(target) {
    return (method, path, body) => {
        writeGuard(target, method, path)
        const result = spawnSync('gh', ['api', '-X', method, path, '--input', '-'], { encoding: 'utf8', input: JSON.stringify(body) })
        return { status: result.status ?? 2, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
}

/** The values the repository's `required_checks` property holds: an unset or null property is an empty list. */
export function declaredRequiredChecks(snapshot) {
    const value = (snapshot.properties ?? []).find((item) => item?.property_name === CHECKS_PROPERTY)?.value
    if (value === null || value === undefined) return []
    return Array.isArray(value) ? value.map(String) : [String(value)]
}

/** Whether the organization-sourced rules in effect include all three default-branch rule types. */
export function hasOrganizationDefaultRules(snapshot) {
    const types = (snapshot.rules ?? []).filter((rule) => rule?.ruleset_source_type === 'Organization').map((rule) => rule.type)
    return DEFAULT_RULES.every((type) => types.includes(type))
}

/**
 * What to change and what is left for a human, from what was read. `inputs`:
 *   snapshot       the checker's snapshot of the repository
 *   fullName       owner/repo
 *   rulesets       the repository's rulesets as listed (`repos/{o}/{r}/rulesets`), read only to report a leftover "main: required checks"
 *   schemaDefined  true or false when the organization property schema defined `ruleset_family`, undefined when it could not be read
 *   checksDefined  the same for the `required_checks` property
 * Returns { changes: [{ id, say, method, path, body }], human: [string] }.
 */
export function buildPlan({ snapshot, fullName, rulesets, schemaDefined, checksDefined }) {
    const changes = []
    const human = []
    const visibility = visibilityOf(snapshot)

    // 1. the settings the baseline fixes and a PATCH can set
    const fields = {}
    for (const item of departures(snapshot)) {
        if (RULESET_ROWS.includes(item.id)) continue
        const row = BASELINE.find((candidate) => candidate.id === item.id)
        if (SETTINGS_ROWS.includes(item.id) && row !== undefined) fields[item.id] = row.expect[visibility]
        else human.push(`${item.id}: expected ${item.expected}, found ${item.found} (this command does not set it)`)
    }
    if (Object.keys(fields).length > 0) {
        changes.push({ id: 'settings', say: `set ${Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(', ')}`, method: 'PATCH', path: `repos/${fullName}`, body: fields })
    }

    // 2. the organization default-branch rules
    if (!hasOrganizationDefaultRules(snapshot)) {
        const current = (snapshot.properties ?? []).find((item) => item?.property_name === RULESET_PROPERTY)?.value
        if (current !== undefined && current !== null && current in FAMILIES && FAMILIES[current].rules.length > 0) {
            human.push(`the ${RULESET_PROPERTY} property already reads ${current} but the organization default-branch rules do not reach this repository: the organization rulesets have not been switched to the property yet (owner)`)
        } else if (schemaDefined === true) {
            changes.push({ id: 'property', say: `set the ${RULESET_PROPERTY} property to ${NEW_ADDON_FAMILY}`, method: 'PATCH', path: `repos/${fullName}/properties/values`, body: { properties: [{ property_name: RULESET_PROPERTY, value: NEW_ADDON_FAMILY }] } })
        } else {
            human.push(`add repository id ${snapshot.repo?.id ?? '<id>'} to organization rulesets 24525022 and 24525074 (needs admin:org), or define the ${RULESET_PROPERTY} property so this command can set it${schemaDefined === undefined ? ' (the property schema could not be read with this credential)' : ''}`)
        }
    }

    // 3. the aggregate `CI` check and the pull-request-body checks, required by the organization through the `required_checks` property
    const declared = declaredRequiredChecks(snapshot)
    const absent = NEW_ADDON_CHECKS.filter((value) => !declared.includes(value))
    if (absent.length > 0) {
        if (checksDefined === true) {
            changes.push({ id: 'checks', say: `set the ${CHECKS_PROPERTY} property to ${[...declared, ...absent].join(', ')}`, method: 'PATCH', path: `repos/${fullName}/properties/values`, body: { properties: [{ property_name: CHECKS_PROPERTY, value: [...declared, ...absent] }] } })
        } else {
            human.push(`set the ${CHECKS_PROPERTY} property to include ${absent.join(' and ')} so the organization requires the aggregate CI check and the pull-request-body checks (the property is not defined for the organization${checksDefined === undefined ? ', or its schema could not be read with this credential' : ''})`)
        }
    }

    // a per-job ruleset from an earlier run is no longer maintained here, and this command never deletes
    const own = (rulesets ?? []).find((ruleset) => ruleset?.name === RULESET_NAME && ruleset?.source_type === 'Repository')
    if (own !== undefined) human.push(`the repository ruleset "${RULESET_NAME}" (id ${own.id}) from an earlier run still exists and is no longer maintained: remove it once the organization requires the aggregate CI check`)

    // what stays with a person whatever the run does
    human.push('add the repository to shared/manifest.json in UAMS-Web/uams-claude-skills (public: true, the profiles of the other add-ons), review the files it would receive, then approve the sync dispatch')
    human.push('create the wiki\'s first page, and tag, release and register the package on Packagist')
    return { changes, human }
}

/** Known inputs the plan must handle. Returns the names of any it got wrong. */
export function controlFailures() {
    const failed = []
    const snapshot = matchingSnapshot('public')
    snapshot.repo.id = 1
    snapshot.properties.push({ property_name: CHECKS_PROPERTY, value: [...NEW_ADDON_CHECKS] })
    snapshot.rules.push({ type: 'required_status_checks', ruleset_source_type: 'Organization', ruleset_id: 3, parameters: { required_status_checks: [{ context: 'CI' }] } })
    const base = { snapshot, fullName: 'UAMS-Web/control', rulesets: [], schemaDefined: true, checksDefined: true }
    if (buildPlan(base).changes.length !== 0) failed.push('a repository that matches the standard produced a change')
    const planted = structuredClone(snapshot)
    planted.repo.allow_merge_commit = true
    const settings = buildPlan({ ...base, snapshot: planted }).changes
    if (settings.length !== 1 || settings[0].id !== 'settings' || settings[0].body.allow_merge_commit !== false) failed.push('a planted merge-commit departure was not the one settings change')
    const unchecked = structuredClone(snapshot)
    unchecked.properties = unchecked.properties.filter((item) => item.property_name !== CHECKS_PROPERTY)
    const adds = buildPlan({ ...base, snapshot: unchecked }).changes
    if (adds.length !== 1 || adds[0].id !== 'checks' || JSON.stringify(adds[0].body.properties[0].value) !== JSON.stringify(NEW_ADDON_CHECKS)) failed.push('a repository without the required_checks values did not get them as the one change')
    const other = structuredClone(snapshot)
    other.properties.find((item) => item.property_name === CHECKS_PROPERTY).value = [AGGREGATE_VALUE]
    const kept = buildPlan({ ...base, snapshot: other }).changes
    if (kept.length !== 1 || JSON.stringify(kept[0].body.properties[0].value) !== JSON.stringify([AGGREGATE_VALUE, 'pr-body'])) failed.push('an existing required_checks value was not kept beside the missing one')
    if (!buildPlan({ ...base, snapshot: unchecked, checksDefined: false }).human.some((line) => line.includes(`include ${NEW_ADDON_CHECKS.join(' and ')}`))) failed.push('an undefined required_checks property was not left to the owner')
    if (buildPlan({ ...base, rulesets: [{ id: 7, name: RULESET_NAME, source_type: 'Repository' }] }).changes.length !== 0) failed.push('a leftover per-job ruleset produced a change')
    if (!buildPlan({ ...base, rulesets: [{ id: 7, name: RULESET_NAME, source_type: 'Repository' }] }).human.some((line) => line.includes('id 7'))) failed.push('a leftover per-job ruleset was not reported')
    const bare = structuredClone(snapshot)
    bare.rules = bare.rules.filter((rule) => rule.type === 'required_status_checks')
    bare.properties = []
    const setFamily = buildPlan({ ...base, snapshot: bare }).changes.find((change) => change.id === 'property')
    if (setFamily === undefined) failed.push('missing organization rules with a defined property did not set the property')
    else if (setFamily.body.properties[0].value !== 'base') failed.push('a new add-on was not given the base family')
    if (!buildPlan({ ...base, snapshot: bare, schemaDefined: false }).human.some((line) => line.includes('admin:org'))) failed.push('missing organization rules with no property was not left to the owner')
    const guarded = [['PATCH', 'repos/UAMS-Web/other'], ['DELETE', 'repos/UAMS-Web/control'], ['PUT', 'repos/UAMS-Web/control/rulesets/12'], ['POST', 'repos/UAMS-Web/control/rulesets'], ['POST', 'orgs/UAMS-Web/rulesets']]
    for (const [method, path] of guarded) {
        let refused = false
        try { writeGuard('UAMS-Web/control', method, path) } catch { refused = true }
        if (!refused) failed.push(`the write guard allowed ${method} ${path}`)
    }
    try { writeGuard('UAMS-Web/control', 'PATCH', 'repos/UAMS-Web/control') } catch { failed.push('the write guard refused the repository PATCH') }
    return failed
}

function parseArgs(argv) {
    const options = { repo: undefined, apply: false, yes: false }
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--apply') options.apply = true
        else if (argv[i] === '--yes') options.yes = true
        else if (/^[\w.-]+\/[\w.-]+$/.test(argv[i]) && options.repo === undefined) options.repo = argv[i]
        else return { error: `unexpected argument ${argv[i]}` }
    }
    if (options.repo === undefined) return { error: 'name the repository as <owner>/<repo>' }
    if (options.yes && !options.apply) return { error: '--yes only answers the prompt of --apply' }
    return options
}

/** Ask on the terminal. Refuses when there is no terminal, so a pipe cannot answer for the owner. */
export function askOnTerminal(question) {
    if (!process.stdin.isTTY) return Promise.resolve(undefined)
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    return new Promise((done) => rl.question(question, (answer) => { rl.close(); done(/^y(es)?$/i.test(answer.trim())) }))
}

/** Everything the plan reads for one repository. Returns { inputs } or { error }. */
function readInputs(gh, fullName) {
    const read = readSnapshot(gh, fullName)
    if (read.error !== undefined) return { error: read.error }
    const json = (path) => {
        const result = gh([path])
        if (result.status !== 0) throw new Error(`GET ${path}: ${result.stderr.trim().split('\n')[0] || `exit ${result.status}`}`)
        return JSON.parse(result.stdout)
    }
    try {
        const listed = json(`repos/${fullName}/rulesets?per_page=100`)
        if (!Array.isArray(listed)) throw new Error(`GET repos/${fullName}/rulesets: expected a list`)
        const rulesets = listed.map((item) => (item.source_type === 'Repository' ? { ...item, ...json(`repos/${fullName}/rulesets/${item.id}`) } : item))
        const schema = gh(['orgs/UAMS-Web/properties/schema'])
        let schemaDefined
        let checksDefined
        if (schema.status === 0) {
            const parsed = JSON.parse(schema.stdout)
            if (Array.isArray(parsed)) {
                schemaDefined = parsed.some((property) => property?.property_name === RULESET_PROPERTY)
                checksDefined = parsed.some((property) => property?.property_name === CHECKS_PROPERTY)
            }
        }
        return { inputs: { snapshot: read.snapshot, fullName, rulesets, schemaDefined, checksDefined } }
    } catch (error) {
        return { error: error.message }
    }
}

/** Run the command. `gh`, `write`, `ask` and `out` are injectable so the tests never reach the network. */
export async function main(argv, { gh = ghRead, write, ask = askOnTerminal, out = (line) => console.log(line) } = {}) {
    const options = parseArgs(argv)
    if (options.error !== undefined) {
        out(`apply-addon-settings: ${options.error}`)
        return 2
    }
    const broken = controlFailures()
    if (broken.length > 0) {
        out(`apply-addon-settings: BROKEN INSTRUMENT, a control failed: ${broken.join('; ')}`)
        return 2
    }
    out(`apply-addon-settings: ${options.repo}, ${SETTINGS_ROWS.length} settings rows`)
    const first = readInputs(gh, options.repo)
    if (first.error !== undefined) {
        out(`apply-addon-settings: could not read ${options.repo}: ${first.error}`)
        return 2
    }
    const { changes, human } = buildPlan(first.inputs)
    if (changes.length === 0) out('apply-addon-settings: nothing to change')
    for (const change of changes) out(`  will ${change.say}`)
    if (!options.apply) {
        for (const line of human) out(`  left for a person: ${line}`)
        if (changes.length > 0) out('apply-addon-settings: plan only; pass --apply to make these changes (it asks first)')
        return 0
    }
    if (changes.length > 0) {
        const answer = options.yes ? true : await ask(`Apply ${changes.length} change(s) to ${options.repo}? [y/N] `)
        if (answer === undefined) {
            out('apply-addon-settings: no terminal to ask on; the owner\'s yes is needed, or pass --yes after giving it')
            return 2
        }
        if (answer !== true) {
            out('apply-addon-settings: not confirmed, nothing written')
            return 2
        }
        const send = write ?? makeWriter(options.repo)
        for (const change of changes) {
            const result = send(change.method, change.path, change.body)
            if (result.status !== 0) {
                out(`apply-addon-settings: ${change.method} ${change.path} failed: ${(result.stderr || '').trim().split('\n')[0] || `exit ${result.status}`}`)
                return 2
            }
            out(`  done: ${change.say}`)
        }
    }

    // read every change back from the API, not from what was sent
    const second = readInputs(gh, options.repo)
    if (second.error !== undefined) {
        out(`apply-addon-settings: could not read ${options.repo} back: ${second.error}`)
        return 2
    }
    let bad = 0
    for (const item of departures(second.inputs.snapshot)) {
        out(`  read back: ${item.id}: expected ${item.expected}, found ${item.found}`)
        bad++
    }
    for (const value of NEW_ADDON_CHECKS.filter((item) => !declaredRequiredChecks(second.inputs.snapshot).includes(item))) {
        out(`  read back: the ${CHECKS_PROPERTY} property does not include ${value}`)
        bad++
    }
    if (!hasOrganizationDefaultRules(second.inputs.snapshot)) {
        out('  read back: the organization default-branch rules (deletion, force push, pull request required) do not reach this repository yet')
        bad++
    }
    const required = second.inputs.snapshot.rules.filter((rule) => rule?.ruleset_source_type === 'Organization' && rule?.type === 'required_status_checks').flatMap((rule) => (rule.parameters?.required_status_checks ?? []).map((check) => check?.context))
    for (const context of NEW_ADDON_CHECKS.flatMap((value) => ATOMIC_CHECKS[value]).filter((item) => !required.includes(item))) {
        out(`  read back: no organization rule in effect requires "${context}" yet`)
        bad++
    }
    for (const line of buildPlan(second.inputs).human) out(`  left for a person: ${line}`)
    out(bad === 0 ? 'apply-addon-settings: read back clean' : `apply-addon-settings: ${bad} departures remain after the read-back`)
    return bad === 0 ? 0 : 1
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main(process.argv.slice(2))
