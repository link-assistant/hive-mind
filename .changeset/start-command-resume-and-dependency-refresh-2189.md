---
'@link-assistant/hive-mind': minor
---

Resume a killed session in the container it died in, reconcile executions that outlived their supervisor, and move the whole dependency set forward (issue #2189).

The first half of #2189 shipped in 2.16.0 with one requirement left open: R2 asked for a killed session to be continued **in the same `$` session / container**, and `$` could not do that yet. The three upstream issues this repository filed — `link-foundation/start#162` (`--resume`), `#164` (argv flattened with `join(' ')`), `#165` (a V8 self-abort reported as `oomKilled=false`) — are delivered in `start-command@0.33.0`, so R2 is closed here and the rest of the toolchain is brought up with it.

- **Same-container resume.** `src/isolation-runner.resume.lib.mjs` wraps `$ --resume <id> [-- <command>]`, and `src/session-kill-resume.in-place.lib.mjs` prefers it over a fresh isolated run: the clone, the caches and the half-finished branch survive the kill instead of being rebuilt from scratch. When in-place resume is unavailable or refused, the previous behaviour — a new isolated session — still runs, and the reason is recorded on the session record (`killRecoveryInPlace`, `killRecoveryResumeMode`) and in the operator's report.
- **No more limbo executions.** The bot reconciles at startup with `$ --resume-all`: a container still running is re-attached to, and one that ended while unsupervised is finalized with the exit code it actually had, rather than being polled forever as "executing".
- **`$` refusals are read as refusals.** `command-stream`'s `$` *resolves* on a non-zero exit instead of throwing, so `$ --stop <unknown>` ("No execution found…", exit 1) had been reported to the operator as a stop that happened. Every `$` invocation now inspects the exit code, and both resume wrappers additionally distinguish an older `$` that does not know the verb (`unsupported: true`, so callers keep their old path) from a genuine refusal.
- **0.33.0's kill hints are consumed.** `exitReason` and `memoryExhausted` from `$ --status` feed `describeKillCause` directly, so a runtime self-abort is named as out of memory from the supervisor's own answer rather than only from log forensics.
- **The dependency set is current, and what changed in it is used.** `@changesets/cli` 2 → 3, `jscpd` 4 → 5, `@sentry/node` 10.62 → 10.73, `prettier` 3.8.5 → 3.9.6, `agent-commander` 0.8 → 0.10, `dayjs` 1.11.21 → 1.11.23, `eslint` 10.5 → 10.9, `lint-staged` 17.0 → 17.4, secretlint 13.0.2 → 13.0.5, `lino-objects-codec` 0.4 → 0.8, `lino-i18n` 0.1 → 0.2.

Three of those bumps were behaviour changes that needed work rather than a version number:

- `changeset version` **exits 1** when there are no unreleased changesets in 3.0, where 2.x warned and exited 0. The release job reads the changeset count before rebasing onto the remote, and the rebase can consume the very changesets the decision was made on — a race that turned into a red release. `versionAndCommit` re-reads the count after the rebase and reports the already-published version through the existing `already_released` path.
- `jscpd` 5 is a Rust rewrite that treats `skipComments` as an **unknown field**: it warned and silently fell back to `mode: mild`, quietly loosening the duplication gate. `.jscpd.json` now says `"mode": "weak"`, which is what that option means in 5.
- `@sentry/node` 10.71+ turns structured logs on by default, and they bypass `beforeSend` entirely. The redaction this repository relies on was therefore no longer covering everything it left through; `src/instrument.sanitize.lib.mjs` is now shared between `beforeSend` and a new `beforeSendLog` hook, so both surfaces are scrubbed by the same code.

`node-pty` (pulled in by `agent-commander` 0.10's real-TUI capture) is denied a native build in `allowScripts`: it runs in a separate spawned pty host that this repository never launches headlessly.

Evidence for every claim above — including the two dependency behaviours that were checked and found *not* to affect this repository — is in `docs/case-studies/issue-2189/README.md` under "Dependency Follow-Through", with the reproduction scripts in `experiments/issue-2189/`.
