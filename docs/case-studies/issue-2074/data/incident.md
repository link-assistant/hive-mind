# Raw incident evidence

## Hive Mind issue

- URL: https://github.com/link-assistant/hive-mind/issues/2074
- Created: 2026-07-17T10:29:18Z
- Title: `Codex solver cannot provision required plugins outside recommended_plugins allowlist`

The issue reports this exact solver outcome:

> Blocked by the mandatory Superpowers preflight; no implementation work was started.

Recorded attempted steps:

1. No `superpowers:*` skill or `superpowers@openai-curated-remote` plugin capability was available.
2. The environment plugin-install workflow was called with that exact ID.
3. It failed with `plugin_id must match one of the entries in the <recommended_plugins> list`.
4. `superpowers:using-superpowers` and the other mandatory workflows therefore could not be invoked.
5. The solver obeyed the stop condition, changed no repository files, and left a clean worktree.

The issue asks for operator provisioning, direct and Docker visibility, restart persistence, exact diagnostics, no target-repository changes, regression tests, and documentation covering `.codex`, `.agents/skills`, and image-provided configuration.

## Maintainer comment

- URL: https://github.com/link-assistant/hive-mind/issues/2074#issuecomment-5002236453
- Created: 2026-07-17T10:36:39Z

The maintainer requires automatic detection and preinstallation of required plugins, skills, and dependencies before starting Codex or Claude; repository-local rather than global application; a case study under `docs/case-studies/issue-2074`; reconstruction of the timeline and every requirement; root-cause, alternative, component, and online research; useful debug output where evidence is insufficient; upstream reports only where applicable; and complete execution in one PR.

## Original blocked task

- URL: https://github.com/CEHR2005/GCS-TS/issues/1
- Created: 2026-07-17T09:01:27Z
- Block report: https://github.com/CEHR2005/GCS-TS/issues/1#issuecomment-5001667515

The task's hard preflight required invoking `superpowers:using-superpowers` from `plugin://superpowers@openai-curated-remote`, attempting supported installation if absent, and stopping without implementation or file changes if installation or invocation failed. It prohibited a manual workflow fallback. The exposed block comment contains the same exact four attempted steps and error preserved above.
