# Root-cause and solution analysis — issue 2077

## The reported symptom is a misreading, not a missing plugin

The issue title reads as a dependency problem:

> Required Codex capability unavailable: **16:9**. Run `codex plugin list --available --json` in the operator container and configure a marketplace that provides it.

and the issue body concludes:

> We need to find a way to install that codex requested plugin in docker of the task, but not globally.

That conclusion does not survive contact with the evidence. **`16:9` is not a
Codex plugin, and no marketplace could ever provide it.** It is the aspect ratio
of the images the target issue asked for. The correct fix is not to find a way to
install `16:9`; it is to stop Hive Mind from claiming that `16:9` was requested.

The remediation text in the error message is itself misleading — it instructs the
operator to configure a marketplace for a capability that does not exist. An
operator following that instruction literally would have burned time searching a
marketplace catalog for an aspect ratio.

## Root cause 1 — capability detection has no name validation

`src/codex-capability-preflight.lib.mjs` scans issue prose line by line. A line
is considered a requirement statement if it contains any of the words
`depend(s|ency)`, `install`, `invoke`, `mandatory`, `must`, `need(ed|s)`,
`preflight`, `required?`, `requires`, `use`. Inside such a line, three regexes
extract capability names. The relevant one was:

```js
const NAMESPACED_SKILL = /\b([a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*)\b/gi;
```

The character class `[a-z0-9]` accepts a leading digit. Therefore any
`digits:digits` token is a syntactically valid "namespaced skill".

The triggering line is the `hero` image prompt in
`suenot/marketmaker-images#81`:

> **hero** — A premium dark abstract contrasting a slippage constant with a slippage curve. […] An order sliding along the curve pays a cost that clearly **depends** on where it sits. Deep navy-to-black, glassmorphism, glowing particles, depth of field, subtle grid. **16:9**. No text.

Both gates pass for entirely accidental reasons:

- the requirement gate matches `depends`, used here in its ordinary English sense
  ("cost depends on size"), nothing to do with software dependencies;
- the name regex matches `16:9`, the aspect ratio.

This is reproducible from the live issue text:

```
$ node -e '…detectRequiredCodexCapabilities(issue81Text)'
{"plugins":[],"skills":["16:9"]}
```

which matches the log exactly: `detected 0 plugin and 1 skill requirement(s)`.

`resolveRequiredPlugins` then splits `16:9` into namespace `16` and name `9`,
finds no catalog plugin named `16`, finds no `skills/9/SKILL.md` anywhere, and
throws.

### The defect class is wider than one token

`16:9` is one instance of a general problem: the extraction regexes accept
strings that cannot be capability names. Every one of the following is a live
false positive against the pre-fix code, and each would have aborted a run the
same way:

| Prose                                 | Extracted as           | Real meaning     |
| ------------------------------------- | ---------------------- | ---------------- |
| `Target 1664x936 (exact 16:9)`        | skill `16:9`           | aspect ratio     |
| `The deploy must finish by 9:30`      | skill `9:30`           | clock time       |
| `must listen on localhost:3000`       | skill `localhost:3000` | host and port    |
| `Install node@20`                     | plugin `node@20`       | version selector |
| `You need to pay $100`                | skill `100`            | currency amount  |
| `Contact ops@example.com if required` | plugin `ops@example`   | email address    |

The unifying property: **Codex plugin, marketplace and Agent Skill names are
lowercase kebab-case identifiers that begin with a letter.** None of the tokens
above satisfy that shape. The pre-fix code never checked it.

## Root cause 2 — a heuristic guess was made fatal

The second, more serious defect is architectural rather than textual.

Requirements are _inferred_ from free-form English written by people who have no
idea Hive Mind is parsing their prose for dependency declarations. Inference of
that kind is necessarily imperfect. Yet a failed inference was wired to an
unconditional `throw` that propagated uncaught through `executeCodex`
(`codex.lib.mjs:748`) to `solve.mjs:789` and terminated the process.

The consequence is disproportionate. Per the timeline, the abort happened
_after_ the container had started, the fork had been validated, the repository
had been cloned, the prompt had been assembled, and **draft PR #88 had already
been opened on a third-party repository**. A false positive on an aspect ratio
destroyed a run that was otherwise entirely healthy and left an empty draft PR
behind on someone else's repo.

