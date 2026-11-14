// Evaluates the `mutate` job's `timeout-minutes` expression in `.github/workflows/ci.yml`
// (UAMS-Web/uams-ci-workflows#59) for a given event and caller inputs, and reads an input's declared default.
//
// The expression is the workflow's own text, not a copy: it is read out of the `mutate` job and run over a fixed
// allow-list of tokens. `&&` and `||` return an operand in a workflow expression as in JavaScript, which is all this
// expression uses besides `>` and `==`; a token outside the list throws, so a new function in the expression
// (`fromJSON`, `format`) makes the test fail loudly instead of evaluating wrongly.

const normalize = (text) => text.replace(/\r\n/g, '\n')

function jobText(text, id) {
    const lines = normalize(text).split('\n')
    const start = lines.findIndex((l) => l === `  ${id}:`)
    if (start === -1) throw new Error(`no job \`${id}\``)
    const body = []
    for (const line of lines.slice(start + 1)) {
        if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(line)) break
        body.push(line)
    }
    return body.join('\n')
}

export function timeoutExpression(text, id = 'mutate') {
    const m = jobText(text, id).match(/^ {4}timeout-minutes: \$\{\{ (.+) \}\}$/m)
    if (!m) throw new Error(`job \`${id}\` has no \`timeout-minutes\` expression`)
    return m[1]
}

const ALLOWED = /^(?:github\.event_name|inputs\.[A-Za-z0-9_-]+|'[a-z_]*'|[0-9]+|&&|\|\||==|!=|>=|<=|>|<|\(|\)|\s+)+$/

export function timeoutFor(text, event, inputs, id = 'mutate') {
    const expr = timeoutExpression(text, id)
    if (!ALLOWED.test(expr)) throw new Error(`the timeout expression uses something this evaluator does not read: ${expr}`)
    const js = expr.replace(/github\.event_name/g, 'event').replace(/inputs\.([A-Za-z0-9_-]+)/g, 'inputs["$1"]')
    return new Function('event', 'inputs', `return (${js})`)(event, inputs)
}

// The declared default of a `workflow_call` input, as a number, and its type.
export function declaredInput(text, name) {
    const m = normalize(text).match(new RegExp(`^ {6}${name}:\\n((?: {8}.*\\n)+)`, 'm'))
    if (!m) return null
    const type = m[1].match(/^ {8}type: (\S+)$/m)?.[1]
    const def = m[1].match(/^ {8}default: (\S+)$/m)?.[1]
    return { type, default: def === undefined ? undefined : Number(def) }
}
