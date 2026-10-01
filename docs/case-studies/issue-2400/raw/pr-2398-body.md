## Summary

Fixes #2397.

When the ChatGPT Pro plan ended during a Codex run on konard/vietnam-accomodation-search#76, Hive Mind posted **three** "🚨 Solution Draft Failed" comments within five seconds. None of them said that the plan had to be renewed, and the log upload was blocked with no reason given. This PR fixes each root cause and adds a reproducing test for each one. Every test failed before its fix.

Full case study: [`docs/case-studies/issue-2397/README.md`](https://github.com/link-assistant/hive-mind/blob/issue-2397-36ba658228ab/docs/case-studies/issue-2397/README.md). It covers the timeline, the requirements, the evidence, a comparison with other PRs, the upstream report and the remaining uncertainty.

### One failure comment

- **RC1:** `attachLogToGitHub` posts a "Log Upload Failed" failure report and then returns `false`. The exit-handler notifier therefore reported the failure again. `postTrackedComment` now records the latest tool comment per PR or issue, and the notifier skips a target that already carries a failure report.
- **RC2:** after that upload failure, the notifier also posted its own fallback comment, which was the third one. It no longer does when the upload already posted the report.
- **RC2b:** comparable PRs (`test-hello-world-…fa49#2` and `…00e1#2`, since 2026-08-02) showed the same doubling after `🛑 Automation stopped` and `❌ Auto-restart N/N - limit reached`. These two comments now count as the failure report for the rest of the run, including when `✅ Ready to merge` is posted after them.
- Separate sessions that each fail still get one report each, because the check looks at the latest comment, not at any earlier comment.

### Clear reason

- **RC3:** `The '<model>' model is not supported when using Codex with a ChatGPT account.` is now classified as a Codex `PLAN_RESTRICTED` error. The guidance tells the user to:
  - renew the plan (with a link to the plan page),
  - choose a model with `--model`,
  - run `codex login` again, and
  - run `codex app-server daemon update`, because a stale daemon returns the same 400 on an active plan ([openai/codex#49396](https://github.com/openai/codex/issues/49396)).

### Log upload

- **RC4:** the credential sanitizer was not idempotent for `token => !token`, which the second pass turned into `token =[REDACTED] [REDACTED]`. The publication boundary treats "a second pass would change the text" as a leaked credential. As a result, any log containing such an arrow function, or a Ruby/PHP `'password' => …`, was blocked; that is 23 of 8492 files in `node_modules`. The fix:
  - `=` and `:` no longer match as separators before `>`;
  - the sanitizer runs to a bounded fixed point, so a future rule that is not idempotent cannot block publication on its own.
- **RC4b:** `containsKnownToken` checked env values of any length, while the maskers only mask values of 12+ characters, and the log masker ignored env tokens. As a result:
  - `TELEGRAM_OWNER_CHAT_ID=123456789` blocked every log that mentioned it;
  - a `GITHUB_PAT` with no vendor shape was never masked in logs and blocked publication.

  The fix shares one `MIN_KNOWN_TOKEN_LENGTH` between the maskers and the verifier, and `sanitizeOutput` now masks env tokens too.
- **D1, diagnostics:** "Credential sanitization failed; publication was blocked." now says which check blocked the upload. It adds the stage (`primary`, `residual-scan`, `secretlint`, `known-token-scan` or `residual`), the rule ids with counts, and the log block index and position. These details also cross the bounded-worker boundary. Matched text is never included.

### Upstream

- Commented on openai/codex#49396 ([comment](https://github.com/openai/codex/issues/49396#issuecomment-5933238726)). The comment:
  - reports the plan-expired case behind the same message;
  - lists the workarounds for each cause;
  - suggests distinct error codes for each cause, plus a warning when the CLI and daemon versions differ.
- I did not open a new issue, because #49396 already tracks this exact message.

### CI

CI on this branch failed twice for reasons unrelated to the fix:

- stale dependency pins plus the brace-expansion advisory;
- the freshness gate demanding `rust:1.99-slim-bookworm`, an image Docker Hub had not published yet.

I fixed both here, but main fixed the same two problems at the same time (ef33600b and 395afb3f, from #2396). The merge therefore takes main's versions, and this PR's net diff contains only the #2397 changes.

## How to reproduce

```sh
node experiments/issue-2397-replay-three-comments.mjs   # 3 comments before, 1 after
node experiments/issue-2397-min-repro.mjs               # 'token =>' blocked before
node experiments/issue-2397-known-token-mismatch.mjs    # short env value blocked before
```

## Tests

- `tests/issue-2397-single-failure-comment.test.mjs` (11 tests): replays #76, the stop, limit-reached and Ready-to-merge sequences, and the fallback cases.
- `tests/issue-2397-codex-plan-restricted.test.mjs` (6 tests).
- `tests/issue-2397-sanitizer-idempotency.test.mjs` (11 tests).
- `tests/issue-2397-known-token-consistency.test.mjs` (5 tests).
- `tests/issue-2397-sanitization-failure-diagnostics.test.mjs` (6 tests).
- Existing sanitization, comment, notifier and subscription suites (46 files) still pass.
- `tests/test-solution-summary.mjs` fails with `checkForAiCreatedComments should be imported`. It fails the same way on `main`, so this PR did not cause it.
- `lint`, `format:check`, `check:duplication` and `check:secrets` pass.

## Remaining uncertainty

The log of the affected run was never published; it is still on the host that ran the session. So it is not proven which residual blocked that particular upload. RC4 is the most likely cause, since Codex streams the JavaScript files it reads into the log. Both candidate causes are fixed. If an upload is blocked again, D1 will name the check in the PR comment itself.

