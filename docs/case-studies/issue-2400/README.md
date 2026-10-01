# Case study: issue #2400 — "Error running gh-upload-log: Credential sanitization failed; publication was blocked."

- Issue: https://github.com/link-assistant/hive-mind/issues/2400
- Pull request: https://github.com/link-assistant/hive-mind/pull/2401
- Affected run: the session that prepared https://github.com/link-assistant/hive-mind/pull/2398
  (issue #2397), Docker isolation, image `konard/hive-mind-dind:2.33.2`
- Related: #2397 / PR #2398, which this PR builds on. PR #2398's branch is merged into this one.

## Summary

The session that prepared PR #2398 finished successfully (exit 0) but published nothing
it had produced at the end:

1. The working session summary was blocked by the publication sanitizer.
2. The refresh of the PR description's Changes section was blocked by the publication sanitizer.
3. The 8 MB solution log was blocked: `❌ Error running gh-upload-log: Credential sanitization failed; publication was blocked.`
4. Two **byte-identical** "⚠️ Solution Draft Log: Log Upload Failed" comments were posted
   ([#issuecomment-5934184600](https://github.com/link-assistant/hive-mind/pull/2398#issuecomment-5934184600)
   and [#issuecomment-5934233622](https://github.com/link-assistant/hive-mind/pull/2398#issuecomment-5934233622)).
5. Both comments said the log was "kept on the machine that ran this session" at
   `/home/box/12973819-edf2-46a1-9507-73725ece23dd.log`. That file never existed on the host
   (`ls` → "No such file or directory"). It was inside the isolated Docker container,
   which start-command removed six seconds after the second comment, because the command exited 0.
6. Published code excerpts contained over-masked code such as
   `const fileTokens = [REDACTED] getGitHubTokensFromFiles();`. The masked word was `await`, not a secret.

| #   | Problem                                                                        | Status         | Fix                                                                             | Test                                                          |
| --- | ------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| RC1 | Summary and PR description blocked (`token => !token`, non-idempotent masking) | Fixed in #2398 | Separator fix plus fixed-point sanitizer (#2398 RC4)                            | `tests/issue-2397-sanitizer-idempotency.test.mjs`             |
| RC2 | The 8 MB log blocked, with no reason given                                     | Diagnosed only | #2398 D1 names the stage, rule ids and log block; RC1 removes the known trigger | `tests/issue-2397-sanitization-failure-diagnostics.test.mjs`  |
| RC3 | Duplicate "Log Upload Failed" comment from the `--attach-logs` safety net      | **Fixed here** | One report per target, log file and session outcome                             | `tests/issue-2400-single-log-upload-failure-comment.test.mjs` |
| RC4 | The comment pointed to a path inside a container that was then removed         | **Fixed here** | The comment and console say where the log really is and how to reach it         | same                                                          |
| RC5 | Over-masking: `= await …`, `: false`, `= async () =>` became `[REDACTED]`      | **Fixed here** | Exact language keywords and literals are not credentials                        | `tests/issue-2400-keyword-assignment-not-masked.test.mjs`     |
| RC6 | Every Secretlint scan kept ~11 KB forever (profiler on by default)             | **Fixed here** | `secretLintProfiler.setEnabled(false)`, as upstream documents for library use   | `tests/issue-2400-secretlint-profiler-disabled.test.mjs`      |

## Data collected

| File                        | Content                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `original-log.txt`          | The host-side start-command console log of the session (the gist linked from the issue, 5.7 MB, 85 k lines) |
| `raw/comment-5934184600.md` | The first "Log Upload Failed" comment                                                                       |
| `raw/comment-5934233622.md` | The second, identical comment                                                                               |
| `raw/pr-2398-body.md`       | The PR #2398 description that the session tried to refresh. It contains `token => !token`, the RC1 trigger  |

The 8 MB solver log file itself (`/home/box/12973819-edf2-46a1-9507-73725ece23dd.log`) was
lost with the container. `original-log.txt` is the console stream, which is a large subset of it.

## Timeline (UTC, 2026-10-01)

| Time         | Event                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 13:36:52     | start-command starts detached container `eebf035f-…` (execution id `e1390df8-…`), "Container will be removed after successful completion." |
| 13:39:19     | `solve` session starts on issue #2397 (`--tool claude --attach-logs --verbose`)                                                            |
| ~15:03:50    | `⚠️  Error attaching working session summary: Credential sanitization failed` (log line 85133)                                             |
| ~15:03:51    | `⚠️  Could not refresh the PR description's Changes section: Credential sanitization failed` (line 85215)                                  |
| 15:03:51.9   | Log upload starts (8 MB, gh-upload-log), blocked by the sanitizer (line 85237)                                                             |
| 15:03:57     | First "Log Upload Failed" comment, id 5934184600                                                                                           |
| 15:06:38     | "✅ Ready to merge" comment, id 5934232006 (auto-merge check)                                                                              |
| 15:06:39     | `📎 No session log was attached yet — attaching final log (--attach-logs safety net)...` (line 85335)                                      |
| 15:06:44     | Second, identical "Log Upload Failed" comment, id 5934233622                                                                               |
| 15:06:45     | Session ends; `solve` exits 0                                                                                                              |
| 15:06:50.425 | `Container removed: eebf035f-… (exit 0, lifetime 5391.423s, oomKilled=false)`. The log file is gone                                        |
| 16:52:40     | Issue #2400 opened: `ls /home/box/12973819-….log` → "No such file or directory"                                                            |

## Requirements from the issue

1. Find the root cause of every error, warning, false negative and false positive, and fix it.
2. Collect the logs and data in this folder and write this case study: timeline, requirements, root causes, solutions.
3. Search online and check existing libraries.
4. Add debug output where the data is insufficient.
5. Report issues to other repositories where relevant.
6. Apply the fixes across the whole codebase in one PR.

## Root causes and solutions

### RC1 — summary and PR description blocked by non-idempotent masking (fixed by #2398)

`sanitizeForPublication` masks the text, then blocks if another masking pass would still
change it. On 2.33.2, `token => !token` was masked to `token => [REDACTED]`. A second pass
turned that into `token =[REDACTED] [REDACTED]`, so the text was blocked as "residual
credential material". The session's summary and the PR #2398 description both quote this
expression, because #2397 was about it.

Reproduced: `raw/pr-2398-body.md` is blocked on `main` with
`node experiments/issue-2400-check-text.mjs docs/case-studies/issue-2400/raw/pr-2398-body.md`
(stage `findCredentialResiduals`, 1 credential-pattern finding). It passes with #2398 merged.

### RC2 — the 8 MB log blocked, reason unknown (diagnosed only)

The log file is written already masked once (`log()` → `sanitizeCredentialText`, the
stream sanitizer for stdio). A once-masked `token => !token` converges on the next pass,
so RC1 alone does **not** explain the log being blocked. The following were tried and none
reproduces the block on `main` (`experiments/issue-2400-*.mjs`):

- the console log `original-log.txt`, published block by block as `gh-upload-log` does
  (`experiments/issue-2400-sanitize-log.mjs`: 6 blocks, 0 blocked), and masked once first
  as `log()` does (`experiments/issue-2400-simulate-log-file.mjs`);
- every line of it on its own, with `experiments/issue-2400-find-blocking-lines.mjs`
  (0 of 85394 lines blocked, run with the RC6 fix so the scan does not run out of memory);
- every file the session read from `src`, `tests`, `experiments` and `scripts`
  (1817 files), raw and as JSON-escaped tool results, with
  `experiments/issue-2400-scan-repo-files.mjs`. 0 files were blocked;
- `docs`, `.changeset` and `README.md` (3455 files), in the same way. 0 files were blocked.

What is left:

- The ~2.3 MB that is only in the file log. The verbose interceptor writes full tool-call JSON to the file, not to the console.
- The known-token stage. `containsKnownToken` on 2.33.2 compared env values with no
  minimum length (#2398 RC4b), and the environment of that container cannot be inspected
  after the fact.

The log file was lost with the container (RC4), so the exact rule cannot be identified now.
Two changes cover this. #2398 D1 makes every blocked publication report its stage, rule ids
and block index. With RC4 fixed, the next comment says where the log is, so it can be
recovered and replayed through `experiments/issue-2400-check-text.mjs`.

### RC3 — the `--attach-logs` safety net posts the same "Log Upload Failed" comment twice (fixed here)

`verifyResults` uploads the log, fails and posts the report. Then `attachFinalLogIfMissing`,
the `--attach-logs` safety net, sees `logAttachedToGitHub === false`, uploads the same log
again, fails the same way and posts the same report again. #2398 suppresses a repeat only
when it is the latest tool comment on the target. Here "✅ Ready to merge" landed between
the two, so that check did not apply.

Fix (`src/log-upload-failure.lib.mjs`): `postLogUploadFailureComment` remembers, per target,
which `(log file, session error)` pairs it has already reported, with the comment id. A
repeat is skipped and logged with the earlier comment id. A report is remembered only after
it was really posted. A successful attachment to that target forgets the record
(`attachLogToGitHub` in `src/github.lib.mjs`). A different session error, target or log
file is still reported. The failure reason (sanitization or HTTP) is deliberately not part
of the key, because it is the same log of the same outcome.

### RC4 — "kept on the machine that ran this session" was false in Docker isolation (fixed here)

`HIVE_MIND_PARENT_SESSION_ID` is passed into every isolated container
(`src/isolation-runner.lib.mjs`), but nothing read it. The comment and the
`📁 Full log remains available locally at:` console line therefore described a path inside
a container as if it were on the host. start-command removes the container when the command
exits 0. This is intended behaviour of link-foundation/start#140: the console log is kept and
the filesystem is removed.

Fix (`describeLogFileLocation`, `formatLogLocationConsoleLines`):

- **Isolated container.** The comment says the path exists only inside the container. It
  says the container is removed on success and kept on failure, and gives
  `docker cp "<session>:<path>" .`. It also points to the console log the host keeps:
  `/log <session>` in Telegram, or `$ --status <session>` for its `logPath`.
- **Plain container.** The comment names the runtime.
- **Host.** The wording is unchanged.

### RC5 — keywords masked as credentials (fixed here)

`UNQUOTED_ASSIGNMENT` masks the value of any key that contains `token`, `secret`, `auth`
and so on. In code, that value is often an expression: `const fileTokens = await …`,
`skipActiveTokensOutputSanitization: false`, `const getAllKnownLocalTokens = async () =>`.
In the gist these show up as `= [REDACTED] getGitHubTokensFromFiles()`,
`skipActiveTokensOutputSanitization: [REDACTED]`, `secretlintDetections: [REDACTED]` and
similar, dozens of times.

Fix (`src/credential-sanitization-core.lib.mjs`): an exact language keyword or literal is
not masked. The list is `true false null undefined none nil await async new typeof function
this void yield`. Any such value would have been reduced to `[REDACTED]` by `maskToken`
anyway (≤ 12 characters), so no credential is lost. Values that merely start with a keyword
(`falsehood-is-not-a-keyword`, `awaitingApproval42xyz`) are still masked.

Calls and identifiers (`= getToken()`, `= value =>`) are still masked. detect-secrets
filters those with `is_indirect_reference`, but doing the same here would also let through
a real secret that happens to look like a call. That trade-off belongs to a separate change.

### RC6 — the Secretlint profiler retained memory on every scan (fixed here)

This was found while investigating RC2. Replaying the console log line by line through
`sanitizeForPublication` ran out of memory (`experiments/issue-2400-find-blocking-lines.mjs`,
native OOM stack). A bounded measurement (`experiments/issue-2400-heap-per-call.mjs`, heap
after `gc()`) showed the heap growing from 21 MB to 173 MB over 4000 calls, about 36 KB per call.

`@secretlint/core` alone accounts for about 11 KB per `lintSource` call
(`experiments/issue-2400-secretlint-heap.mjs`: 6 → 39 MB over 3000 calls). The rest comes from
the extra Secretlint passes over decoded layers in each sanitization. The cause is
`@secretlint/profiler`. Its singleton is enabled by default. `lintSource` calls
`secretLintProfiler.mark()` several times per call, and the observer pushes every mark and
measure into `entries` / `measures` arrays that are never cleared. The `performance` timeline
keeps the marks as well. secretlint/secretlint#1673 (v13.0.5) made the **CLI** profile only with
`--profile`. For library use the README says: "If you use Secretlint as a library and do not
need the profiling result, call `secretLintProfiler.setEnabled(false)`". Hive Mind never did,
so a Telegram bot or solver that sanitizes every comment it posts grew for its whole lifetime.

Fix (`initSecretlint` in `src/token-sanitization.lib.mjs`): disable the profiler when the
scanner is loaded. `@secretlint/profiler` is now a direct dependency, so the import resolves
under every package manager layout. The same 4000-call replay then stays at 26 MB. Detection is
unchanged; the test checks a GitHub token is still found. This is documented upstream behaviour,
so no upstream issue was filed.

## Online research and existing tools

| Tool                                                                                                     | How it avoids keyword false positives                                                                                        | Relevance                                                                                    |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [gitleaks](https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml) `generic-api-key`      | `entropy = 3.5`, stopwords including `true`, `false`, `null`, and an allowlist `^[a-zA-Z_.-]+$` for purely alphabetic values | The same idea as RC5; we use an exact keyword list because our masker must stay conservative |
| [detect-secrets](https://github.com/Yelp/detect-secrets/blob/master/detect_secrets/filters/heuristic.py) | `is_indirect_reference` filters `secret = get_secret_key()`; `is_templated_secret`, `is_prefixed_with_dollar_sign`           | Candidate for a later, separately reviewed relaxation                                        |
| [secretlint](https://github.com/secretlint/secretlint)                                                   | Vendor-shaped rules only, no generic keyword rule                                                                            | The residual scanner here; its default-on profiler is RC6                                    |
| [trufflehog](https://github.com/trufflesecurity/trufflehog)                                              | Detector-per-vendor plus live verification                                                                                   | Verification is not acceptable at a publication boundary (it sends the secret out)           |

No new defect was found in these libraries or in start-command, so no upstream issue was filed. RC6
is covered by upstream's documented library setting.
The container removal on exit 0 is the documented contract of link-foundation/start#140.

## Remaining uncertainty and future work

- RC2: the exact check that blocked the 8 MB log is unknown (see above). The next
  occurrence will name it (#2398 D1).
- Persisting the solver log of isolated sessions on the host, for example by mounting a
  per-session host directory and passing `--log-dir`, would let a blocked log survive a
  successful exit. That needs decisions on disk quota and UID mapping in DinD, and relates
  to #2296. It is left as a follow-up.

## Reproduce

```bash
node tests/issue-2400-single-log-upload-failure-comment.test.mjs   # RC3, RC4
node tests/issue-2400-keyword-assignment-not-masked.test.mjs       # RC5
node tests/issue-2400-secretlint-profiler-disabled.test.mjs        # RC6
node --expose-gc experiments/issue-2400-heap-per-call.mjs docs/case-studies/issue-2400/original-log.txt 4000  # RC6 heap
node experiments/issue-2400-check-text.mjs docs/case-studies/issue-2400/raw/pr-2398-body.md  # RC1 (blocked before #2398)
node experiments/issue-2400-scan-repo-files.mjs . --raw src tests  # RC2 search
```
