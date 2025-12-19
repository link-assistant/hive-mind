# Claude Code Playwright MCP Configuration Guide

## Overview

This document provides specific configuration options and solutions for preventing Chrome process memory leaks when using Playwright MCP with Claude Code. It covers installation methods, configuration options, version management, and recommended settings.

## Table of Contents

1. [Installation Methods](#installation-methods)
2. [Configuration Options](#configuration-options)
3. [Recommended Configurations for Memory Leak Prevention](#recommended-configurations-for-memory-leak-prevention)
4. [Version Management](#version-management)
5. [Troubleshooting](#troubleshooting)
6. [Configuration Examples](#configuration-examples)

---

## Installation Methods

### Method 1: Claude Code CLI (Recommended)

The recommended way to install Playwright MCP in Claude Code:

```bash
# Basic installation (user scope - available globally)
claude mcp add playwright -- npx @playwright/mcp@latest

# With specific scope
claude mcp add playwright --scope user -- npx @playwright/mcp@latest

# With memory leak prevention flags
claude mcp add playwright --scope user -- npx @playwright/mcp@latest --isolated --headless
```

**Scope Options:**
| Scope | Description | Config Location |
|-------|-------------|-----------------|
| `local` | Current directory only | `~/.claude.json` (project-specific) |
| `project` | Team-shared via version control | `.mcp.json` (project root) |
| `user` | Available globally | `~/.claude.json` (user section) |

### Method 2: Direct JSON Configuration

For advanced configurations, edit the configuration file directly.

**Location of config files:**
- **macOS/Linux**: `~/.claude.json`
- **Windows**: `%USERPROFILE%\.claude.json`

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--isolated",
        "--headless"
      ]
    }
  }
}
```

### Method 3: Project-level Configuration

Create a `.mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@0.0.49",
        "--isolated",
        "--headless",
        "--timeout-action=5000"
      ]
    }
  }
}
```

---

## Configuration Options

### Playwright MCP Command-Line Arguments

| Argument | Description | Memory Impact |
|----------|-------------|---------------|
| `--isolated` | Keep browser profile in memory only, don't save to disk | **HIGH** - Enables ephemeral contexts |
| `--headless` | Run browser in headless mode | **MEDIUM** - Reduces UI memory overhead |
| `--browser <type>` | Browser to use: chrome, firefox, webkit, msedge | **VARIES** - WebKit often uses less memory |
| `--user-data-dir <path>` | Persistent profile location | **LOW** - Allows cleanup between sessions |
| `--storage-state <path>` | Load auth state without full profile | **MEDIUM** - Auth without profile bloat |
| `--no-sandbox` | Disable sandbox (use cautiously) | **LOW** - Reduces memory slightly |
| `--image-responses <mode>` | Set to "omit" to skip image responses | **MEDIUM** - Reduces bandwidth/memory |
| `--viewport-size <size>` | Set viewport dimensions (e.g., "1280x720") | **LOW** - Affects rendering memory |
| `--timeout-action <ms>` | Timeout for actions (default: 5000) | **N/A** - Prevents hung processes |

### Claude Code MCP Environment Variables

```bash
# Set in shell or .env file
MCP_TIMEOUT=10000                    # Server timeout in milliseconds
MAX_MCP_OUTPUT_TOKENS=50000          # Max output tokens from MCP
```

---

## Recommended Configurations for Memory Leak Prevention

### Configuration A: Maximum Memory Protection (Recommended for Servers)

For long-running servers and CI/CD environments:

```bash
# Install with all memory-saving options
claude mcp add playwright --scope user -- npx @playwright/mcp@0.0.49 \
  --isolated \
  --headless \
  --browser=chromium \
  --no-sandbox \
  --viewport-size=1280x720 \
  --timeout-action=30000
```

**JSON equivalent:**
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@0.0.49",
        "--isolated",
        "--headless",
        "--browser=chromium",
        "--no-sandbox",
        "--viewport-size=1280x720",
        "--timeout-action=30000"
      ],
      "env": {
        "PLAYWRIGHT_BROWSERS_PATH": "/opt/playwright/browsers"
      }
    }
  }
}
```

**Why this configuration:**
- `--isolated`: Ephemeral contexts that don't accumulate
- `--headless`: No UI rendering overhead
- `@0.0.49`: Pinned version for stability
- `--no-sandbox`: Reduces memory (acceptable in controlled environments)
- `--timeout-action=30000`: Prevents hung processes

### Configuration B: Balanced (For Development)

For development workstations where you need visible browser:

