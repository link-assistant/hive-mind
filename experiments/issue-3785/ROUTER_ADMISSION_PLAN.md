# Router authentication admission

Explicit Router selection must not silently become native vendor authentication.
This step strengthens the existing Claude/Codex guard; it does not establish the
complete six-tool Router authority, durable audit or restart contract.

- [x] Reproduce the environment bypass, missing-token admission, unreadable
      surfaces and quoted/dotted TOML provider overrides before changing code.
- [x] Reproduce native command creation before refusal on new and resumed runs.
- [x] Require Router admission before native command creation, retaining exit 77
      and refusing inspection errors without logging credential contents.
- [x] Parse provider configuration as TOML and preserve ordinary private settings.
- [x] Verify periodic divergence still stops a running command and fires once.
- [x] Reproduce connection-probe and fallback admission gaps, plus security
      errors being swallowed by startup/execution handlers; retain exit 77.
- [x] Reproduce login-profile replacement of the admitted Router environment
      in an isolated shell and in new/resumed production Codex commands; use
      non-login shell startup for routed commands.
- [x] Run focused tests, repository checks and the default suite sequentially.
- [x] Review the change, update evidence/inventory/translations and commit it.
- [ ] Preserve current CI logs/artifacts before pushing; verify the new head.

The original requirement inventory remains authoritative. Default canonical
storage, native refresh coordination and complete conversation storage remain
unfinished, including the documented upstream Claude owner-death blocker.
