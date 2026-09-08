---
'@link-assistant/hive-mind': minor
---

Attribute the commits Formal AI authors, so its self-hosting metric can count them (issue #2229).

`solve --model formal-ai` produced ordinary commits: no `Formal-AI-*` trailers, no evidence bundle. formal-ai's `scripts/self-hosting-metric.rs` reads both off the commit itself, so every commit Formal AI wrote through Hive Mind was invisible to the measurement it exists to feed.

- **The trailers and the evidence land in the same commit, or neither does.** The metric treats a commit that claims a session without carrying its evidence as a hard error, not as an unattributed commit, so a partial write is worse than none. `pre-commit` copies the bundle in and stages it (it is the only hook whose `git add` still reaches the commit), and `prepare-commit-msg` adds the four trailers **only** when the staged `session-id.txt` matches the session byte for byte. `--no-verify` therefore yields a plain commit rather than a broken one, `--amend` does not duplicate the trailers, and merges are left alone.
- **The bundle is what the metric asks for**: `agent-stream.jsonl`, the Agent CLI stream, and `session-id.txt` carrying `formal-ai session <ses_…>` and `formal-ai model formal-ai/<version>`, the version read from `formal-ai --version`. It is committed under `dev/log/self-authored/issue-<n>/evidence`, the path formal-ai's own workflow uses.
- **`Formal-AI-Pull-Request` is on the commit when it is made.** Hive Mind opens the pull request before the agent runs, so the URL is already known; the late-rewrite path exists for the case where it is not, and refuses to touch anything already pushed, merged or signed.
- **A hosted model can never be published as Formal AI's own work.** The session is refused when `--model`/`--tool` names one, and it is disabled mid-run, with the reason printed, if the Agent CLI's own stream reports that a hosted provider answered.
- **The hooks reach the agent process and nothing else.** They are delivered through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`, merged with whatever the environment already set — the routed-task push guard (#2164) keeps working — and they delegate to the repository's existing hooks. Hive Mind's own commits stay unattributed, as they should.
- **Attribution never breaks a run.** Every hook exits 0 whatever happens, a missing version or an unusable repository degrades to an unattributed run, the stream goes through the same fail-closed sanitizer as every other published payload (a batch it refuses is replaced by a marker, not skipped silently), and `.git/info/exclude` keeps the bundle out of `git status` so an abandoned run leaves no residue.

New `--attribution auto|formal-ai|none` on `solve`; `auto` follows `--model`. `node examples/formal-ai-attributed-commit-demo.mjs` shows the whole path against a throwaway repository.