```bash
claude mcp add playwright --scope local -- npx @playwright/mcp@latest \
  --isolated \
  --browser=chromium \
  --timeout-action=60000
```

**JSON equivalent:**
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--isolated",
        "--browser=chromium",
        "--timeout-action=60000"
      ]
    }
  }
}
```

### Configuration C: With Persistent Authentication

When you need to maintain login sessions across Claude Code restarts:

```bash
# Step 1: Save authentication state manually
npx playwright codegen --save-storage=~/.playwright-auth.json

# Step 2: Configure Claude with storage state
claude mcp add playwright --scope user -- npx @playwright/mcp@latest \
  --isolated \
  --headless \
  --storage-state=~/.playwright-auth.json
```

**JSON equivalent:**
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--isolated",
        "--headless",
        "--storage-state=/home/user/.playwright-auth.json"
      ]
    }
  }
}
```

### Configuration D: Windows-Specific

Windows requires cmd execution:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "@playwright/mcp@latest",
        "--isolated",
        "--headless",
        "--user-data-dir=./playwright-profile"
      ]
    }
  }
}
```

---

## Version Management

### Current Stable Version

As of December 2025, the latest stable version is **v0.0.49**.

### Version Pinning (Recommended)

Always pin to a specific version to avoid unexpected behavior changes:

```bash
# Pin to specific version
claude mcp add playwright -- npx @playwright/mcp@0.0.49

# NOT recommended (may introduce breaking changes)
claude mcp add playwright -- npx @playwright/mcp@latest
```

### Checking for Updates

```bash
# Check current npm version
npm view @playwright/mcp version

# Check installed version
npx @playwright/mcp@latest --version

# View changelog
# https://github.com/microsoft/playwright-mcp/releases
```

### Recent Version Notes (Memory-Related)

| Version | Notes |
|---------|-------|
| v0.0.49 | Maintenance release, stable |
| v0.0.48 | Restored `--allow-origins` flag |
| v0.0.47 | Initial state management improvements |
| v0.0.43 | Image size capping, incremental snapshots (reduces memory) |
| v0.0.40 | Video session management improvements |

### Updating Playwright MCP

```bash
# Remove old configuration
claude mcp remove playwright

# Add with new version
claude mcp add playwright -- npx @playwright/mcp@0.0.49 --isolated --headless

# Verify
claude mcp get playwright
```

---

## Troubleshooting

### Issue: Chrome Processes Accumulating

**Symptoms:** Multiple `chrome-headless` processes visible in `top` or Task Manager.

**Solutions:**

1. **Verify isolated mode is enabled:**
   ```bash
   claude mcp get playwright
   # Check if --isolated flag is present
   ```

2. **Reconfigure with isolated mode:**
   ```bash
   claude mcp remove playwright
   claude mcp add playwright -- npx @playwright/mcp@latest --isolated --headless
   ```

3. **Manual cleanup:**
   ```bash
   # Linux/macOS
   pkill -f "chrome-headless"

   # Windows
   taskkill /F /IM chrome.exe /T
   ```

### Issue: "Browser Already in Use" Error

**Symptoms:** Claude reports browser is locked or already in use.

**Solutions:**

1. **Kill existing browser processes:**
   ```bash
   pkill -9 -f "chrome|chromium"
   ```

2. **Restart Claude Code:**
   ```bash
   # Close Claude Code completely
   # Restart
   ```

3. **Use isolated mode** (each session gets fresh browser)

### Issue: Browser Installation Hangs

**Symptoms:** `npx @playwright/mcp` hangs during browser download.

**Solutions:**

1. **Pre-install browsers manually:**
   ```bash
   npx playwright install chromium
   ```

2. **Set browser path explicitly:**
   ```bash
   export PLAYWRIGHT_BROWSERS_PATH=/opt/playwright/browsers
   npx playwright install chromium
   ```

### Issue: High Memory Usage Even with Isolated Mode

**Solutions:**

1. **Use headless mode:**
   ```bash
   claude mcp add playwright -- npx @playwright/mcp@latest --isolated --headless
   ```

2. **Reduce viewport size:**
   ```bash
   claude mcp add playwright -- npx @playwright/mcp@latest --isolated --viewport-size=1024x768
   ```

3. **Implement periodic restart** (see [Server Configuration](#configuration-a-maximum-memory-protection-recommended-for-servers))

### Issue: Configuration Changes Not Taking Effect

**Solution:**
1. Completely close Claude Code
2. Kill any remaining processes:
   ```bash
   pkill -f "claude"
   pkill -f "chrome"
   ```
3. Restart Claude Code
4. Verify with: `claude mcp list`

---

## Configuration Examples

### Example 1: CI/CD Pipeline Configuration

For GitHub Actions or other CI systems:

```yaml
# .github/workflows/automation.yml
jobs:
  automate:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Playwright MCP
        run: |
          npm install -g @anthropic-ai/claude-code
          claude mcp add playwright -- npx @playwright/mcp@0.0.49 --isolated --headless --no-sandbox

      - name: Run automation
        run: |
          claude "Navigate to example.com and take a screenshot"
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Example 2: Docker Compose Configuration

