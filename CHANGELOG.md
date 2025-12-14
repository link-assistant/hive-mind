# @link-assistant/hive-mind

## 0.38.9

### Patch Changes

- 40545f6: Consolidate CI/CD workflows to single release.yml following js-ai-driven-development-pipeline-template best practices

  - Removed verify-version-bump job (replaced by changeset-check)
  - Consolidated main.yml, ci.yml, and helm-pr-check.yml into release.yml
  - Added template scripts for release automation (validate-changeset, version-and-commit, publish-to-npm, etc.)
  - Tests now run before release on main branch
  - Added manual release support (instant and changeset-pr modes)
  - Maintained all existing hive-mind CI checks (docker-pr-check, helm-pr-check, memory-check, etc.)
