# Issue 2080: JSON Schema mistaken for a Codex capability

## Executive summary

On 2026-07-18, two attempts to solve `link-assistant/formal-ai#755` stopped before Codex started. Hive Mind v2.8.1 reported `additionalproperties:false` as a missing Agent Skill. That token was not a skill or plugin; it was the lower-cased JSON Schema keyword/value pair `additionalProperties:false` from the target issue's reproduction.

The detector used two independent tests that were individually reasonable but insufficient together:

1. the line contained a broad requirement word (`required`);
2. the token matched the lexical shape `name:name`.

It did not require the token itself to occur in skill-specific context. The previous issue #2077 fix rejected numeric prose such as `16:9`, but both halves of `additionalProperties:false` contain letters and therefore passed that syntactic filter.

This change makes discovery context-sensitive, rejects structured-data scalar pairs, distinguishes catalog-style plugin selectors from ordinary package selectors, and logs successful verification against Codex's own catalog. The real availability authority remains `codex plugin list --available --json`; a string's shape alone never proves that a plugin exists.

## Preserved evidence

All data used for the analysis is stored below this directory:

- `raw/solution-draft-1784407072279.log.txt` — the 745-line public failure log from the first gist.
- `raw/solution-draft-1784407089512.log.txt` — the 797-line extended log, including upload and PR notification events.
- `data/issue-2080.json` and `data/issue-2080-comments.json` — issue snapshot and complete comment collection.
- `data/pr-2081-*.json` — initial PR state plus all three GitHub PR feedback channels.
- `data/formal-ai-issue-755*.json` — the complete originating issue and comments.
- `data/codex-plugin-catalog.json` and `data/codex-version.txt` — output from Codex CLI 0.144.6 in the operator container. The snapshot contains 180 available entries, including `superpowers@openai-curated`, and no plugin corresponding to `additionalproperties`.
- `data/official/` — pinned primary-source snapshots from OpenAI Codex and the Agent Skills specification.

The two gist files are not byte-identical. The second contains the first failure plus 52 later lines describing sanitization, gist upload, and the failure comment.

## Timeline

| Time (UTC)          | Event                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-17 11:04    | Hive Mind's repository-scoped capability provisioning was committed for issue #2074.                                          |
| 2026-07-17 17:37    | `formal-ai#755` was opened with JSON Schema examples containing `required` and `additionalProperties:false`.                  |
| 2026-07-18 12:08    | The issue #2077 follow-up added lexical validation for numeric false positives and a non-strict warning fallback.             |
| 2026-07-18 20:36:09 | The recorded solver started with Hive Mind v2.8.1 against `formal-ai#755`. This installed release predates the #2077 release. |
| 2026-07-18 20:37:45 | Preflight reported zero plugin and one skill requirement.                                                                     |
| 2026-07-18 20:37:48 | Resolution failed with `Required Codex capability unavailable: additionalproperties:false`; Codex never started.              |
| 2026-07-18 20:38:00 | The first sanitized log was uploaded as a public gist.                                                                        |
| 2026-07-18 20:38:05 | The failure was posted to `formal-ai#755`'s prepared PR 778.                                                                  |
| 2026-07-19 11:21    | Hive Mind issue #2080 was opened from the failure.                                                                            |
| 2026-07-19          | The exact issue excerpt was converted into a failing regression test before the detector was changed.                         |

## Requirements inventory

### Functional requirements

- Determine whether a plugin name is real through a supported API or CLI, not syntax alone.
- Fix the `additionalProperties:false` false positive.
- Audit adjacent false-positive, false-negative, and error cases across the detector/resolver path.
- Preserve genuine qualified skills, bare `$skill` references, and marketplace plugin selectors.
- Apply the correction to the centralized detector so every Codex solve path receives it.
- Keep verbose evidence for rejected candidates and add positive catalog-verification diagnostics.

### Investigation and delivery requirements

- Preserve both linked logs and all issue/PR/source data under `docs/case-studies/issue-2080`.
- Reconstruct the event sequence and enumerate requirements, root causes, alternatives, and reusable upstream components.
- Search current primary sources online.
- Add a minimal automated reproduction before the implementation.
- Run focused and full checks, add a changeset, update PR 2081, merge current `main`, push only the prepared branch, and ready the PR.
- Report an upstream issue only if the fault belongs to another project.

## Root-cause analysis

### 1. Line-level intent was attributed to every token on the line

`detectRequiredCodexCapabilities` first selected any line containing words such as `required`, `use`, or `depends`. It then scanned the entire selected line for every `namespace:name` token. In this incident, `required ["file_path"]` selected the line while the unrelated token `additionalProperties:false` was accepted later on that same line.

This is a scope-association bug: the requirement word and candidate could describe different syntax fragments.

### 2. Lexical validity was confused with semantic identity

`isCapabilityName` intentionally mirrors the allowed character set for skills/plugins. That answers “could this string be a legal identifier?” It cannot answer “does this identifier name a capability?” JSON, YAML, CSS, headers, clocks, URLs, and package selectors reuse the same punctuation.

The official Agent Skills specification constrains a skill's manifest name to lowercase letters, digits, and hyphens, but does not define arbitrary colon-delimited prose as a skill reference ([Agent Skills specification](https://agentskills.io/specification)). OpenAI Codex parses plugin IDs as `<plugin>@<marketplace>` and permits ASCII letters, digits, `_`, and `-` in each segment ([Codex plugin ID implementation](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/plugin/src/plugin_id.rs)). Those are format rules, not existence checks.

