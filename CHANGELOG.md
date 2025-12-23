# @link-assistant/hive-mind

## 0.50.2

### Patch Changes

- Test patch release

## 0.50.1

### Patch Changes

- 8fdf8dd: Fix Sentry CLI 3.x compatibility to restore Docker image publishing
  - Update `scripts/upload-sourcemaps.mjs` to use `sourcemaps upload` command instead of deprecated `releases files` command
  - Add case study documentation for issue #962 investigation

## 0.50.0

### Minor Changes

- 8934ed6: Improve changeset CI/CD robustness for multiple concurrent PRs
  - Update validate-changeset.mjs to only check changesets ADDED by the current PR (not pre-existing ones)
  - Add merge-changesets.mjs script to combine multiple pending changesets during release
  - Merged changesets use highest version bump type (major > minor > patch) and combine descriptions chronologically
  - Update release workflow to merge multiple changesets before version bump
  - This prevents PR failures when multiple PRs merge before a release cycle completes

## 0.49.0

### Minor Changes

- Add --claude-file and --gitkeep-file CLI options for choosing between CLAUDE.md and .gitkeep files

  This feature allows users to choose which file type to use for PR creation:
  - `--claude-file` (default: true): Use CLAUDE.md file for task details
  - `--gitkeep-file` (default: false, experimental): Use .gitkeep file instead

  The flags are mutually exclusive:
  - Using `--gitkeep-file` automatically disables `--claude-file`
  - Using `--no-claude-file` automatically enables `--gitkeep-file`
  - Both flags cannot be disabled simultaneously

  This is a step toward making .gitkeep the default behavior in future releases.

## 0.48.4

### Patch Changes

- b010ce6: Increase minimum disk space requirement from 512 MB to 2 GB to provide more room for commands to gracefully finish before running out of disk space and prevent potential OS issues

## 0.48.3

### Patch Changes

- ba6d6e4: Add comprehensive research on folder naming best practices for documentation

  Added expanded documentation in `docs/case-studies/folder-naming-best-practices.md` covering:
  - Industry standards (Google SRE, ITIL, NIST, Diataxis, Oxide RFD, NASA FRB, FEMA AAR)
  - Terminology mapping for alternative document type names (PIR, AAR, RCA, TDR, etc.)
  - Recommended folder structure for incidents, investigations, problems, case studies, decisions, reviews, retrospectives, and runbooks
  - Extended folder structure for larger organizations
  - File naming conventions for 18+ document types following kebab-case and ISO 8601 date formats
  - Document templates with YAML front matter including RFD, Spike, AAR, Retrospective, and One-Pager templates
  - 30+ verified authoritative sources from industry leaders

## 0.48.2

### Patch Changes

- Test patch release

## 0.48.1

### Patch Changes

