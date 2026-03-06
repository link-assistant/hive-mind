# Case Study: Optimize Docker Building CI/CD by Using sandbox:latest

**Issue:** [#1394](https://github.com/link-assistant/hive-mind/issues/1394)

## Problem Statement

The current hive-mind Docker image (`konard/hive-mind`) builds from `ubuntu:24.04` and runs a comprehensive installation script (`scripts/ubuntu-24-server-install.sh`) that installs all development tools from scratch. This approach has several issues:

1. **Build time**: Takes 10-15+ minutes to install all dependencies
2. **Timeout risk**: Complex installations (Homebrew, PHP, Perl, etc.) can timeout during CI/CD
3. **Redundancy**: The `link-foundation/sandbox` repository already provides a pre-built image with all general-purpose development tools
4. **Maintenance burden**: The install script duplicates functionality already tested and maintained in sandbox

## Solution Overview

Based on [PR #65 in link-foundation/sandbox](https://github.com/link-foundation/sandbox/pull/65), the architecture should be:

```
sandbox:latest (konard/sandbox)
    └── Contains: All general-purpose development tools
        - Node.js (NVM), Bun, Deno
        - Python (pyenv), Go, Rust
        - Java (SDKMAN), PHP (Homebrew)
        - Perl (Perlbrew), Lean 4, Rocq
        - .NET SDK, C/C++ tools (CMake, Clang, LLVM)
        - Git, GitHub CLI, screen, bubblewrap, expect
        - (and more bonus tools: Kotlin, Ruby, Swift, R, Assembly)

hive-mind:latest (konard/hive-mind)
    └── Inherits from: sandbox:latest
    └── Adds: AI-specific tools
        - @anthropic-ai/claude-code
        - @openai/codex
        - @qwen-code/qwen-code
        - @google/gemini-cli
        - @github/copilot
        - opencode-ai
        - @link-assistant/hive-mind (meta-package)
        - Playwright + browsers + MCP
        - start-command, gh-* utilities
```

## Key Findings

### What sandbox:latest Already Provides

From the sandbox Dockerfile analysis:

| Tool Category | Tools Included |
|--------------|----------------|
| **Runtimes** | Node.js 20 (NVM), Bun, Deno, Python (pyenv), Go, Rust, Java 21 (SDKMAN) |
| **Languages** | PHP 8.3 (Homebrew), Perl (Perlbrew), Lean 4 (elan), Rocq/Coq (opam) |
| **System** | .NET SDK 8.0, CMake, Clang, LLVM, LLD, GCC, G++, Make |
| **Dev Tools** | Git, GitHub CLI, GitLab CLI (glab), screen, bubblewrap, expect |
| **Bonus** | Kotlin, Ruby (rbenv), Swift, R, NASM, FASM (x86_64 only) |

### What hive-mind Needs to Add (AI-Specific)

| Category | Tools |
|----------|-------|
| AI Coding CLIs | `@anthropic-ai/claude-code`, `@openai/codex`, `@qwen-code/qwen-code`, `@google/gemini-cli`, `@github/copilot`, `opencode-ai` |
| Workflow Utilities | `start-command`, `gh-setup-git-identity`, `gh-pull-all`, `gh-load-issue`, `gh-load-pull-request`, `gh-upload-log`, `@link-assistant/agent` |
| Meta-packages | `@link-assistant/hive-mind`, `@link-assistant/claude-profiles` |
| Browser Automation | Playwright + all browsers (chromium, chrome, firefox, webkit, msedge) + MCP |

### User Difference

sandbox uses `sandbox` user, while hive-mind uses `hive` user. This requires:
1. Either renaming the user in our Dockerfile
2. Or adjusting path references

## Implementation Plan

### Step 1: Update Main Dockerfile

Replace the current `Dockerfile` that builds from `ubuntu:24.04` with one that builds from `konard/sandbox:latest`:

```dockerfile
FROM konard/sandbox:latest

# Rename sandbox user to hive for backward compatibility
USER root
RUN usermod -l hive sandbox && \
    usermod -d /home/hive -m hive && \
    groupmod -n hive sandbox

# ... rest of AI-specific tools installation
```

### Step 2: Update coolify/Dockerfile

Similar changes for the Coolify deployment version.

### Step 3: Delete ubuntu-24-server-install.sh

After migration, the script becomes obsolete. Reference the last commit where it exists in documentation for historical purposes.

### Step 4: Update CI/CD

Modify `.github/workflows/release.yml`:
- Remove verification for tools that are now inherited from sandbox
- Add verification that sandbox image is properly inherited
- Simplify the Docker build verification steps

## Expected Benefits

1. **Faster builds**: From 10-15+ minutes to 2-3 minutes (only AI tools installation)
2. **Reduced timeout risk**: Heavy installations (Homebrew, PHP) already done in base image
3. **Better separation of concerns**: General dev tools in sandbox, AI tools in hive-mind
4. **Easier maintenance**: Updates to dev tools handled by sandbox repository

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| sandbox:latest image not up-to-date | Pin to specific version or use `sandbox:1.x.x` tag |
| User rename breaks existing volumes | Document migration path for existing deployments |
| Missing tool from sandbox | File issue in sandbox repository |

## Implementation

### Changes Made

1. **Dockerfile**: Replaced `FROM ubuntu:24.04` with `FROM konard/sandbox:latest`, renamed `sandbox` user to `hive`, and added AI-specific tool installation.

2. **coolify/Dockerfile**: Same changes as main Dockerfile, plus application code copying.

3. **scripts/ubuntu-24-server-install.sh**: Removed (functionality now provided by sandbox base image).

4. **scripts/detect-code-changes.mjs**: Updated docker pattern to match new file structure.

5. **docs/UBUNTU-SERVER.md**: Updated to reference the historical location of the removed script.

6. **.github/workflows/release.yml**: Simplified Docker build verification since tools come from sandbox.

### Migration Notes

- Existing deployments should update their Docker images after this change
- The `hive` user is preserved for backward compatibility
- All tool versions are now managed by the sandbox repository

## References

- [sandbox repository](https://github.com/link-foundation/sandbox)
- [sandbox PR #65](https://github.com/link-foundation/sandbox/pull/65) - Gap analysis and architecture clarification
- [sandbox full-sandbox Dockerfile](https://github.com/link-foundation/sandbox/blob/main/ubuntu/24.04/full-sandbox/Dockerfile)
- [Historical ubuntu-24-server-install.sh](https://github.com/link-assistant/hive-mind/blob/4f027b32/scripts/ubuntu-24-server-install.sh)
