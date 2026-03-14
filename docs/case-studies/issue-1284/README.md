# Case Study: Playwright MCP Best Practices for Claude Code CLI

## Issue Reference

- **Issue**: https://github.com/link-assistant/hive-mind/issues/1284
- **Date**: 2026-02-13
- **Tags**: documentation, enhancement, question
- **Author**: konard

## Executive Summary

This case study investigates the best practices for using Playwright with Claude Code CLI, comparing available approaches:

1. **MCP (Model Context Protocol)**: `claude mcp add playwright npx @playwright/mcp@latest`
2. **CLI + Skills**: `playwright-cli install --skills`
3. **Official Playwright Plugin** (2026-03): `/plugin install playwright@claude-plugins-official`
4. **Community Playwright Skill Plugin**: `lackeyjb/playwright-skill`

Our research concludes that **multiple approaches have valid use cases**, and the optimal choice depends on the specific workflow requirements. For most Claude Code CLI users, the **official Playwright plugin is now the simplest recommended default** (wraps the same MCP server). The community Playwright Skill plugin offers a complementary, more token-efficient approach for scriptable manual testing. The `frontend-design` plugin is unrelated to Playwright — it's a design aesthetics skill.

---

## The Question

The issue asks:

> Do we actually use all these with `--tool claude`? Is there any better practices in the internet?
>
> ```
> playwright-cli install --skills
> claude mcp add playwright npx @playwright/mcp@latest
> ```

### Analysis of the Commands

1. **`playwright-cli install --skills`**: This command installs Skills documentation files to `~/.skills/playwright-cli/` for coding agents to understand and use playwright-cli commands efficiently.

2. **`claude mcp add playwright npx @playwright/mcp@latest`**: This command registers the official Microsoft Playwright MCP server with Claude Code, enabling browser automation tools.

**Important Clarification**: The `--tool claude` flag is **not a valid flag** for either command. The commands mentioned in the issue work independently.

---

## Two Approaches: MCP vs CLI + Skills

### Approach 1: Playwright MCP Server (Recommended for Most Users)

**Installation**:

```bash
claude mcp add playwright npx @playwright/mcp@latest
```

**How it works**:

- Registers the official Microsoft Playwright MCP server with Claude Code
- Provides 25+ browser automation tools directly accessible to Claude
- Uses the Model Context Protocol standard developed by Anthropic

**Key Features**:

- Real-time browser control through accessibility snapshots
- Visible browser window for authentication and debugging
- Session persistence with cookies and local storage
- Extensive configuration options (headless mode, viewport, proxy, etc.)

**Available Tools** (partial list):

- `browser_navigate`, `browser_navigate_back`
- `browser_click`, `browser_type`, `browser_drag`
- `browser_take_screenshot`, `browser_snapshot`
- `browser_fill_form`, `browser_select_option`
- `browser_wait_for`, `browser_tabs`
- `browser_evaluate`, `browser_run_code`

### Approach 2: Playwright CLI + Skills

**Installation**:

```bash
npm install -g @playwright/cli@latest
playwright-cli install --skills
```

**How it works**:

- Installs Skills documentation to `~/.skills/playwright-cli/`
- Claude Code reads these skill files for command understanding
- CLI commands are invoked directly without an MCP server

**Key Features**:

- More token-efficient (avoids loading large tool schemas)
- Works offline with static documentation
- 40+ CLI commands across browser control, interaction, storage, network
- Session management for parallel workflows

---

## Comparative Analysis

### Feature Comparison

| Feature               | MCP Approach               | CLI + Skills Approach         |
| --------------------- | -------------------------- | ----------------------------- |
| **Setup Complexity**  | Low (single command)       | Medium (two commands)         |
| **Token Efficiency**  | Lower (loads tool schemas) | Higher (33% savings reported) |
| **Real-time Control** | Yes                        | Yes                           |
| **Offline Support**   | No                         | Yes (Skills are static)       |
| **Tool Discovery**    | Automatic                  | Via `--help` or Skills docs   |
| **Maintenance**       | Automatic with @latest     | Manual CLI updates            |
| **Authentication**    | Easy (visible browser)     | Same capability               |
| **CI/CD Integration** | Good                       | Better                        |

### Performance Metrics

According to benchmarks and research:

- **MCP**: Provides "70% memory reduction" through accessibility trees vs screenshots
- **CLI + Skills**: Offers "33% token savings" in developer tasks due to avoided schema loading

### Use Case Recommendations

**Choose MCP when**:

