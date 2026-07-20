# Requirements — issue #2092

Every requirement stated in the issue body, with its status in PR #2093.

| #   | Requirement (from the issue)                                                                             | Status | Where                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| R1  | Download all logs and data related to the issue into this repository                                        | ✅ done | `data/` (issue JSON + comments, `use-m@8.14.2` bundle), `raw/` (run 2 log, experiment logs) |
| R2  | Compile that data into `./docs/case-studies/issue-2092`                                                     | ✅ done | this directory                                                                          |
| R3  | Deep case-study analysis, including facts found online                                                      | ✅ done | `analysis.md`, `research.md` (upstream source, use-m issues #40/#52/#53, npm registry metadata) |
| R4  | Reconstruct the timeline/sequence of events                                                                 | ✅ done | `timeline.md` — both runs, plus the #1710→#1712→#2092 lineage                            |
| R5  | List each and every requirement from the issue                                                              | ✅ done | this file                                                                               |
| R6  | Find the root cause of each problem                                                                         | ✅ done | `analysis.md` RC1–RC5                                                                   |
| R7  | Propose possible solutions and solution plans for each requirement                                          | ✅ done | `analysis.md` ("Why not the alternatives") and "Follow-ups" below                        |
| R8  | Check existing components/libraries that solve a similar problem or can help                                | ✅ done | `research.md` — `p-retry`/`async-retry` (circular), npm `fetch-retries`, in-repo prior art |
| R9  | If there is not enough data to find the actual root cause, add debug output and a verbose mode              | ✅ done | `HIVE_MIND_USE_M_DEBUG` per-attempt loader logging; `formatFatalError` cause chains and `HIVE_MIND_VERBOSE` stacks — and the root cause *was* found, with a reproduction |
| R10 | Report issues to related projects, with reproducible examples, workarounds, and code-level fix suggestions  | ✅ done | [link-foundation/use-m#66](https://github.com/link-foundation/use-m/issues/66) + [follow-up comment](https://github.com/link-foundation/use-m/issues/66#issuecomment-5022434010) on the ESM-cache finding |
| R11 | Apply the requirements to the **entire** codebase — fix every affected place, not just one                  | ✅ done | Fixed at the single bootstrap (`ensureUseM`), which is the only producer of `globalThis.use`; all 100 `use(...)` calls across 46 files inherit it. Sweep evidence below. |
| R12 | Plan and execute everything in this single pull request                                                     | ✅ done | PR #2093                                                                                |

## Codebase sweep for R11

| Check                                                          | Result                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Places that evaluate the use-m bootstrap bundle                 | 1 — `src/use-m-bootstrap.lib.mjs` (`grep -rn "unpkg.com/use-m" src scripts`)  |
| Places that assign `globalThis.use`                             | all route through `ensureUseM()`                                              |
| Raw `await use(...)` call sites now covered                     | 100 calls in 46 files                                                         |
| Entry points that collapsed fatal errors to `.message`          | `src/fix.mjs`, `src/cleanup.mjs` — both now use `formatFatalError`            |

`src/start-screen.mjs` and `src/telegram-bot.mjs` already logged the full error
object, so they were left alone.

## Follow-ups (not required to close this issue)

| Idea                                                                          | Value                                                                  |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Pre-install `command-stream` into `Dockerfile.dind` under the use-m alias name | Removes the registry round-trip from the container's first seconds      |
| Vendor `command-stream` as a regular dependency                                | Removes runtime resolution for the hottest package entirely             |
| Set `fetch-retries` / `fetch-retry-maxtimeout` in the image `.npmrc`           | Cheap defence in depth for RC2                                          |
| Upstream fixes land in `use-m`                                                 | Would let the wrapper shrink to a thin safety net                       |
