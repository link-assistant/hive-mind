---
'@link-assistant/hive-mind': minor
---

Add GitHub Action for manual issue solving

This adds a new GitHub Action workflow (`solve-issue.yml`) that allows users to manually trigger issue solving from the GitHub UI. Key features:

- Manual trigger via `workflow_dispatch` with issue URL input
- Support for free AI models (Kimi, MiniMax, GPT-5-nano, etc.) requiring no AI authentication
- Uses GitHub's automatic `GITHUB_TOKEN` for `gh` CLI authentication
- Optional PAT support for cross-repository access
- Auto-fork option for contributing to public repos without write access
- Comprehensive documentation in `docs/GITHUB_ACTIONS.md`
