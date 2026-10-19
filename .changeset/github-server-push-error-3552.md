---
'@link-assistant/hive-mind': patch
---

A push answered by GitHub with `remote: fatal error in commit_refs` / `[remote rejected] … (failure)` is now treated as a transient GitHub server error, not a branch divergence (#3552):

- `git push`/`fetch`/`pull` retry it with the usual backoff instead of giving up after one attempt (`transient=no`).
- If every retry fails, the solver reports `GitHub server error while pushing …` and tells the user to check githubstatus.com and rerun. It no longer says "Local and remote branch histories differ" or asks the user to merge a branch that does not exist on the remote.
- Push explanations no longer claim "the remote branch changed" when the remote branch does not exist.
- The release version push retries such errors without rebasing, and the Helm `gh-pages` pushes retry them too.
- In verbose mode, the push-rejection classification and the remote branch state are logged.
