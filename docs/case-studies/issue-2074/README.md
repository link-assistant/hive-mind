# Issue 2074: repository-scoped Codex capability preflight

## Executive summary

The failure was not caused by the target repository or by Codex skill discovery. A task declared a hard dependency on Superpowers, but installation was attempted from inside an already-created AI session through an environment tool whose fixed `recommended_plugins` allowlist did not contain Superpowers. That tool correctly rejected the request, leaving no allowed fallback.

Hive Mind now resolves the dependency before `codex exec`. It scans the issue and all comments for explicit required plugin selectors and skills, queries the operator's Codex marketplace catalog, finds the plugin that supplies each skill, and provisions it in persistent state scoped to `<owner>/<repo>`. The target checkout is untouched. Direct and Docker-isolated sessions receive the resulting `CODEX_HOME`; Docker also propagates standard user Agent Skills from `~/.agents/skills`.

## Evidence index

- [Incident timeline](timeline.md)
- [Root-cause and solution analysis](analysis.md)
- [Requirements traceability](requirements.md)
- [Online and component research](research.md)
- [Raw incident evidence](data/incident.md)
- [Raw CLI experiments](data/experiments.log)

The source issue exposed the blocked session's exact report as a GitHub comment, not a downloadable process transcript. That complete exposed report is preserved in `data/incident.md`; this case study does not claim an unavailable private solver event stream was downloaded.

## Implemented flow

1. Fetch issue metadata and all comments with paginated GitHub API calls.
2. Detect explicit requirement statements and normalize marketplace aliases.
3. Query `codex plugin list --available --json` in the operator Codex home.
4. Resolve named skills by inspecting catalog plugin skill manifests.
5. Prepare `$CODEX_HOME/hive-mind/repositories/<owner>/<repo>`.
6. Preserve repository plugin blocks while refreshing operator runtime config, authentication, installation ID, and marketplace snapshot.
7. Install missing providers with `codex plugin add`, then query the scoped catalog again to verify installed and enabled state.
8. Launch `codex exec` with the scoped home. Fail before launch with the exact missing capability and remediation command if any stage cannot be satisfied.

## Verification

The regression test covers requirement parsing, alias normalization, provider discovery, repository isolation, repeated-run persistence, refreshed parent configuration, missing-capability diagnostics, direct preflight command environments, `.codex` containment, and `.agents` Docker propagation. A live preflight against issue 2074 also resolved and installed `superpowers@openai-curated` in the repository-scoped state without changing this checkout.
