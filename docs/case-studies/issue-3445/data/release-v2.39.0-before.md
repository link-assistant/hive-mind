- 8ffc571: The requirements report is now experimental and off by default, Telegram status messages show the pull request as soon as it exists, and auto-restart no longer stops on a stale "no progress" verdict (#3469):

- `--requirements-report` (or `HIVE_MIND_REQUIREMENTS_REPORT=true`) turns the #2406 report back on. Without it no prompt tokens are spent on the report, the merge guard does not check it, and no completion restart waits for it.
- A running session's reply gets its `Pull request:` line once solve prints its PR URL, and `/fix` replies also show the PR of the issue that `/fix` created.
- `--auto-restart-until-mergeable` restarts when HEAD moved after a repeated session, and a completion restart no longer counts as a repeated session.
- Node 26 (V8 14.6) resolves a top-level `await import()` of a module that is still evaluating too early (nodejs/node#66806). Every such import in `src/` is now static, so the merge guards no longer throw `Cannot access '…' before initialization`.
- The agentic CLI updater reads a CLI's version from the package that owns its binary, so gh-setup-git-identity and claude-profiles no longer report a false "Could not update".
- Quiet probes pass `mirror: false` (`$` has no `silent` option), so the 403 of `gh api user` under an installation token no longer appears in the log.
- Clearer warnings when Docker disk space cannot be read and when a directly started session matches no queue item, and a mid-sentence `fix: <foreign issue URL>` is no longer treated as an intended close.
- With `--requirements-report`, the merge guard and the report template now compute the same digest of the issue feedback. Before, the guard left out the session-start comment its own solve had posted, so every fresh report was rejected as "changed after verification". Interactive-mode tool comments now start with a hidden `<!-- hive-mind:interactive-mode -->` line for the same reason.

**Related Pull Request:** #3470

---

[![npm version](https://img.shields.io/badge/npm-2.39.0-blue.svg)](https://www.npmjs.com/package/%40link-assistant%2Fhive-mind/v/2.39.0)