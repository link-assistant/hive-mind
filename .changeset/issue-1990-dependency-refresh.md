---
"@link-assistant/hive-mind": patch
---

Refresh dependencies and pick up the upstream half of the #1990 fix. The
`start-command` pin in `Dockerfile`/`Dockerfile.dind` is bumped `0.30.1 → 0.30.2`,
which delivers [link-foundation/start#144](https://github.com/link-foundation/start/issues/144):
detached/isolated docker runs now surface the container's `OOMKilled` status and
preserve an abnormally-terminated container's filesystem for inspection instead of
auto-removing it. npm dependencies and devDependencies are updated to their latest
compatible versions (notably ESLint 9 → 10, which enables the `no-useless-assignment`
and `preserve-caught-error` recommended rules — all newly-flagged sites were fixed).
`jscpd` is intentionally held at `^4.0.5` because its 5.x line changes the
duplication baseline (it analyzes a wider file set, reporting 12.2% vs 10.7% on the
same tree) and would otherwise force weakening the duplication gate; this is a tooling
behavior change, not new duplication.
