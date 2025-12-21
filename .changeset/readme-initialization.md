---
'@link-assistant/hive-mind': patch
---

Enhance README.md initialization for empty repositories

This release enhances the existing empty repository handling to include repository description in the auto-generated README.md file. When the solve command encounters an empty repository that cannot be forked, it now creates a more descriptive README with both the repository title and description (if available).

**Enhanced Features:**

- Enhanced `tryInitializeEmptyRepository()` to include repository description
- Creates README with repository title and description (if available) via GitHub API
- Triggers automatically when fork creation fails due to empty repository
- Falls back to posting a comment on the issue if write access is not available

**Implementation:**

- Modified `tryInitializeEmptyRepository()` in `src/solve.repository.lib.mjs`
- Uses GitHub API to fetch repository description
- Creates more informative README for empty repositories

**Example README Content:**
For a repository named `hive-mind` with description "The AI that controls AIs.", the generated README.md will be:

```markdown
# hive-mind

The AI that controls AIs.
```

**Use Case:**
This feature only activates when attempting to fork an empty repository (which GitHub doesn't allow). The solve command will attempt to initialize the repository with a README if the user has write access, making the repository forkable and allowing work to proceed.

Fixes #706