```yaml
# docker-compose.yml
version: '3.8'
services:
  claude-automation:
    image: node:20
    init: true  # Critical for process cleanup
    ipc: host
    shm_size: 2gb
    environment:
      - PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
    volumes:
      - ./config/.claude.json:/root/.claude.json
    command: >
      sh -c "
        npm install -g @anthropic-ai/claude-code &&
        npx playwright install chromium &&
        claude mcp add playwright -- npx @playwright/mcp@0.0.49 --isolated --headless --no-sandbox &&
        tail -f /dev/null
      "
```

### Example 3: Team-Shared Configuration

Create `.mcp.json` in your project root and commit to version control:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@0.0.49",
        "--isolated",
        "--headless",
        "--timeout-action=30000"
      ],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

Team members clone the repo and run:
```bash
claude mcp add-from-file .mcp.json
```

### Example 4: Multi-Browser Configuration

For testing across different browsers:

```json
{
  "mcpServers": {
    "playwright-chrome": {
      "command": "npx",
      "args": ["@playwright/mcp@0.0.49", "--isolated", "--headless", "--browser=chromium"]
    },
    "playwright-firefox": {
      "command": "npx",
      "args": ["@playwright/mcp@0.0.49", "--isolated", "--headless", "--browser=firefox"]
    },
    "playwright-webkit": {
      "command": "npx",
      "args": ["@playwright/mcp@0.0.49", "--isolated", "--headless", "--browser=webkit"]
    }
  }
}
```

---

## Quick Reference Card

### Essential Commands

```bash
# Add Playwright MCP (recommended settings)
claude mcp add playwright -- npx @playwright/mcp@0.0.49 --isolated --headless

# List configured servers
claude mcp list

# Check server details
claude mcp get playwright

# Remove server
claude mcp remove playwright

# Verify available tools (inside Claude Code)
/mcp
```

### Key Flags for Memory Leak Prevention

```
--isolated     # Ephemeral contexts (MOST IMPORTANT)
--headless     # No UI overhead
--no-sandbox   # Reduces memory (controlled environments only)
@0.0.49        # Pin version for stability
```

### Cleanup Commands

```bash
# Linux/macOS: Kill orphaned Chrome processes
pkill -f "chrome-headless" && pkill -9 -f "chrome-headless"

# Windows: Kill Chrome processes
taskkill /F /IM chrome.exe /T

# Restart Claude Code after cleanup
```

---

## External References

### Official Documentation
- [Claude Code MCP Documentation](https://code.claude.com/docs/en/mcp)
- [Playwright MCP GitHub](https://github.com/microsoft/playwright-mcp)
- [Playwright MCP Releases](https://github.com/microsoft/playwright-mcp/releases)

### Community Resources
- [Using Playwright MCP with Claude Code - Simon Willison](https://til.simonwillison.net/claude-code/playwright-mcp-claude-code)
- [Playwright MCP Memory Leak Fixes 2025](https://markaicode.com/playwright-mcp-memory-leak-fixes-2025/)
- [How to Install Playwright MCP in Claude Code - GitHub Issue](https://github.com/microsoft/playwright-mcp/issues/534)

### Related Issues
- [microsoft/playwright-mcp#1111](https://github.com/microsoft/playwright-mcp/issues/1111) - Close tabs/browser not working
- [anthropics/claude-code#1383](https://github.com/anthropics/claude-code/issues/1383) - Playwright MCP frequently fails

---

## Summary

To prevent Chrome process memory leaks with Playwright MCP in Claude Code:

1. **Always use `--isolated` mode** - This is the single most important configuration
2. **Pin to a specific version** - Avoid `@latest` for stability
3. **Use `--headless`** for server environments
4. **Restart Claude Code periodically** for long-running sessions
5. **Implement cleanup cron jobs** on servers (see [03-SOLUTIONS.md](./03-SOLUTIONS.md))

The recommended configuration for most use cases:

```bash
claude mcp add playwright -- npx @playwright/mcp@0.0.49 --isolated --headless
```
