# @link-assistant/hive-mind

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
