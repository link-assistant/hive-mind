# Claude history admission

The production Docker mount builder previously skipped missing Claude history
directories. Preparation accepted symlinks and non-directory files, and swallowed
directory-creation errors. That permits a launch without its intended persistent
conversation mounts.

`tests/issue-3785-claude-history-mounts.test.mjs` reproduces eight failures before
repair: missing projects/sessions, linked projects/sessions, non-directory
projects/sessions, read-only creation and default directory permissions. The
explicit Router control already passes.

Both configured Claude history directories are now mandatory, just as Codex
history directories are. Preparation requires real directories, reports failures
without continuing and creates new directories with mode 0700. The nine tests
pass. Authentication bytes/inodes and existing transcripts remain unchanged;
the Router control still prepares and mounts no vendor state.

All nineteen default test files directly using the affected mount builders pass.
Their unrelated image-provenance, Formal AI, Git-identity and resource-limit
fixtures now provide the mandatory synthetic history directories. No tested
feature or rejection assertion was removed.

This verifies admission and mount selection. It does not establish canonical
Claude auth, the complete native history inventory, scoped-path enforcement,
cross-container refresh, Docker lifecycle or deployment migration. Those issue
requirements remain unfinished.

Reproduce the focused controls with:

```sh
node --test tests/issue-3785-claude-history-mounts.test.mjs
```
