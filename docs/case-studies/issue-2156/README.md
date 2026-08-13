# Case study — issue #2156: a GitHub token survived sanitization and was revoked

- Issue: [link-assistant/hive-mind#2156](https://github.com/link-assistant/hive-mind/issues/2156)
- Pull request: [link-assistant/hive-mind#2157](https://github.com/link-assistant/hive-mind/pull/2157)
- Evidence source: the log attached to [link-assistant/hive-mind#2155](https://github.com/link-assistant/hive-mind/pull/2155), published as gist [`63a67ea1…`](https://gist.github.com/konard/63a67ea16390b5f0c819e3d5ca749693)
- Related previous work: #1745 (user-content carve-out), #1212 (fail-closed publication), #2119 (scratch filtering)

> **A note on what is stored here.** The leaked value is deliberately **absent**
> from this repository. It has been revoked, but committing it would re-trigger
> GitHub secret scanning against this repo — the very failure this case study is
> about. Everything under [`data/`](./data) is redacted, and every credential in
> the tests and experiments is synthetic.

## 1. Summary

A `solve` run attached its log to a pull request. The upload path published it
as a **public** gist named `…-sanitized.log.txt`. GitHub's secret scanning found
a live OAuth user access token in it and revoked the token, which broke the
Telegram bot that was using the same credential.

The token was never in the log in the form any of our scanners were looking for.
The run had probed the GitHub Container Registry, and **GHCR's token endpoint
echoes the credential it is given straight back, base64-encoded, in its JSON
response body**. So the 40-character `gho_…` appeared as 56 characters of
base64, inside a JSON document, inside a backslash-escaped JSON string, inside
an agent tool result.

Every sanitization layer we had compared bytes literally. GitHub's scanner
decodes before it matches. That difference is the whole incident.

The wider finding is that the issue's proposed remedy — add more scanner
libraries for redundancy — would not have helped on its own. A pattern scanner
matches the bytes it is handed, so a second and third scanner reading the same
surface text are blind in exactly the same way the first one is. Measured
against the real log, Secretlint's recommended preset reports **zero** findings
in all 16.9 MB (§7). The redundancy that pays off is decoding first and then
asking _both_ detectors, which is what this PR implements.

## 2. Evidence

All evidence is stored next to this document under [`data/`](./data):

| File                                                                                         | What it proves                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`data/github-secret-scanning-email.png`](./data/github-secret-scanning-email.png)           | GitHub's notification. Names the credential class: an **OAuth App User Access Token** linked to the **GitHub CLI** app, i.e. a `gho_` token, and states it was revoked. |
| [`data/gist-63a67ea1-metadata.json`](./data/gist-63a67ea1-metadata.json)                     | The gist is `"public": true`, created `2026-08-13T07:48:26Z`, one 16,973,245-byte file whose name ends in `-sanitized.log.txt`.                                         |
| [`data/redacted-incident-extract.txt`](./data/redacted-incident-extract.txt)                 | The six log lines that carried credentials, reduced to their shape, with the payloads shown only in the masked form the fixed sanitizer now produces.                   |
| [`data/library-survey-output.txt`](./data/library-survey-output.txt)                         | Every npm secret-scanning library measured against the four shapes and against the real log (§7).                                                                       |
| [`data/issue-2156.json`](./data/issue-2156.json), [`data/pr-2157.json`](./data/pr-2157.json) | The issue text and its requirements; the pull request.                                                                                                                  |

Three facts, read directly from that evidence:

1. **The log was 16.9 MB and exactly six of its 120,277 lines carried a
   credential** — and every one of those six carried it _base64-encoded inside a
   JSON `"token"` field_. Not one carried a plaintext token.
2. **The `gho_` token appears on two of those lines**, at `05:56:50.519Z`,
   preceded in the same record by the agent's own `token len 40` echo. Its
   base64 form is 56 characters — `ceil(40 / 3) × 4 = 56` — and begins `Z2h`,
   which is base64 for `gh`.
3. **The other four lines carried GHCR's own anonymous `v1:…` pull tokens**
   (base64 beginning `djE`, i.e. `v1`). Those are not our credentials, but they
   are the same leak mechanism, and they show it fired repeatedly.

## 3. Timeline

| Log line        | Time (UTC)       | Event                                                                                                                                                                                                                                        |
| --------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —               | ~05:54:19        | The agent, working on #2154 (GHCR image visibility), starts probing `ghcr.io/token` anonymously                                                                                                                                              |
| 3040 / 3050     | 05:54:32.068     | Anonymous GHCR `v1:` tokens are logged, base64-encoded in `{"token":"…"}`. **The leak mechanism fires for the first time**                                                                                                                   |
| **7519 / 7529** | **05:56:50.519** | The agent repeats the probe **authenticated**: `TOK=$(gh auth token)`, base64 into an `Authorization: Basic` header. The request header is masked correctly — but GHCR's **response** echoes the PAT back base64-encoded, and that is logged |
| 58590 / 58600   | 06:44:30.169     | More anonymous `v1:` tokens, from a batch of registry probes                                                                                                                                                                                 |
| —               | 07:48:26         | `--attach-logs` publishes the 16.9 MB log as a **public gist**, named `…-sanitized.log.txt`                                                                                                                                                  |
| —               | (minutes)        | GitHub secret scanning decodes, matches, and **revokes** the token; the Telegram bot sharing that credential stops working                                                                                                                   |
| —               | 10:28:53         | Issue #2156 is filed                                                                                                                                                                                                                         |

The probe that leaked, reconstructed from the log (the response is what matters):

```bash
TOK=$(gh auth token); echo "token len ${#TOK}"
B64=$(printf 'x:%s' "$TOK" | base64 -w0)
RESP=$(curl -sS -H "Authorization: Basic $B64" \
  "https://ghcr.io/token?scope=repository:link-assistant/formal-ai:pull&service=ghcr.io")
echo "$RESP" | head -c 200      # -> {"token":"<base64 of the PAT>"}
```

Note what the log shows about the old sanitizer: the **request** header was
already masked to `Authorization: [REDACTED]`. We were watching the door the
credential went out of, and not the one it came back through.

## 4. Requirements extracted from the issue

| #   | Requirement (from the issue text)                                                      | Where it is addressed                                                                    |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| R1  | Find the exact root cause                                                              | §5 — three root causes, each reproduced against the pre-fix tree                         |
| R2  | Protect against "any popular token formats" leaking                                    | §6 fixes 1–3; detection now runs over decoded payloads for every format both layers know |
| R3  | Use multiple similar libraries for fault tolerance, so one catches what another misses | §6 fix 4 and §7 — implemented, but **not** as the issue assumed; see the measurement     |
| R4  | Recheck the entire codebase for places that publish logs or data                       | §8                                                                                       |
| R5  | Keep first and last symbols visible for debugging                                      | §6 — the mask contract is preserved _through_ encoding; see the round-trip design        |
| R6  | Collect the best practices from previous work on this topic                            | §9                                                                                       |
| R7  | Download all logs and data into `./docs/case-studies/issue-2156`                       | [`data/`](./data) — redacted, see the note at the top                                    |
| R8  | Deep analysis: timeline, requirements, root causes, solution plans                     | §3, §4, §5, §6                                                                           |
| R9  | Check existing components/libraries that solve a similar problem                       | §7 — every npm candidate measured, with results                                          |
| R10 | Search online for additional facts                                                     | §7, §9                                                                                   |
| R11 | If data is insufficient, add debug output and verbose mode for the next iteration      | §6 fix 6                                                                                 |
| R12 | Report issues to other projects where applicable, with reproducible examples           | §10                                                                                      |
| R13 | Apply the fix to the whole codebase, everywhere the problem exists                     | §8 — every publication boundary audited; one unsanitized path found and fixed            |

## 5. Root causes

### RC1 — every layer compared bytes literally, so an encoded credential was invisible

This is the direct cause. The sanitizer had three ways to recognise a
credential, and encoding defeated all three at once:

- **Known-token masking** did `text.includes(token)` against the values read
  from `gh auth token` and `hosts.yml`. The base64 spelling shares no substring
  with the token.
- **Vendor patterns** (ours and Secretlint's) match `gho_[A-Za-z0-9]{36}`. The
  base64 form contains no `gho_`.
- **Structured-assignment rules** (`token=…`, `"token": "…"`) would have been
  the safety net — the payload _is_ a `"token"` field — but see RC2.

GitHub's scanner does the one thing ours did not: it handles encoded content.
That capability is dated and public — GitHub
[announced base64-encoded token detection on 2025-02-14](https://github.blog/changelog/2025-02-14-secret-scanning-detects-base64-encoded-github-tokens/)
covering personal access tokens, **OAuth access tokens**, and user-to-server and
server-to-server tokens, which is exactly the class that leaked here. So this
was a solved detection problem eighteen months before the incident, on the other
side of the boundary.

**The tempting shortcut does not work.** The obvious cheap fix is to match the
_encoded shape_ rather than decode. A pattern for it circulates — quoted by
Secretlint's maintainer in
[secretlint#19](https://github.com/secretlint/secretlint/issues/19#issuecomment-2660645177) —
as `/(Z2hw|Z2hv|Z2h1|Z2hz|Z2hy)Xz[A-Za-z0-9+\/]{48}={0,2}/`. Measured rather
than assumed, in
[`experiments/issue-2156-base64-token-regex-coverage.mjs`](../../../experiments/issue-2156-base64-token-regex-coverage.mjs),
it catches **10 of 186** token/alignment combinations in the incident's own
shape. Two arithmetic limits stack:

- It reads **byte alignment 0 only**, and a token embedded in a JSON body starts
  wherever the surrounding bytes put it. `{"token":"` is ten characters, so two
  of the three alignments are unreachable by construction.
- Even at alignment 0 the literal `Xz` pins the **fifth character of the token**.
  `_` is `0x5F`, so the second sextet is `0x30 | (c5 >> 4)`, which equals `z`
  only for `c5` in `0x30`–`0x3F` — the ten digits out of the sixty-two
  characters a token body is drawn from. That is 16.1% of tokens even before
  alignment is considered.

Whether this approximates GitHub's production pattern is unknown and beside the
point: it is what a maintainer would reach for, and a sanitizer built on it
would have caught roughly one leak in twenty. §6 fix 1 decodes instead, which is
indifferent to both variables.

Reproduced against the pre-fix tree in
[`experiments/issue-2156-reproduce-before-fix.mjs`](../../../experiments/issue-2156-reproduce-before-fix.mjs).

### RC2 — the structured-assignment rules could not see through escaped JSON

Agent tool results embed stdout as a JSON _string_, so the bytes on disk read
`{\"token\":\"…\"}`, with the quotes backslash-escaped. The assignment rules
accepted bare quotes only. That is not an exotic shape: it is the single most
common shape in our own logs, which means the generic `token` / `password` /
`api_key` rules were silently doing nothing across the majority of the log.

Had this rule worked, it would have masked the payload on the strength of the
key alone — no decoding needed — and the incident would not have happened. Two
independent defects had to line up.

### RC3 — line-wrapped base64 has no single-line run to match

Found while fixing RC1, and a third evasion class in its own right. Every base64
wrapper in common use folds its output — `base64(1)` and MIME at 76 columns, PEM
and `openssl` at 64 — and a folded blob contains no contiguous single-line run
for a decoder to find. Measured across wrap widths in
[`experiments/issue-2156-wrapped-base64-matrix.mjs`](../../../experiments/issue-2156-wrapped-base64-matrix.mjs).

### RC4 — one publication boundary never sanitized at all

`postKillRecoveryNotice()` assembled a pull request comment from kill
diagnostics and a resume command, wrote it to a temp file and posted it with
`gh pr comment --body-file`, without sanitizing. Every other boundary in the
codebase fails closed through `sanitizeForPublication`; this one did not.

It stayed that way because the `require-sanitized-output` ESLint rule that
guards these boundaries only understood shell strings and tagged templates. An
argv array carries no shell text, so the rule was _structurally_ blind to it —
the check that was supposed to prevent exactly this class of gap could not see
the call. Not the cause of this leak, but the same failure mode one step away.

## 6. The fix

1. **Decode, then sanitize, then re-encode** — new
   [`src/encoded-credential-detection.lib.mjs`](../../../src/encoded-credential-detection.lib.mjs).
   Bounded base64, base64url, hex, percent, byte-escape and HTML-entity runs are
   decoded, the existing plaintext rules run over the decoded text, and the
   result is re-encoded. **The round trip is verified before substitution**: a
   rebuilt run is only spliced in if decoding it returns exactly what we
   intended to publish, otherwise the whole run is redacted. That is what lets
   R5 hold _through_ an encoding — the surrounding JSON survives and the mask
   still shows the credential's first and last characters, so
   `{"token":"gho_…"}` becomes a valid base64 run decoding to `{"token":"gho…999"}`.
   Base64 is matched at all three byte alignments, so a credential embedded
   mid-blob is still found (RC1).
2. **Escape-aware quoting** in
   [`src/credential-sanitization-core.lib.mjs`](../../../src/credential-sanitization-core.lib.mjs):
   the assignment rules now match through backslash-escaped quotes, so
   `{\"token\":\"…\"}` is recognised (RC2). `findCredentialResiduals` inherits
   the encoded-aware sanitizer, so the fail-closed publication check covers
   encoded forms too.
3. **Line-wrapped blobs** (RC3): detection scans contiguous groups of
   base64-only lines and expands over the partial line the blob starts on and
   the remainder line it ends on, offering both readings as candidates and
   keeping the one that actually decodes. The stream sanitizer holds a trailing
   group of base64-only lines back until a line arrives that cannot belong to
   the blob — releasing them one at a time would hand the sanitizer
   byte-misaligned slices.
4. **Secretlint over decoded payloads** (R3). Both layers now walk the _same_
   decoder table via a shared `findDecodableRuns`, so an encoding one layer
   could decode and the other could not would be a hole exactly the width of the
   difference. Each decoded run is scanned on its own rather than as one joined
   document, so a rule matching across a join boundary cannot blame an innocent
   run. This is the redundancy the issue asked for, aimed where §7 shows it
   actually helps.
5. **The blind spot in the guard rule** (RC4): `postKillRecoveryNotice()` now
   sanitizes, and `require-sanitized-output` understands argv-array `gh`
   invocations, tracks file writers so a sanitized write marks a path safe, and
   tracks array destructuring from `Promise.all([…])`. Verified by negative
   control: reverting the one-line fix makes the rule report the file again.
6. **Diagnostics** (R11). The verbose summary reports encoded-payload detections
   separately, with the rule IDs that fired, so the next incident of this class
   is attributable from the log rather than requiring reconstruction.

Regression coverage:
[`tests/test-encoded-credential-leak-2156.mjs`](../../../tests/test-encoded-credential-leak-2156.mjs)
(the incident shapes, the stream boundary, and the backtracking bound) and
[`tests/test-encoded-secretlint-layer-2156.mjs`](../../../tests/test-encoded-secretlint-layer-2156.mjs)
(both directions of the two-layer independence).

### A performance defect found on the way

`SENSITIVE_KEY` allowed unbounded `[A-Za-z0-9_.-]` on both sides of the keyword,
so the assignment rules retried from every offset of a long unbroken run: 64 KB
took 38 s and a 553 KB blob never finished. Because publication sanitizes
_before_ it releases anything, that is a hang, not a slowdown — and logs full of
base64 are exactly where long unbroken runs come from. The affixes are now
bounded at 64 characters, which costs no coverage (pinned by test).

## 7. Library survey (R3, R9, R10)

Reproducible via
[`experiments/issue-2156-library-survey.mjs`](../../../experiments/issue-2156-library-survey.mjs);
full output in [`data/library-survey-output.txt`](./data/library-survey-output.txt).
The four shapes are the ones from the incident.

| Candidate                         | plain | base64 | base64 in escaped JSON | wrapped base64 | Verdict                                                                      |
| --------------------------------- | ----- | ------ | ---------------------- | -------------- | ---------------------------------------------------------------------------- |
| hive-mind core (after this PR)    | ✅    | ✅     | ✅                     | ✅             | —                                                                            |
| `secretlint` (recommended preset) | ✅    | ❌     | ❌                     | ❌             | **Adopted**, but applied to decoded payloads (§6 fix 4)                      |
| `@sanity-labs/secret-scan`        | ✅    | ❌     | ❌                     | ❌             | Rejected: **95,347 findings** on the incident log, in 67 s                   |
| `@visulima/secret-scanner`        | —     | —      | —                      | —              | Rejected: v0.0.1 is a placeholder — "OIDC trusted publishing setup package"  |
| `detect-secrets` (npm v1.0.6)     | —     | —      | —                      | —              | Rejected: publishes only a CLI wrapping Yelp's Python tool; no library entry |
| `redact-secrets`                  | ❌    | ❌     | ❌                     | ❌             | Rejected: last published 2016; redacts object keys, not text                 |

**The measurement that reframes the requirement.** Every usable scanner catches
the plain token and every one of them misses all three encoded spellings. Run
against the actual 16.9 MB incident log, Secretlint reports **zero** findings —
it would not have caught this leak if we had run it, and neither would a third
or a fourth scanner, because they are all matching the same undecoded bytes.

So "use multiple libraries so one catches what another misses" is sound in
principle and inert against this failure mode as stated. What differs between
detectors is _vocabulary_ (which credential formats they know), not _reach_
(which byte sequences they can see through). Redundancy of vocabulary is worth
having — Secretlint knows formats we do not, and the tests pin a case where only
it catches the credential — but it has to be applied behind the decoder, or it
adds nothing.

The false-positive column is the other half of the argument: a scanner driving a
_masking_ layer redacts every span it reports, so `@sanity-labs/secret-scan`'s
95,347 findings on one log is not a tuning inconvenience, it is a shredded log.
Precision matters as much as recall when the output is the artifact.

## 8. Codebase sweep (R4, R13)

Every path that publishes text off the machine was audited against the
fail-closed boundary:

| Path                                        | Status                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| Log upload / `--attach-logs` (gist)         | Sanitized; now encoding-aware, and the stream layer holds wrapped blobs back |
| GitHub issue / PR / comment / review bodies | Sanitized via `sanitizeForPublication`                                       |
| Kill-recovery PR comment                    | **Was unsanitized (RC4)** — fixed in `0b615eef`                              |
| Telegram messages                           | Sanitized                                                                    |
| Sentry error reports                        | Sanitized                                                                    |
| Files committed to the repository           | Sanitized                                                                    |
| GitHub Actions workflow outputs             | No credential-bearing output paths                                           |

The ESLint rule `require-sanitized-output` enforces this going forward, and now
sees argv-array invocations as well as shell strings (§6 fix 5) — the gap that
let RC4 exist is closed at the same time as RC4 itself.

## 9. Best practices carried forward (R6)

Collected from the previous work on this topic in this repository, and preserved
by this PR:

- **Fail closed.** Publication refuses rather than degrades: if sanitization
  throws, the output is replaced by `ERR_CREDENTIAL_SANITIZATION` and nothing is
  published (#1212). This PR keeps the property while adding a decoder — a
  failed re-encode round trip redacts the whole run rather than guessing.
- **Mask, do not delete.** Values over 12 characters become `abc…xyz` so a
  human can still correlate a credential across a log; shorter ones become
  `[REDACTED]` because three characters of a short secret is most of it. This PR
  extends the contract _through_ encodings (R5).
- **Sanitize at the boundary, not at the source.** One chokepoint per
  publication path, enforced by an ESLint rule, rather than trusting call sites.
- **Carve-outs are surface-level and stay that way.** The #1745 exclusion for
  user-supplied content is expressed as literal spans to leave alone, and it
  deliberately does **not** reach through the decoder: a caller's exclusion list
  must not be able to open a hole in the layer this incident proved we need.
  Over-redacting an encoded blob costs a line of log detail; the reverse costs a
  credential. Pinned by test.

External sources consulted:

- [GitHub — secret scanning partner program](https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning),
  which is why a valid `gho_` in a public gist is revoked automatically and
  within minutes.
- [GitHub changelog, 2025-02-14 — secret scanning detects base64-encoded GitHub
  tokens](https://github.blog/changelog/2025-02-14-secret-scanning-detects-base64-encoded-github-tokens/).
  The detection that revoked this credential, announced eighteen months before
  the incident and naming OAuth access tokens explicitly.
- [secretlint#19 — "Rule: decode Base64"](https://github.com/secretlint/secretlint/issues/19),
  open since 2020, including the maintainer's false-positive objection that
  shaped the round-trip design here (§10).
- The [OCI distribution auth spec](https://distribution.github.io/distribution/spec/auth/token/)
  defines the `{"token": …}` response body; GHCR's behaviour of echoing the
  supplied password back as that token is registry-specific (§10).

## 10. Upstream reports (R12)

- **Secretlint** — the recommended preset does not inspect encoded content, so a
  credential that only ever appears base64-encoded passes cleanly. Reproducible
  with [`experiments/issue-2156-secretlint-encoded-probe.mjs`](../../../experiments/issue-2156-secretlint-encoded-probe.mjs),
  which uses only the shipped preset.

  This is already tracked upstream as
  [secretlint#19, "Rule: decode Base64"](https://github.com/secretlint/secretlint/issues/19),
  open since 2020-02-11 — so the right contribution is evidence on the existing
  thread, not a duplicate report. What we can add that the thread does not have:
  a real incident where the gap cost a live credential, the measurement that the
  preset finds nothing across a 16.9 MB log of encoded payloads, the coverage
  arithmetic showing why the regex approach discussed there catches ~5% of cases
  (§5 RC1), and a working design for the alternative — decode each run, scan the
  runs separately, verify the re-encode round trip before substituting.

  The maintainer's own objection on that thread is worth recording because it is
  correct: decoded content raises false positives, since an _encrypted_ value can
  decode to something a rule matches. It is also why the fix here re-encodes and
  verifies rather than reporting on decoded text — a false positive costs a
  masked run, never a corrupted document.

- **GHCR** — echoing the supplied PAT back to the caller, base64-encoded, in a
  token response turns any client that logs HTTP responses into a credential
  leak. This is registry-specific behaviour, not required by the OCI auth spec.
  There is no public issue tracker for GHCR; the route is GitHub Support rather
  than a GitHub issue.

## 11. What would have caught this earlier

Ranked by how cheap they are, for the next time:

1. **Assume the credential is encoded.** The single highest-value change: any
   sanitizer that only does byte comparison is one `base64` call away from
   useless, and encoding happens constantly in ordinary tooling without anyone
   intending to obscure anything.
2. **Test the sanitizer against real logs, not synthetic strings.** The
   escaped-JSON gap (RC2) had been live for as long as the assignment rules
   existed and would have shown up immediately against one real tool result.
3. **Treat "the scanner found nothing" as a signal to verify, not to relax.**
   Secretlint reporting zero findings across 16.9 MB was consistent with a clean
   log and with a total blind spot; nothing distinguished them until a token was
   revoked.
4. **Make the guard rules see what the code actually does.** RC4 survived a
   dedicated ESLint rule because the rule modelled one calling convention.
