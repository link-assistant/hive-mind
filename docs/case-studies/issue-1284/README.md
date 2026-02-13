# Case Study: Playwright MCP Best Practices for Claude Code CLI

## Issue Reference

- **Issue**: https://github.com/link-assistant/hive-mind/issues/1284
- **Date**: 2026-02-13
- **Tags**: documentation, enhancement, question
- **Author**: konard

## Executive Summary

This case study investigates the best practices for using Playwright with Claude Code CLI, comparing two primary approaches:

1. **MCP (Model Context Protocol)**: `claude mcp add playwright npx @playwright/mcp@latest`
2. **CLI + Skills**: `playwright-cli install --skills`

Our research concludes that **both approaches have valid use cases**, and the optimal choice depends on the specific workflow requirements. For most Claude Code CLI users, the **MCP approach is currently the recommended default**, while the CLI + Skills approach offers advantages for high-throughput, token-efficient scenarios.

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

### Alternative Implementations

- [ExecuteAutomation MCP-Playwright](https://github.com/executeautomation/mcp-playwright)
- [lackeyjb/playwright-skill](https://github.com/lackeyjb/playwright-skill)