Note the asymmetry that makes fail-fast the wrong default here:

- If the preflight wrongly _skips_ a genuinely required plugin, Codex starts and
  either finds the capability through the operator's own configuration or
  reports a real, specific error from the actual task.
- If the preflight wrongly _demands_ a nonexistent capability, nothing runs at
  all and the operator is sent to search a marketplace for an aspect ratio.

The same fatal path also covered failures unrelated to detection accuracy —
`prepareScopedCodexHome` throws if the operator marketplace snapshot is absent,
which would likewise abort every Codex run whose issue text merely _mentions_ a
skill-shaped token.

## What was _not_ the cause

Ruled out from the log, so that this is not re-investigated later:

- **Resources.** 6 CPUs, 9.9 GB memory free, 149.5 GB disk free at the abort.
- **Authentication / GitHub access.** Fork mode negotiated correctly; PR #88 was
  created successfully seconds before the failure.
- **Playwright MCP.** Probed and reported connected (log lines 61-66).
- **Codex itself.** No `codex exec` was ever launched. No Codex command failed;
  the catalog query was never even reached for a real capability.
- **The target repository.** `suenot/marketmaker-images#81` is a well-formed
  image-generation request. It declares no Codex dependency of any kind.
- **Docker isolation and plugin scoping.** The repository-scoped `CODEX_HOME`
  mechanism built for issue #2074 was never exercised, because resolution failed
  before provisioning. The scoping mechanism is not implicated in this failure.

## Fixes applied

### Fix 1 — validate capability names (`detectRequiredCodexCapabilities`)

A shared `isCapabilityName` predicate now gates every extraction:

```js
const CAPABILITY_TOKEN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
```

applied to bare names and to _both halves_ of a qualified `name:skill` or
`plugin@marketplace` reference. A token must start with a letter, so every row in
the false-positive table above is rejected. A `PROSE_TOKENS` blocklist
additionally drops markdown and prose noise (`note:`, `warning:`, `see:`, `$path`,
`$home`, …), subsuming the previous ad-hoc `['agent','codex','required','the']`
list. The plugin selector regex gained `(?!\.[a-z])` so email addresses and
hostnames stop matching.

Genuine references are unaffected: `superpowers:using-superpowers` and
`superpowers@openai-curated-remote` still resolve, and the issue #2074 regression
suite passes unchanged.

### Fix 2 — degrade instead of aborting (`runCodexCapabilityPreflight`)

`runCodexCapabilityPreflight` now wraps provisioning and converts any
`CodexCapabilityPreflightError` into a warning, returning
`{ required: false, degraded: true, error }` so the run proceeds with the
operator's own Codex capabilities:

```
⚠️  Codex capability preflight skipped: Required Codex capability unavailable: …
   Continuing with the operator Codex capabilities. Set HIVE_MIND_CODEX_CAPABILITY_STRICT=1 to fail instead.
```

`resolveRequiredPlugins` still throws — the actionable-diagnostic contract from
issue #2074 is preserved at the unit level, and operators who want the old
fail-fast behaviour set `HIVE_MIND_CODEX_CAPABILITY_STRICT=1`. This is the
defence-in-depth layer: even a false positive that slips past Fix 1 can no longer
destroy a run.

### Fix 3 — explain detections under `--verbose`

The detector now returns `evidence` and `rejected` arrays pairing each
accepted/rejected token with its source line, and the preflight logs them under
`--verbose`:

```
🔌 Codex capability preflight: detected 0 plugin and 1 skill requirement(s)
   🔎 'superpowers:using-superpowers' detected from: This task requires superpowers…
   ⏭️  Ignored non-capability token '16:9' from: **hero** — A premium dark abstract…
```

The original run used `--verbose` and still could not show _why_ `16:9` was
believed to be a skill — it reported only a count and then the consequence.
Diagnosing this required re-deriving the detection by hand. That gap is closed.

## Residual risk

Detection remains a heuristic over English prose, and Fix 1 raises precision
without reaching certainty. A phrase such as "you must use the `data:import`
endpoint" is still shaped exactly like a namespaced skill reference. Fix 2 is
what makes that acceptable: the worst case is now a skipped provisioning step and
a warning, not a destroyed run. The durable improvement would be an explicit,
structured declaration (see `research.md`) rather than better prose guessing.
