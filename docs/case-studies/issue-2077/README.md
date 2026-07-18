# Issue 2077: `Required Codex capability unavailable: 16:9`

## Executive summary

**`16:9` is not a Codex plugin.** It is the aspect ratio requested by the target
issue, `suenot/marketmaker-images#81`, which asked for five 1664×936 images.

Hive Mind's Codex capability preflight scans issue prose for dependency
declarations. In the prompt line

> "… An order sliding along the curve pays a cost that clearly **depends** on
> where it sits. … **16:9**. No text."

the word `depends` satisfied the requirement-word gate and the token `16:9`
matched a namespaced-skill regex whose character class permitted a leading digit.
No plugin provides a skill named `9`, so the preflight threw
`CodexCapabilityPreflightError` and terminated the run — _after_ the container had
started, the fork had been validated and draft PR #88 had already been opened on
a third-party repository.

The issue's proposed direction — "find a way to install that codex requested
plugin in docker of the task, but not globally" — rests on a false premise. There
is no plugin to install. Per-task, non-global plugin scoping already exists: it
was built for issue #2074 and installs into
`$CODEX_HOME/hive-mind/repositories/<owner>/<repo>`. That mechanism was never
reached in this run and is not implicated in the failure.

## Evidence index

- [Incident timeline](timeline.md) — reconstructed sequence of events
- [Root-cause and solution analysis](analysis.md) — both defects, false-positive
  taxonomy, ruled-out causes, fixes
- [Requirements traceability](requirements.md) — every requirement in the issue
  and where it is discharged
- [Online and component research](research.md) — Codex plugin scoping facts and
  prior art for requirement extraction
- [Raw run log](logs/isolation-docker-5ad4b2f9.log) — 487 lines, the complete
  captured transcript from the linked gist
- [Raw Hive Mind issue export](data/issue-2077.json)
- [Raw target issue export](data/original-issue-81.json) — the image-generation
  issue whose prose triggered the failure

## Root causes

1. **No capability-name validation.** Extraction regexes accepted any
   `digits:digits` token. Codex plugin, marketplace and skill names are
   lowercase kebab-case identifiers that begin with a letter; that shape was
   never checked. `16:9` is one of a family of false positives that also includes
   clock times, host ports, version selectors, currency amounts and email
   addresses.
2. **A heuristic guess was fatal.** Requirements are _inferred_ from English
   written by people unaware their prose is being parsed. A failed inference
   threw an uncaught error that aborted the entire run, which is disproportionate
   — and asymmetric, since a wrongly skipped plugin merely defers to a real error
   from the actual task, while a wrongly demanded one stops all work.

## Changes

| Change                                                                                            | File                                                        |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `isCapabilityName` shape validation, prose-token blocklist, email/hostname exclusion              | `src/codex-capability-preflight.lib.mjs`                    |
| Preflight failures degrade to a warning; `HIVE_MIND_CODEX_CAPABILITY_STRICT=1` restores fail-fast | `src/codex-capability-preflight.lib.mjs`                    |
| `evidence` / `rejected` detection traces logged under `--verbose`                                 | `src/codex-capability-preflight.lib.mjs`                    |
| Regression test reproducing the exact `16:9` line plus the sibling false-positive classes         | `tests/test-issue-2077-codex-capability-false-positive.mjs` |
| Return-shape update for the extended detector result                                              | `tests/codex-capability-preflight.test.mjs`                 |

## Verification

`tests/test-issue-2077-codex-capability-false-positive.mjs` asserts that the
verbatim `hero` prompt line from `suenot/marketmaker-images#81` yields zero
requirements, that six sibling prose classes yield zero requirements, that
genuine `superpowers:*` references still resolve, that an unresolvable
requirement degrades to a warning instead of throwing, and that strict mode still
throws. The issue #2074 suite passes unchanged, confirming no capability of the
original preflight was removed.

Confirmed against the live issue text after the fix:

```
plugins: [] skills: [] rejected: [ '16:9' ]
```

## Upstream reporting

No upstream issue is warranted. Both defects are entirely within this repository:
the regex, the missing validation and the fatal error path are all Hive Mind
code. The Codex CLI, its marketplace, the container image and the target
repository all behaved correctly throughout — see the "What was _not_ the cause"
section of [analysis.md](analysis.md).
