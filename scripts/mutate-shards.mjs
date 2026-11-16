// Reads the `Plan the shards` step out of `.github/workflows/ci.yml` (UAMS-Web/uams-ci-workflows#62), so the test runs
// the step the workflow holds and not a retyped copy. The `mutate-plan` job carries it once.

import { jobBlocks } from './php-pin.mjs'

const STEP = /^ {6}- name: Plan the shards\n {8}id: plan\n {8}env:\n(?: {10}.*\n)+ {8}run: \|\n((?: {10}.*\n| *\n)+)/m

// The step's shell, with the 10-space indent of the `run: |` block removed, or null when the workflow has no such step.
export function planScript(workflowText) {
    const job = jobBlocks(workflowText)['mutate-plan']
    if (job === undefined) return null
    const m = job.replace(/\r\n/g, '\n').match(STEP)
    if (m === null) return null
    return (
        m[1]
            .split('\n')
            .map((l) => l.replace(/^ {10}/, ''))
            .join('\n')
            .trimEnd() + '\n'
    )
}

const SELECT = /^ {6}- name: Select the files to mutate\n {8}id: select\n {8}env:\n(?: {10}.*\n)+ {8}run: \|\n((?: {10}.*\n| *\n)+)/m

// The `Select the files to mutate` step's shell, from the `mutate` job, or null when the workflow has no such step.
export function selectScript(workflowText) {
    const job = jobBlocks(workflowText).mutate
    if (job === undefined) return null
    const m = job.replace(/\r\n/g, '\n').match(SELECT)
    if (m === null) return null
    return (
        m[1]
            .split('\n')
            .map((l) => l.replace(/^ {10}/, ''))
            .join('\n')
            .trimEnd() + '\n'
    )
}