- You want the simplest setup
- You need real-time browser interaction
- You're doing exploratory testing or debugging
- Authentication through visible browser is valuable
- You prefer automatic tool discovery

**Choose CLI + Skills when**:

- Token efficiency is critical (large codebases)
- You need offline capability
- CI/CD pipeline integration is important
- You want explicit control over commands
- High-throughput automation is required

---

## Best Practices

### For MCP Approach

1. **Installation**:

   ```bash
   # Global (affects all directories)
   claude mcp add -s user playwright npx '@playwright/mcp@latest'

   # Project-specific
   claude mcp add playwright npx '@playwright/mcp@latest'
   ```

2. **First Usage**: Explicitly mention "playwright mcp" in your first request:

   > "Use playwright mcp to open a browser to example.com"

3. **Configuration Options**:

   ```bash
   # Headless mode for CI
   claude mcp add playwright npx @playwright/mcp@latest -- --headless

   # Specific browser
   claude mcp add playwright npx @playwright/mcp@latest -- --browser firefox

   # Custom viewport
   claude mcp add playwright npx @playwright/mcp@latest -- --viewport-size 1920x1080
   ```

4. **Pre-install browsers** (recommended):

   ```bash
   npx playwright install
   npx playwright install-deps  # Linux
   ```

5. **Authentication Strategy**: Let Claude show you the login page, authenticate manually, then continue automation.

### For CLI + Skills Approach

1. **Installation**:

   ```bash
   npm install -g @playwright/cli@latest
   playwright-cli install --skills
   ```

2. **Skills Location**: `~/.skills/playwright-cli/`
   - `SKILL.md`: Primary documentation
   - `references/*.md`: Detailed guides for specific tasks

3. **Session Management**: Use `-s=name` flags for parallel isolated sessions.

### Security Best Practices (Both Approaches)

1. **Permission Awareness**: MCP servers execute with user permissions
2. **Isolated Environments**: Use dedicated test environments
3. **Audit Commands**: Review AI-generated automation before production use
4. **Version Pinning**: Consider using specific versions instead of @latest in production

---

## Alternative Solutions & Libraries

### 1. ExecuteAutomation's MCP-Playwright

**Repository**: https://github.com/executeautomation/mcp-playwright

**Installation**:

```bash
npx @smithery/cli install @executeautomation/playwright-mcp-server --client claude
```

**Features**: Extended MCP implementation with additional automation capabilities.

### 2. lackeyjb/playwright-skill

**Repository**: https://github.com/lackeyjb/playwright-skill

**Installation**:

```bash
/plugin marketplace add lackeyjb/playwright-skill
/plugin install playwright-skill@playwright-skill
cd ~/.claude/plugins/marketplaces/playwright-skill/skills/playwright-skill
npm run setup
```

**Features**: Model-invoked skill where Claude autonomously writes and executes custom Playwright code.

### 3. Hybrid Approach

For production environments, consider combining both:

```bash
# MCP for real-time interactive debugging
claude mcp add playwright npx @playwright/mcp@latest

# Skills for efficient scripted automation
npm install -g @playwright/cli@latest
playwright-cli install --skills
```

---

## Configuration Files

### Claude MCP Configuration (~/.claude.json)

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

### With Options

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless", "--browser", "chromium", "--viewport-size", "1280x720"]
    }
  }
}
```

### Environment Variables

The MCP server also supports environment variables:

- `PLAYWRIGHT_MCP_BROWSER`: Browser type
- `PLAYWRIGHT_MCP_HEADLESS`: Enable headless mode
- `PLAYWRIGHT_MCP_ALLOWED_HOSTS`: Restrict accessible hosts

---

## Troubleshooting

### Common Issues

| Issue                           | Solution                                       |
| ------------------------------- | ---------------------------------------------- |
| Claude uses Bash instead of MCP | Explicitly mention "playwright mcp" in request |
| Browser not found               | Run `npx playwright install`                   |
| Permission errors               | Pre-install browsers before running MCP        |
| Version conflicts               | Use specific version instead of @latest        |
| Configuration not applied       | Restart Claude Code after changes              |

### WSL/Linux Setup

```bash
sudo apt-get update
sudo apt-get install -y chromium-browser
export CHROME_BIN=/usr/bin/chromium-browser
```

---

## Conclusion

### Recommended Default Setup

For most Claude Code CLI users, we recommend:

```bash
# Primary: MCP approach (simplest, most integrated)
claude mcp add playwright npx @playwright/mcp@latest