- 279642e: Comprehensive release and validation fixes

  This release includes multiple critical fixes that work together to ensure reliable releases and prevent unvalidated code from merging:

  **1. Fix workflow conditions to prevent unvalidated code from merging (#958)**

  Updated lint job conditions in release.yml to check all file types that Prettier formats (.mjs, .md, .json, .js), not just .mjs files. This ensures the lint check runs consistently for both pull requests and main branch, preventing formatting issues from bypassing validation. Previously, PRs changing only .md or .json files would skip lint checks, allowing unformatted code to merge and cause main branch CI failures.

  Documentation added:
  - Case study analysis (docs/case-studies/issue-958/ANALYSIS.md) with root cause analysis and timeline reconstruction
  - Branch protection policy guide (docs/BRANCH_PROTECTION_POLICY.md) with required status checks specification and configuration instructions

  **2. Fix perlbrew bashrc unbound variable error at perl version check (#954)**

  Resolves an issue where running `perl --version` during installation would trigger an "unbound variable" error from perlbrew's bashrc file at line 71. The error occurred because:
  - The version check command triggered .bashrc sourcing in a subshell
  - Perlbrew's bashrc referenced positional parameter $1 without guards
  - With `set -u` enabled, unbound variables cause errors

  Solution:
  - Only load perlbrew in interactive shells (PS1 check in .bashrc)
  - Temporarily disable `set -u` when sourcing perlbrew bashrc in the install script
  - Re-enable strict mode immediately after sourcing
  - Added comprehensive test script (experiments/test-perlbrew-fix.sh)

  **3. Enhance README.md initialization for empty repositories (#706)**

  Enhanced the existing empty repository handling to include repository description in the auto-generated README.md file. When the solve command encounters an empty repository that cannot be forked, it now creates a more descriptive README with both the repository title and description (if available).

  **4. Fix package-lock.json sync in changeset version bump flow**
  - Add `npm install --package-lock-only` after `npm run changeset:version` in version-and-commit.mjs
  - Ensures package-lock.json stays in sync with package.json during changeset-based releases
  - Fixes issue where version bumps only updated package.json

## 0.48.0

### Minor Changes

- 93ea94b: Add solution drafts listing feature to hive command. When processing completes, hive now displays all completed issues with their linked pull requests before showing the "✅ All issues processed!" message.

### Patch Changes

- a44ab88: Add system prompt guidance to prefer using existing code as examples
  - Added guideline to encourage searching for similar existing implementations before implementing from scratch
  - Applied consistently across all three prompt modules (claude, codex, opencode)
  - Helps maintain consistency with existing patterns and reduces redundant work

- 1bdc96d: Fix --base-branch option to properly create branches from the specified base branch instead of from current HEAD

## 0.47.1

### Patch Changes

- 68c0417: Fix Rocq installation verification by sourcing opam environment
  - Source opam environment before verifying Rocq in installation summary
  - Use `rocq -v` for verification as recommended by official documentation
  - Update CI workflow to require Rocq to be accessible (not optional)
  - Add case study documenting the issue and solution

## 0.47.0

### Minor Changes

- 1351ffe: Add Prettier for automatic code formatting with ESLint integration
  - Added Prettier configuration with project code style settings
  - Created format and format:check npm scripts for code formatting
  - Integrated Prettier with ESLint to warn about formatting issues
  - Added eslint-config-prettier and eslint-plugin-prettier dependencies

## 0.46.1

### Patch Changes

- 3707189: Implement fail-fast CI strategy for release.yml workflow
  - Added dependency ordering so long-running checks wait for all fast checks to pass
  - Fast checks (test-compilation, lint, check-file-line-limits) run first (~7-21s each)
  - Long-running checks (test-suites, test-execution, memory-check-linux, docker-pr-check) only run after fast checks pass
  - Added smart conditionals with `!contains(needs.*.result, 'failure')` to skip long checks when fast checks fail
  - Added section markers to clearly document FAST vs LONG-RUNNING checks in the workflow

  Benefits:
  - Time savings: If fast checks fail, ~4+ minutes of long-running tests are skipped
  - Faster feedback: Developers get quick feedback on common issues
  - Resource efficiency: Reduces unnecessary GitHub Actions minutes consumption

## 0.46.0

### Minor Changes

- a436ee4: Add --prompt-case-studies CLI option for comprehensive issue analysis. When enabled, instructs the AI to download logs, create case study documentation in ./docs/case-studies/issue-{id}/, perform deep analysis, reconstruct timeline, identify root causes, and propose solutions. Works only with --tool claude, disabled by default.

### Patch Changes

- 1110e7a: Add comprehensive changeset documentation to CONTRIBUTING.md explaining how contributors should use the changesets workflow for version management and changelog generation

## 0.45.0

### Minor Changes

- 81f8da0: Add `--tokens-budget-stats` option for detailed token usage analysis. This experimental feature shows context window usage and output token usage in absolute values and ratios when using `--tool claude`. Disabled by default.

## 0.44.0

### Minor Changes

- b72136f: Add /version command to hive-telegram-bot

  Implements a new /version command that displays comprehensive version information including:
  - Bot version (package version with git commit SHA in development)
  - solve and hive command versions
  - Node.js runtime version
  - Platform information (OS and architecture)

  This helps users and administrators quickly check version information without accessing logs or the server directly.

### Patch Changes

- 445091b: Fix Perl version detection in ubuntu-24-server-install.sh

  The `perlbrew available` command output was not being parsed correctly, causing the installation script to skip Perl installation with the message "Could not determine latest Perl version."

  **Changes:**
  - Use `grep -oE` to robustly extract Perl version strings regardless of line formatting
  - Capture stderr from `perlbrew available` for better debugging
  - Add debug output showing `perlbrew available` response when version detection fails
  - Works with 'i' markers for already-installed versions and variable indentation

  This ensures the latest Perl version is properly detected and installed via perlbrew.

  Fixes #948

## 0.43.0

### Minor Changes

- fe002f8: Add --prompt-issue-reporting flag for automatic issue creation

  This release introduces a new opt-in feature that enables the AI to automatically create GitHub issues when it spots bugs, errors, or minor issues during working sessions that are not related to the main task.

  **New Features:**
  - Added `--prompt-issue-reporting` CLI flag (disabled by default)
  - Issues include reproducible examples, workarounds, and fix suggestions
  - Supports creating issues in both current and third-party repositories
  - Automatic duplicate checking before creating issues

  **Usage:**

  ```bash
  hive solve <issue-url> --prompt-issue-reporting
  solve <issue-url> --prompt-issue-reporting
  ```

  **Implementation:**
  - New guideline in system prompt (conditional on flag)
  - Flag added to both `hive` and `solve` commands
  - Uses `gh` CLI for authenticated issue creation (works with private repos)

  This feature helps ensure that no bugs slip through the cracks during development while giving users full control over when it's active.

## 0.42.3

### Patch Changes

- 64d6cf8: Add experimental /top command to Telegram bot
  - Added /top command to show live system monitor in Telegram
  - Displays auto-updating `top` output in a single message (updates every 2 seconds)
  - Owner-only access with chat authorization checks
  - Session isolation per chat using GNU screen
  - Clean stop button to terminate monitoring session
  - Marked as EXPERIMENTAL feature with user warnings
  - Not documented in /help as requested
  - Requires GNU screen to be installed on the system

  Fixes #500

## 0.42.2

### Patch Changes

- dca5bed: Make --auto-continue enabled by default
  - Changed default value from false to true for --auto-continue in both hive and solve commands
  - Smart handling of -s (--skip-issues-with-prs) flag interaction:
    - When -s is used, auto-continue is automatically disabled to avoid conflicts
    - Explicit --auto-continue with -s shows proper error message
    - Users can still use --no-auto-continue to explicitly disable
  - This improves user experience as users typically want to continue working on existing PRs

  Fixes #454

## 0.42.1

### Patch Changes

- acd70a9: Add Lean runtime preinstallation support via elan
  - Install elan (Lean version manager) with stable toolchain in all deployment environments
  - Add Lean/elan to PATH in Dockerfile, .gitpod.Dockerfile, coolify/Dockerfile
  - Add installation verification for elan, lean, and lake commands
  - Add CI checks to verify Lean installation in Docker builds

## 0.42.0

### Minor Changes

- d98d9c9: Add Java (OpenJDK) runtime installation support via SDKMAN in Ubuntu 24 server installation script
  - Install SDKMAN as Java version manager (following pattern of pyenv for Python, nvm for Node.js)
  - Install Java 21 LTS (Eclipse Temurin distribution) by default with fallback to OpenJDK
  - Add SDKMAN configuration to .bashrc for persistence
  - Add Java and SDKMAN to installation summary output
  - Add zip package to prerequisites (required by SDKMAN)

  Fixes #737

### Patch Changes

- d42d221: Add Perl runtime installation support via Perlbrew to Ubuntu 24 server installation script and Docker environment with CI verification

## 0.41.10

### Patch Changes

- f77fdf8: Add Golang runtime installation support to Ubuntu 24 server installation script with proper success verification
- ca4d83d: Add preinstalled Rocq (formerly Coq) theorem prover runtime support
  - Install opam (OCaml package manager) as prerequisite
  - Configure Rocq-released repository for package installation
  - Add Rocq prover with fallback to classic Coq package if unavailable
  - Add CI verification checks for Opam and Rocq/Coq installation
  - Include Opam paths in Docker environment variables
  - Support both Rocq and Coq theorem provers across all deployment configurations

## 0.41.9

### Patch Changes

- 1635432: Add C/C++ development tools (CMake, Clang/LLVM, GCC, Make) to Ubuntu 24 server installation script with CI verification

## 0.41.8

### Patch Changes

- 80aff72: Add Deno runtime installation support to Ubuntu 24 server installation script and Docker environment

## 0.41.7

### Patch Changes

- 781a8e4: Fix: Upload logs when usage limit is reached

## 0.41.5

### Patch Changes

- 27bbc44: Add backslash detection and validation in GitHub URLs

  When users provide URLs with backslashes (e.g., `https://github.com/owner/repo/issues/123\`), the system now properly validates them and provides helpful error messages with auto-corrected URL suggestions. According to RFC 3986, backslash is not a valid character in URL paths.

  **Changes:**
  - Enhanced `parseGitHubUrl()` function to detect backslashes in URL paths
  - Updated all validation points (Telegram bot `/solve` and `/hive` commands, CLI `hive` and `solve` commands)
  - Provides user-friendly error messages with corrected URL suggestions
  - Comprehensive test suite for backslash validation scenarios

  Fixes #923

## 0.41.3

### Patch Changes

- db8cef7: Fix CLAUDE.md not being deleted in continue mode

  When a work session completes successfully but the CLAUDE.md commit hash was lost between sessions (e.g., due to session interruption), the system now attempts to detect the CLAUDE.md commit from the branch structure instead of silently skipping cleanup.

  **Safety Checks (Preventing Issue #617 Recurrence):**
  1. CLAUDE.md must exist in current branch
  2. Find merge base to isolate PR-only commits
  3. Must have at least 2 commits (CLAUDE.md + actual work)
  4. First commit message must match expected pattern
  5. First commit must ONLY change CLAUDE.md file

  Fixes #940

## 0.41.2

### Patch Changes

- 43d5e01: Add image format validation warning to system prompts to prevent "Could not process image" errors. AI solvers are now instructed to verify image files with the 'file' command before reading them, avoiding crashes from corrupted downloads or HTML 404 pages. Includes reference to case study documenting the root cause of GitHub image processing failures.

## 0.41.0

### Minor Changes

- 5d193ef: Add `--prompt-general-purpose-sub-agent` flag for Claude tool to enable general-purpose sub-agent usage prompting when processing large tasks with multiple files or folders

## 0.40.3

### Patch Changes

- f8ebd99: Make Playwright MCP usage guidelines conditional based on MCP availability
  - Add `checkPlaywrightMcpAvailability()` function to detect if Playwright MCP is installed
  - Conditionally include Playwright MCP section in Claude system prompt only when MCP is detected
  - Integration in both main execution (solve.mjs) and watch mode (solve.watch.lib.mjs)
  - Resolves merge conflicts from main branch

## 0.40.1

### Patch Changes

- 1ee78c9: fix: prefer Anthropic provider for public price calculation

  When calculating public pricing for Claude models, fetchModelInfo now checks the Anthropic provider first instead of using the first match from the models.dev API (which was Helicone). This ensures pricing calculations show "Provider: Anthropic" as expected.

## 0.40.0

### Minor Changes

- 9115337: Add --prompt-plan-sub-agent option to encourage Plan sub-agent usage. When enabled, the AI receives suggestive instructions to consider using the Plan sub-agent for initial research and planning, improving solution quality through better upfront analysis.

## 0.39.0

### Minor Changes

- 5751dbf: Add --prompt-explore-sub-agent option to encourage Claude to use Explore sub-agent for codebase exploration

## 0.38.9

### Patch Changes

- 40545f6: Consolidate CI/CD workflows to single release.yml following js-ai-driven-development-pipeline-template best practices
  - Removed verify-version-bump job (replaced by changeset-check)
  - Consolidated main.yml, ci.yml, and helm-pr-check.yml into release.yml
  - Added template scripts for release automation (validate-changeset, version-and-commit, publish-to-npm, etc.)
  - Tests now run before release on main branch
  - Added manual release support (instant and changeset-pr modes)
  - Maintained all existing hive-mind CI checks (docker-pr-check, helm-pr-check, memory-check, etc.)
