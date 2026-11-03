# Case study: issue-created Formal AI drafts ran the stale backend baked into the Hive Mind image (issue #3909)

Issue: [link-assistant/hive-mind#3909](https://github.com/link-assistant/hive-mind/issues/3909), "[Bug][P0] Issue-created Formal AI drafts use the stale backend baked into Hive's image". It is the Hive Mind half of [link-assistant/formal-ai#1484](https://github.com/link-assistant/formal-ai/issues/1484), which owns acceptance across both repositories. Build and layer reuse is [link-assistant/formal-ai#1486](https://github.com/link-assistant/formal-ai/issues/1486).

## Collected data

Everything is in [`raw/`](raw/):

| File                          | Content                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `issue-3909.json`             | The issue as it was when the fix was made                                                                         |
| `run-41081977243-excerpt.log` | The lines of the reproduction run that show the image it pulled and the Formal AI version that served the draft   |
| `select-live-2026-11-02.txt`  | The new admission run against live GitHub in all three modes (`experiments/issue-3909/select-live.mjs`)           |
| `run-41547700367-excerpt.log` | The hosted attempt of this branch: selection, fresh build and receipt, artifact digests and the preflight outcome |

## Timeline

| When (UTC)       | What                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-30 04:10 | [Formal AI v0.355.23](https://github.com/link-assistant/formal-ai/releases/tag/v0.355.23) is published.                                                                                                                                                                  |
| 2026-10-30 15:34 | [Run 41081977243](https://github.com/link-assistant/hive-mind/actions/runs/41081977243) starts a draft for an issue on Hive Mind `279ac056` (2.39.9). It pulls `konard/hive-mind:2.39.9`, whose Dockerfile pins `FORMAL_AI_VERSION=0.355.15`.                            |
| 2026-10-30 15:41 | The draft reports `Formal AI wrapper version: 0.355.15` and `serving backend 0.355.15`. That is eight patch releases behind the published release.                                                                                                                       |
| 2026-11-02       | The fix is made. The problem has come back: the Dockerfile now pins `0.355.27`, Formal AI `main` is at `0.355.29`, and the `v0.355.29` release was built from `658cd102`, an older commit than `main`. A version bump in the Dockerfile only ever moves the stale point. |

## Root cause

The draft ran whatever Formal AI binary the Hive Mind image happened to contain. Three defects combined to cause this:

1. **Nothing selected a Formal AI source.** `scripts/formal-ai-draft.mjs` replaced the baked binary only when a caller supplied one. Formal AI's own issue workflow does supply one, so drafts opened from Formal AI issues were current. Hive Mind's own issue path had no such selection, so it always used the `cargo install formal-ai --version "${FORMAL_AI_VERSION}"` layer of the image. That layer is as old as the last Dockerfile bump.
2. **The image could fall back.** `scripts/formal-ai-draft-image.lib.mjs` tried `konard/hive-mind:<version>` and then `latest`. So even the Hive Mind side of an attempt was not tied to the source being tested.
3. **Version equality was treated as identity.** Formal AI can carry one version across several commits. In the example above, `v0.355.29` and `main` share `0.355.29` but differ in `rust/src`. Even a fixed "use the release of the same version" rule would have run code other than `main`.

The serving-version probe from #2207 and #2208 was already logging the version that actually served the draft. It reported the stale version correctly; nothing acted on it. So this was a runtime-selection defect, not missing logging.

## Solution

The draft workflow is now three jobs. They are tied together by one immutable **attempt identity**, implemented in `scripts/formal-ai-draft-identity.lib.mjs`:

| Job      | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `select` | Runs once at admission (`scripts/formal-ai-draft-select.lib.mjs`). It resolves Formal AI `main` to a commit SHA and reads its `rust/Cargo.toml` version. It reuses a release only when that release's native receipt names this exact commit; otherwise the binary is built. It also records the checked-out Hive Mind commit, its version and the exact image `konard/hive-mind:<version>`. The identity id is a hash of all of these.                                    |
| `binary` | Downloads the matching release, or builds the selected commit with `cargo build --locked` in a fresh job. Either way it writes the same native receipt and verifies it against the identity. The binary is passed to the draft job as an artifact of this run, through the existing caller-binary mount.                                                                                                                                                                   |
| `draft`  | Runs the preflight (`scripts/formal-ai-draft-preflight.lib.mjs`) before solve. It checks the binary digest, then pulls the exact image tag (no other tag) and pins it by `RepoDigest`. It checks that the image's OCI revision label belongs to the selected Hive Mind source. Finally it starts a real `formal-ai serve` in that image and hashes `/proc/<pid>/exe`. Solve then re-checks its own server against the identity (`src/formal-ai-attempt-identity.lib.mjs`). |

Any missing piece is a **deferred** outcome, annotated "Formal AI draft deferred" and kept with its evidence. Any wrong piece is an **identity mismatch**. Neither one falls back to another binary, an older image or `latest`. The health report counts deferred attempts as executed attempts, so a run of them is reported as a streak.

The three modes are kept apart. `live-current` is the default for issue-created drafts and always runs the `main` head. `published-release` qualifies a release by the commit its receipt names and is labelled `formal-ai-release-qualification`. `historical-replay` runs a pinned ref, or the image-baked binary only when no ref is given, and is labelled `formal-ai-historical-replay` and "not current-source evidence".

"Re-run failed jobs" reuses the `select` outputs, so a retry keeps the same identity. A new dispatch picks up a new source and therefore gets a new identity. A dispatch can replay a recorded identity through `attempt_identity`.

### Security review of the build

CodeQL flagged the first version of the `binary` job with `actions/cache-poisoning/poisonable-step` (alerts 314 and 315). That version restored and saved the build through `actions/cache`. A historical-replay ref can name any commit GitHub resolves in the Formal AI network, including a fork's pull request commit. Building such a commit and saving it to a cache that later attempts trust would let that commit poison them. The fix has two parts:

- The build no longer uses `actions/cache`. Every attempt that needs a build builds the selected commit fresh. Making that reuse fast and safe is formal-ai#1486's latency work. Freshness does not depend on it, as the issue requires.
- A pinned replay ref must be reachable from Formal AI `main`. The check is GitHub compare `<sha>...main`, which must be `identical` or `ahead`. Anything else is an identity mismatch.

Even after both changes, CodeQL raised the alert again (316). The query does not look at whether a cache is used, since any non-privileged job's runtime token can write cache entries. It also does not look at where a checkout ref comes from: it treats every `actions/checkout` ref whose name contains `sha`, `head` or `commit` as a pull request head. The code the `binary` job runs is trusted by construction:

- the Hive Mind revision is the commit the workflow itself runs, or a caller's pinned commit in the caller's cache scope;
- the Formal AI revision is the `main` head, a release's source (downloaded, not built), or a replay checked to be reachable from `main`.

The select outputs were therefore renamed `hive_revision` and `formal_ai_revision`. The workflow comment above the job explains why, so a reviewer can check the reasoning rather than the name.

## Evidence

The new admission was run against live GitHub on 2026-11-02 (`raw/select-live-2026-11-02.txt`). Formal AI `main` moved during the work, and each run selected the new head with a new identity:

```text
Hive Mind 2.39.11 at ab8db017…; its image konard/hive-mind:2.39.11 bakes Formal AI 0.355.27

live-current: live current-source attempt 61dd525d…: link-assistant/formal-ai@94e26f09a4b6 (0.355.29) via build, …
  drift: the image-baked binary (0.355.27) is not what this attempt runs (0.355.29)
published-release: published-release qualification ce2868dd…: link-assistant/formal-ai@658cd102a547 (0.355.29) via release, …
historical-replay: HISTORICAL REPLAY (not current-source evidence) 02f0c56b…: the image-baked Formal AI via image-baked, …
```

The same selection ran hosted in [run 41547700367](https://github.com/link-assistant/hive-mind/actions/runs/41547700367), a `preflight_only` dispatch of this branch for issue #3909 (`raw/run-41547700367-excerpt.log`):

1. `select` admitted live-current attempt `61dd525d…`, the same identity as the local run.
2. `binary` built `link-assistant/formal-ai@94e26f09` fresh with `cargo build --locked` in 4m 54s. It recorded the receipt and verified binary `sha256 8a6bc8ea…` (0.355.29) against the identity. The artifact uploaded as `7fb8ff54…` was downloaded by `draft` with the same digest.
3. The `draft` preflight verified the binary digest. It then pulled exactly `konard/hive-mind:2.39.11` and found that the image was built from `d0e8a610`, which does not contain this branch's `src/formal-ai-attempt-identity.lib.mjs` and `src/formal-ai-runtime.lib.mjs`. The attempt ended `deferred-infrastructure` with that evidence, before solve and without trying another image or `latest`. This is the expected outcome for an unreleased Hive Mind source; see the first remaining item below.

An earlier run, at Formal AI `main` `6764c142`, produced live-current identity `cbe22ef0…`. Advancing Formal AI produced a new source and a new identity, with no Hive Mind image rebuild. `live-current` builds `main` because the `v0.355.29` release of the same version was built from `658cd102`. The identity records that release as `releaseCandidate` and does not run it.

The fast tests in `tests/formal-ai-draft-identity-3909.test.mjs` cover:

- drift;
- a same-version, different-commit mismatch;
- tampered receipts and binaries;
- missing releases, binaries and images (deferred, never `latest`);
- image binding by revision and digest;
- the serving probe;
- preflight order;
- retry and replay identity;
- mode labelling;
- the replay reachability check;
- the health streak of deferred outcomes;
- the workflow wiring, including the absence of `actions/cache`.

## Remaining cross-repository work

- An issue-created attempt on a pull request branch is correctly deferred whenever the branch's Hive Mind source has no published image yet. The image `konard/hive-mind:<version>` is published only after a release. So the hosted `live-current` contract can be demonstrated end to end only after this change is merged and released.
- Formal AI's issue workflow (`hive-mind-draft.yml`) already mounts its own binary through `FORMAL_AI_DRAFT_BINARY` and runs `scripts/formal-ai-draft.mjs` from the Hive Mind commit it checked out. That path is admitted unchanged as a `caller` attempt bound to the binary digest. Setting `FORMAL_AI_DRAFT_SOURCE_SHA` to the commit it built (the `formal_ai_source_sha` input when the reusable workflow is called) binds it to that commit as well. That change belongs to Formal AI and is tracked on formal-ai#1484, where the links to the hosted attempts in both repositories go.
