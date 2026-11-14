// Reads the `Read the PHP pin` steps out of `.github/workflows/ci.yml` (UAMS-Web/uams-ci-workflows#57).
// Every PHP job carries its own copy of the step, so the test runs the copies the workflow holds, not a retyped one.

const STEP = /^ {6}- name: Read the PHP pin\n {8}id: php\n {8}shell: bash\n {8}run: \|\n((?: {10}.*\n| *\n)+)/gm

const normalize = (text) => text.replace(/\r\n/g, '\n')

// The jobs of the workflow, keyed by id, each as its own text.
export function jobBlocks(text) {
    const lines = normalize(text).split('\n')
    const start = lines.indexOf('jobs:')
    if (start === -1) throw new Error('no `jobs:` key in the workflow')
    const blocks = {}
    let id = null
    for (const line of lines.slice(start + 1)) {
        const m = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/)
        if (m) {
            id = m[1]
            blocks[id] = []
        } else if (id !== null) {
            blocks[id].push(line)
        }
    }
    return Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, v.join('\n')]))
}

// Each copy of the step's shell, with the 10-space indent of the `run: |` block removed.
export function pinScripts(jobText) {
    return [...normalize(jobText).matchAll(STEP)].map((m) =>
        m[1]
            .split('\n')
            .map((l) => l.replace(/^ {10}/, ''))
            .join('\n')
            .trimEnd() + '\n',
    )
}

// Findings, one string each: a job that reads `steps.php.outputs` without a pin step, and copies that differ.
export function pinFindings(text) {
    const findings = []
    const copies = new Map()
    for (const [id, job] of Object.entries(jobBlocks(text))) {
        const scripts = pinScripts(job)
        for (const s of scripts) copies.set(s, [...(copies.get(s) ?? []), id])
        if (job.includes('steps.php.outputs') && scripts.length === 0) {
            findings.push(`job \`${id}\` reads \`steps.php.outputs\` and has no \`Read the PHP pin\` step`)
        }
    }
    if (copies.size > 1) {
        const groups = [...copies.values()].map((ids) => ids.join(', '))
        findings.push(`the \`Read the PHP pin\` step is not the same in every job: ${groups.join(' | ')}`)
    }
    return findings
}