# Pre-install browsers
npx playwright install
```

### For High-Performance/Production Environments

```bash
# CLI + Skills for token efficiency
npm install -g @playwright/cli@latest
playwright-cli install --skills

# Plus MCP for interactive debugging
claude mcp add playwright npx @playwright/mcp@latest
```

### Key Takeaways

1. **No `--tool claude` flag exists** - the commands in the issue work independently
2. **MCP is simpler** for most users and recommended by official documentation
3. **CLI + Skills is more token-efficient** for high-throughput scenarios
4. **Both approaches are valid** and can be used together
5. **Pre-installing browsers** is a best practice for both approaches

---

## Update (2026-03-14): Claude Code Plugins Ecosystem

### Background

Claude Code introduced a **plugin system** (v1.0.33+) that packages skills, agents, hooks, and MCP servers into installable, shareable bundles distributed via Git-based marketplaces. This section addresses the follow-up questions about how Claude Code plugins relate to Playwright MCP.

### Three Approaches to Playwright in Claude Code (2026)

There are now **three** distinct approaches for using Playwright with Claude Code:

| #   | Approach                                     | Installation                                                                                                 | How It Works                                                        |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1   | **Playwright MCP** (manual)                  | `claude mcp add playwright npx @playwright/mcp@latest`                                                       | Registers Microsoft's MCP server directly in `~/.claude.json`       |
| 2   | **Playwright Plugin** (official marketplace) | `/plugin install playwright@claude-plugins-official`                                                         | Installs the same MCP server, but packaged as a plugin              |
| 3   | **Playwright Skill** (community)             | `/plugin marketplace add lackeyjb/playwright-skill` then `/plugin install playwright-skill@playwright-skill` | Claude writes and executes Playwright code directly (no MCP server) |

### Approach 2: Official Playwright Plugin (Details)

The **official Playwright plugin** in `claude-plugins-official` (102,750+ installs, by Microsoft) is a thin wrapper around the same `@playwright/mcp@latest` MCP server. Its `plugin.json`:

```json
{
  "name": "playwright",
  "description": "Browser automation and end-to-end testing MCP server by Microsoft. Enables Claude to interact with web pages, take screenshots, fill forms, click elements, and perform automated browser testing workflows.",
  "author": { "name": "Microsoft" }
}
```

Its `.mcp.json`:

```json
{
  "playwright": {
    "command": "npx",
    "args": ["@playwright/mcp@latest"]
  }
}
```

**Key insight**: Approaches 1 and 2 are functionally identical — the plugin simply provides a managed installation experience via the plugin system. The underlying MCP server is the same.

### Approach 3: Playwright Skill Plugin (Details)

The **community Playwright Skill** by [lackeyjb](https://github.com/lackeyjb/playwright-skill) takes a fundamentally different approach:

- **Instead of MCP tools**: Claude writes custom Playwright code and executes it
- **Returns**: Screenshots and console output (not accessibility tree snapshots)
- **Token usage**: ~314 lines of skill instructions vs. a persistent MCP server
- **Best for**: "Scriptable manual testing" during local development — quick validation like "does my new feature work?"
- **Not designed for**: Comprehensive CI/CD test suites

Installation:

```bash
/plugin marketplace add lackeyjb/playwright-skill
/plugin install playwright-skill@playwright-skill
cd ~/.claude/plugins/marketplaces/playwright-skill/skills/playwright-skill
npm run setup
```

### Frontend-Design Plugin: NOT Related to Playwright

The `frontend-design` plugin (by Anthropic, 324,000+ installs) is a **design aesthetics skill** that helps Claude create visually distinctive UI code. It has **no Playwright dependency** and **no browser automation capability**. It auto-activates when Claude detects frontend development tasks and guides bold design choices (typography, color, animation, layout).

### Correct Plugin Install Commands

The commands mentioned in the PR comment are **not correct**. Here are the correct commands:

| Incorrect Command                                        | Correct Alternative                                       |
| -------------------------------------------------------- | --------------------------------------------------------- |
| `claude plugin install @anthropic/frontend-design`       | `/plugin install frontend-design@claude-plugins-official` |
| `/plugin install frontend-design@anthropics-claude-code` | `/plugin install frontend-design@claude-plugins-official` |

**Correct syntax**: `/plugin install {plugin-name}@{marketplace-name}`

The official Anthropic marketplace is `claude-plugins-official` (pre-configured, no need to add it). The demo marketplace at `anthropics/claude-code` must be added first with `/plugin marketplace add anthropics/claude-code`.

### Can Playwright MCP and Playwright Plugin Coexist?

**Yes, but they shouldn't be used simultaneously.** Since the official Playwright plugin wraps the same MCP server, running both would create a duplicate `playwright` MCP registration. Choose one:

| Scenario                                           | Recommended Approach                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| Simple setup, want managed updates                 | `/plugin install playwright@claude-plugins-official`                 |
| Custom MCP arguments (headless, viewport, browser) | `claude mcp add playwright npx @playwright/mcp@latest -- --headless` |
| Token-efficient scriptable testing                 | `/plugin install playwright-skill@playwright-skill` (community)      |
| Maximum flexibility                                | MCP (manual) + Playwright Skill plugin (these are complementary)     |

**The MCP-based approaches (1 and 2) and the Skill approach (3) CAN coexist** because they use different mechanisms:

- MCP: Provides browser automation tools that Claude calls
- Skill: Provides instructions that Claude uses to write and execute Playwright scripts directly

### Plugin Management Commands

```bash
# List installed plugins
/plugin list

