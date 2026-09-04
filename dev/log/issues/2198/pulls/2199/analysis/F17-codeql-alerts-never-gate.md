# F17 — CodeQL's two alerts on this PR, and the 130 it is not allowed to act on

**Severity:** High · **Class:** False positive (fixed at source) + false negative (documented, out of this PR's reach)
**Status:** The PR's own two alerts retired in `be056829`; the 130 pre-existing ones inventoried, not fixed — see *Scope* below.

## Symptom

Two review comments from `github-advanced-security[bot]` on PR #2199, both
`js/incomplete-url-substring-sanitization`, both **high** severity, on
`tests/setup-buildx-resilient.test.mjs:147` and `:166`
([alert 256](https://github.com/link-assistant/hive-mind/security/code-scanning/256),
[alert 257](https://github.com/link-assistant/hive-mind/security/code-scanning/257);
payloads in [`../github/code-scanning-alerts-256-257.json`](../github/code-scanning-alerts-256-257.json)):

> `'mirror.gcr.io'` can be anywhere in the URL, and arbitrary hosts may come before or after it.

The flagged lines were assertions the F10 test made about a recorded log of
mock `docker` invocations:

```js
assert.ok(!result.calls.includes('mirror.gcr.io'), 'the mirror is not contacted when the canonical registry works');
assert.ok(result.calls.includes('mirror.gcr.io'), 'the mirror was attempted');
```

## Root cause

CodeQL is wrong about the security property and right about the code.

Wrong about the property: `result.calls` is a file the test's own mock `docker`
wrote. Nothing here parses a URL, and no access decision is made from the
result. There is no attacker and no sanitization to be incomplete.

Right about the code: a substring search was never what those lines *meant*.
"The mirror was contacted" should mean *a pull whose registry is the mirror* —
not the mirror's name appearing anywhere, in any argument, of any command, in
any order. The assertion was loose in exactly the way the query describes, and
the query has no way to know the string is a test log rather than a URL.

## Fix

Read the recorded log as structured calls and compare hosts by equality:

```js
const registryOf = ref => {
  const [head, ...rest] = ref.split('/');
  return rest.length >= 2 || head.includes('.') || head.includes(':') ? head : '';
};

const pullsFromRegistry = (log, registry) =>
  dockerCalls(log)
    .filter(call => call.command === 'pull')
    .map(call => call.args[0] ?? '')
    .filter(ref => registryOf(ref) === registry);
```

No substring test against a host survives, so both alerts go away at the source
rather than by suppression — and the assertions say what they meant.

### The tighter assertion found something the loose one could not

Rewriting `calls.includes('mirror.gcr.io')` as an exact list immediately failed:

```
the mirror was attempted
+ actual - expected
  [
+   'mirror.gcr.io/moby/buildkit:buildx-stable-1',
    'mirror.gcr.io/moby/buildkit:buildx-stable-1'
  ]
```

When both registries are down the mirror is attempted **twice** — once per
`PREPULL_ATTEMPTS`. That is correct behaviour, and no test asserted it, because
a substring search cannot distinguish one attempt from two. The retry budget is
now pinned; changing `PREPULL_ATTEMPTS` from 2 to 3 fails the test.

## The other half: nothing makes these alerts matter

While checking whether this rule fired anywhere else, the wider state came out.
`.github/workflows/security.yml:52` runs `github/codeql-action/analyze@v4` with
no severity threshold, and the action does not fail a job on findings — it
uploads them. So the `Security` workflow is green on every run, on `main`, with
this open ([`../github/code-scanning-open-alerts.json`](../github/code-scanning-open-alerts.json)):

| Rule | Severity | Open on `main` |
| --- | --- | --- |
| `js/incomplete-sanitization` | high | 46 |
| `js/incomplete-url-substring-sanitization` | high | 37 |
| `js/clear-text-logging` | high | 20 |
| `js/shell-command-injection-from-environment` | medium | 20 |
| `js/redos` | high | 3 |
| `js/functionality-from-untrusted-source` | medium | 2 |
| `js/request-forgery` | **critical** | 1 |
| `js/identity-replacement` | medium | 1 |
| **Total** | | **130** — 1 critical, 106 high, 23 medium |

A green check over 1 critical and 106 high findings is the same shape as
everything else in this issue: a signal that does not track the thing it is
named after. PRs do get told — that is how the two alerts above reached this
one — but nothing stops the count on `main` from growing.

The threshold that would gate it is **a repository setting**, not a line in the
workflow: *Settings → Code security → Code scanning → Protection rules → check
failure severity*. It cannot be changed from a pull request, and turning it on
today would fail every PR against the 130 alerts already there. Recorded here
so the decision is an informed one rather than an accident of a default.

## Scope

Fixed here: the two alerts this PR introduced. Nothing this PR added is left
flagged.

Not fixed here, deliberately: the 130 pre-existing alerts. They are findings in
application code — `src/telegram-bot.mjs`, `src/claude.lib.mjs`,
`src/github-url-parser.lib.mjs`, `src/review.mjs` and others — not in the CI/CD
pipeline this issue is about, and several (the URL-parsing ones especially) need
a security judgement per call site rather than a mechanical rewrite. Auditing
them belongs in its own issue, with the inventory above as its starting point.