### 3. Catalog validation happened too late to prevent a strict-mode abort

The resolver already compares plugin IDs with `installed + available` entries returned by `codex plugin list --available --json`, and probes actual `skills/<name>/SKILL.md` files for skill providers. This is the correct existence boundary. However, the false skill reached that boundary and was reported as a missing prerequisite. In v2.8.1 that report was fatal.

Current Codex also exposes `plugin/list`, `plugin/read`, `plugin/skill/read`, and `plugin/install` through app-server. `plugin/list` returns discovered marketplace and effective availability state ([OpenAI Codex app-server API](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/app-server/README.md#L219-L235)). Hive Mind's CLI JSON route is appropriate for the existing pre-exec process because it is stable, direct, and already supplies local source paths used to verify bundled skills.

### 4. The preceding numeric-token fix was necessarily incomplete

Issue #2077 correctly rejected tokens with no letters (`16:9`, `9:30`, `$100`, and `node@20`) and made inferred preflight failures non-fatal by default. `additionalProperties:false` evaded the first defense because it is lexically legal. The fallback in newer releases limits impact, but still produces a misleading warning and performs unnecessary catalog work. Contextual discovery is needed in addition to fail-open behavior.

## Implemented solution

Qualified skill candidates are now accepted only when their own local context is capability-specific:

- directly after a requirement operation such as `requires`, `use`, `invoke`, `install`, or `depends on`;
- directly followed by `Agent Skill`, `skill`, or `capability`; or
- explicitly invoked with `$`.

Colon pairs whose values are JSON/YAML scalar types or literals (`false`, `true`, `null`, `string`, `object`, and related values) are rejected unless an explicit skill/capability suffix or `$` invocation removes the ambiguity.

Plugin candidates are accepted when they use a marketplace-signaling selector (`bundled`, `curated`, `marketplace`, or `remote`) or are explicitly called a plugin. Thus `superpowers@openai-curated-remote` and `browser@openai-bundled` remain discoverable while `react@latest` is not invented as a Codex prerequisite. Accepted selectors are still required to match the real Codex catalog exactly during resolution.

Verbose logging now covers both sides:

- rejected tokens retain their source line;
- selected plugin providers log that they were verified in the Codex plugin catalog.

The regression suite covers the exact JSON Schema incident, JSON/YAML literals, an ordinary package selector, and genuine qualified/bare skills and catalog-style plugins. Existing #2077 and provisioning tests remain green.

## Alternatives considered

| Option                                                            | Assessment                                                                                                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add only `additionalproperties`/`false` to the prose denylist     | Too incident-specific; the next schema/config key would repeat the bug.                                                                               |
| Accept every legal token, then make all misses warnings           | Safe for execution but still noisy, misleading, and wasteful; strict mode remains unreliable.                                                         |
| Require every skill to exist before reporting it as a requirement | Useful as resolution, but cannot distinguish a genuinely requested missing marketplace from prose without retaining context.                          |
| Parse Markdown/JSON/code fences into an AST                       | More complete but substantially heavier; issues mix requirements and examples inside/outside fences, so AST position alone does not establish intent. |
| Use Codex app-server `plugin/list`                                | Authoritative and suitable for a future persistent app-server integration; unnecessary transport complexity for the current one-shot preflight.       |
| Contextual extraction plus CLI catalog/file verification          | Selected. It improves precision while preserving actionable missing-capability errors and the existing provisioning design.                           |

## False-positive and false-negative audit

| Class                                                  | Before                          | After                                                            |
| ------------------------------------------------------ | ------------------------------- | ---------------------------------------------------------------- |
| JSON Schema `additionalProperties:false`               | False skill                     | Rejected with verbose evidence                                   |
| JSON/YAML `success:false`, `value:null`, `type:string` | Possible false skill            | Rejected                                                         |
| Aspect ratios/times `16:9`, `9:30`                     | Rejected by #2077               | Still rejected                                                   |
| NPM selector `react@latest`                            | False plugin                    | Rejected as non-marketplace selector                             |
| Email/hostname and prose denylist                      | Rejected by existing boundaries | Still rejected                                                   |
| `requires superpowers:using-superpowers`               | Detected                        | Still detected                                                   |
| `superpowers:test-driven-development Agent Skill`      | Detected                        | Still detected                                                   |
| `$imagegen`                                            | Detected                        | Still detected                                                   |
| `superpowers@openai-curated-remote`                    | Detected and normalized         | Still detected, normalized, and catalog-verified                 |
| Custom `foo@corp` explicitly called a plugin           | Detected                        | Still detected; resolver determines whether `corp` is configured |

Free-form natural language is inherently ambiguous. The remaining safety net is deliberate: inferred preflight failures warn and continue by default, while `HIVE_MIND_CODEX_CAPABILITY_STRICT=1` remains available to operators who require fail-closed execution.

## External-project assessment

No upstream bug was filed. Codex supplies an authoritative catalog and validates plugin IDs as documented; Agent Skills supplies a manifest naming specification. The defect was Hive Mind's association of free-form prose with capability candidates. `formal-ai#755` only supplied the issue text that exposed it and requires no change for this failure.

## Verification plan

1. Run the new issue #2080 regression alone.
2. Run issue #2077 and the complete capability provisioning suite.
3. Run ESLint, Prettier, syntax, file-size, changeset, documentation, and duplication checks.
4. Run the complete default suite.
5. Review the branch diff against `main`, merge the latest default branch, push, and verify fresh CI runs by timestamp and SHA.