# Browse available plugins interactively
/plugin

# Install from official marketplace (pre-configured)
/plugin install playwright@claude-plugins-official
/plugin install frontend-design@claude-plugins-official

# Add a third-party marketplace
/plugin marketplace add lackeyjb/playwright-skill

# Install from third-party marketplace
/plugin install playwright-skill@playwright-skill

# Disable/enable/remove plugins
/plugin disable playwright@claude-plugins-official
/plugin enable playwright@claude-plugins-official
/plugin uninstall playwright@claude-plugins-official

# Reload after changes
/reload-plugins
```

### Updated Recommendations (2026-03)

For most users, the simplest path is now:

```bash
# Install official Playwright plugin (wraps MCP server)
/plugin install playwright@claude-plugins-official

# Pre-install browsers
npx playwright install
```

For advanced users wanting both MCP tools AND efficient scripted testing:

```bash
# Option A: Official plugin for MCP tools
/plugin install playwright@claude-plugins-official

# Option B: Community skill for script-based testing
/plugin marketplace add lackeyjb/playwright-skill
/plugin install playwright-skill@playwright-skill
cd ~/.claude/plugins/marketplaces/playwright-skill/skills/playwright-skill
npm run setup
```

For frontend design quality (unrelated to Playwright):

```bash
/plugin install frontend-design@claude-plugins-official
```

---

## References

### Official Documentation

- [Microsoft Playwright MCP Repository](https://github.com/microsoft/playwright-mcp)
- [Microsoft Playwright CLI Repository](https://github.com/microsoft/playwright-cli)
- [Anthropic Model Context Protocol](https://www.anthropic.com/engineering/code-execution-with-mcp)

### Tutorials & Guides

- [Simon Willison: Using Playwright MCP with Claude Code](https://til.simonwillison.net/claude-code/playwright-mcp-claude-code)
- [Supatest: Playwright MCP Setup Guide](https://supatest.ai/blog/playwright-mcp-setup-guide)
- [Testomat: Playwright MCP Claude Code](https://testomat.io/blog/playwright-mcp-claude-code/)

### Comparative Analysis

- [CosmicJS: MCP vs Skills Guide](https://www.cosmicjs.com/blog/mcp-vs-skills-ai-coding-assistant-integrations-guide)
- [IntuitionLabs: Claude Skills vs MCP](https://intuitionlabs.ai/articles/claude-skills-vs-mcp)
- [CLI-Agent vs MCP Practical Comparison](https://medium.com/@girmish/cli-agent-vs-mcp-a-practical-comparison-for-students-startups-and-developers-2026-b9fe30a96559)

### Claude Code Plugins Documentation

- [Create plugins - Claude Code Docs](https://code.claude.com/docs/en/plugins)
- [Discover and install plugins - Claude Code Docs](https://code.claude.com/docs/en/discover-plugins)
- [Frontend Design Plugin (GitHub)](https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design)
- [Frontend Design Plugin (Official)](https://claude.com/plugins/frontend-design)
- [Playwright Plugin (Official)](https://claude.com/plugins/playwright)
- [Playwright Plugin Source (claude-plugins-official)](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/playwright)

### Alternative Implementations

- [ExecuteAutomation MCP-Playwright](https://github.com/executeautomation/mcp-playwright)
- [lackeyjb/playwright-skill](https://github.com/lackeyjb/playwright-skill)
- [Playwright Skill HN Discussion](https://news.ycombinator.com/item?id=45642911)
