# Decision log

The canonical record of why the project is the way it is: the reasoning and the rejected alternatives behind decisions that have closed. It guards against silently reopening a settled decision.

**Consult it before acting.** Before proposing a change, reopening a question or picking an approach, check here first. The path under consideration may already be a decided-and-recorded one, or an explicitly rejected one. If it is, follow the record, or make the case to revisit it.

**When a decision closes, record the verdict in both places.** Capture the what, the why and the rejected alternatives here (the cross-ticket index) and in the GitHub issue's `## Decision` section (the per-ticket record), keeping the two consistent. Put the full reasoning in the relevant `docs/` companion when the decision touches a documented area. The issue tracker stays the system of record for a single ticket's status.

## How to add an entry

Entries run oldest first, one per closed decision, so a new entry is appended to the end of the file. Keep it terse; the companion or the issue carries the depth.

Every entry heading is `## YYYY-MM-DD`, a space, and a short title. Leave exactly one blank line above each heading. The check (`decision-log` skill) fails on a heading dated earlier than the one before it, and on a heading that sits directly under the previous line.

```markdown
## YYYY-MM-DD <short decision title> (<#issue or area>)

**Decision.** <what was decided, in a sentence or two>

**Why.** <the reasoning that settled it>

**Rejected.** <the alternatives considered, and why each lost>

**Companion.** <link to the docs/ companion or the GitHub issue holding the full reasoning>
```

## 2026-11-14 Publish `guard` and `dev-lint` as an additive port, not the template wholesale (#55)

**Decision.** `.github/workflows/ci.yml` gains the `guard` and `dev-lint` jobs, their four inputs (`guard`, `guard-patterns`, `dev-lint`, `dev-lint-exclude`), and their entries in the `result` job's `needs:` and switched-off list. The `mutate-ignore` input (#40, #48) and the per-job PHP pin reading (#30) stay as published. The template in `UAMS-Web/uams-claude-skills` is brought to match through UAMS-Web/uams-claude-skills#752, not the other way round.

**Why.** The template and the published file differ by 610 lines in both directions, so a byte-for-byte copy of the template would remove the published `mutate-ignore` input (a caller passing it would fail at startup) and swap in a separate `php-version` job nobody here has reviewed. The port is additive: no published input or job changes, so it ships as a minor release.

**Rejected.** Publishing the template wholesale: it drops `mutate-ignore` and brings the `php-version` restructure unreviewed. Adding `mutate-ignore` to the template first, then publishing it wholesale: byte-identical at once, but it waits on a change in another repository and still takes the restructure. The identical-copy criterion on #55 is therefore met after #752, not by this change.

**Companion.** UAMS-Web/uams-ci-workflows#55 and UAMS-Web/uams-claude-skills#752.
