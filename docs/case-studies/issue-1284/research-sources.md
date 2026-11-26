# Research Sources for Issue #1284

This document contains all sources consulted during the investigation of Playwright MCP best practices for Claude Code CLI.

## Official Repositories

### Microsoft Playwright MCP

- **URL**: https://github.com/microsoft/playwright-mcp
- **Description**: Official Playwright MCP server by Microsoft
- **Key Information**:
  - Standard configuration for MCP clients
  - Extensive command-line arguments and environment variables
  - Browser control, context management, security options
  - Supports VS Code, Cursor, Claude Desktop, Windsurf, Cline

### Microsoft Playwright CLI

- **URL**: https://github.com/microsoft/playwright-cli
- **Description**: CLI for common Playwright actions with Skills support
- **Key Information**:
  - `playwright-cli install --skills` installs to `~/.skills/playwright-cli/`
  - 40+ commands across browser control, interaction, storage, network
  - Token-efficient approach for high-throughput agents

## Community Implementations

### ExecuteAutomation MCP-Playwright

- **URL**: https://github.com/executeautomation/mcp-playwright
- **Documentation**: https://executeautomation.github.io/mcp-playwright/docs/intro
- **Key Information**:
  - Alternative MCP server implementation
  - Smithery installation: `npx @smithery/cli install @executeautomation/playwright-mcp-server --client claude`
  - MCP-Get installation: `npx @michaellatman/mcp-get@latest install @executeautomation/playwright-mcp-server`

### lackeyjb/playwright-skill

- **URL**: https://github.com/lackeyjb/playwright-skill
- **Key Information**:
  - Claude Code Skill for browser automation
  - Model-invoked (Claude writes custom automation code)
  - Plugin marketplace installation supported
  - Includes helper functions and progressive documentation

## Tutorials and Guides

### Simon Willison's TIL

- **URL**: https://til.simonwillison.net/claude-code/playwright-mcp-claude-code
- **Key Insights**:
  - `claude mcp add` stores settings in `~/.claude.json`
  - Settings are directory-specific
  - Tip: Explicitly mention "playwright mcp" in first request
  - 25 tools available including navigation, interaction, inspection

### Supatest Playwright MCP Guide

- **URL**: https://supatest.ai/blog/playwright-mcp-setup-guide
- **Key Insights**:
  - Common issues: version mismatches, JSON configuration syntax
  - Solution: Use specific versions instead of @latest
  - Pre-install browsers manually
  - Clear instructions with step-by-step actions

### Testomat Blog

- **URL**: https://testomat.io/blog/playwright-mcp-claude-code/
- **Key Insights**:
  - Seven-stage workflow (setup, requirements, plan, generate, execute, analyze, iterate)
  - Limitations: Not for <100ms real-time, offline environments
  - Claude vs Copilot comparison for Playwright work

## Comparative Analysis Articles

### CosmicJS: MCP vs Skills

- **URL**: https://www.cosmicjs.com/blog/mcp-vs-skills-ai-coding-assistant-integrations-guide
- **Key Metrics**:
  - MCP: Real-time data, requires server, network dependent
  - Skills: Static, single command setup, zero latency, offline capable
  - Hybrid approach recommended for best results

### IntuitionLabs: Claude Skills vs MCP

- **URL**: https://intuitionlabs.ai/articles/claude-skills-vs-mcp
- **Key Metrics**:
  - MCP: 97+ million monthly SDK downloads, 10,000+ active servers (early 2026)
  - Skills: 87.5% faster report generation (Rakuten case)
  - Skills: Minimal token overhead, progressive disclosure
  - Convergence trend: MCP Apps introduced January 2026

### Medium: CLI-Agent vs MCP

- **URL**: https://medium.com/@girmish/cli-agent-vs-mcp-a-practical-comparison-for-students-startups-and-developers-2026-b9fe30a96559
- **Key Metrics**:
  - CLI won by 17 points in benchmarks
  - 33% token savings in developer tasks
  - Recommendation: CLI for learning/prototyping, MCP for production systems

## Medium Articles

### Kapil Kumar: Claude + Playwright MCP Server Setup

- **URL**: https://medium.com/@kapilkumar080/understanding-the-claude-playwright-mcp-server-setup-426a574cc232
- **Description**: Understanding the setup process for Claude with Playwright MCP

### ByteBridge: MCP vs Agent Skills

- **URL**: https://bytebridge.medium.com/model-context-protocol-mcp-vs-agent-skills-empowering-ai-agents-with-tools-and-expertise-3062acafd4f7
- **Description**: Comprehensive comparison of MCP and agent skills paradigms

## Anthropic Official Resources

### Code Execution with MCP

- **URL**: https://www.anthropic.com/engineering/code-execution-with-mcp
- **Key Information**:
  - Official Anthropic engineering blog post
  - MCP enables efficient context usage through on-demand tool loading
  - Data filtering before reaching the model
  - Complex logic execution in single steps

## Other Resources

### MCP Servers Catalog

- **URL**: https://mcpservers.org/claude-skills/lackeyjb/playwright-skill
- **Description**: Catalog of Claude Skills and MCP servers

### TestDino

- **URL**: https://testdino.com/blog/playwright-mcp-installation/
- **Description**: Installation guide for Playwright MCP on Claude Code

### DeepWiki

- **URL**: https://deepwiki.com/ziphell/playwright-cli/1.2-installation-and-setup
- **Description**: Documentation and setup guides for playwright-cli

### Madewithlove Blog

- **URL**: https://madewithlove.com/blog/claude-as-tester-using-playwright-and-github-mcp/
- **Description**: Using Claude as a tester with Playwright and GitHub MCP

## Claude Code Plugins Ecosystem (Added 2026-03-14)

### Claude Code Plugins Documentation

- **URL**: https://code.claude.com/docs/en/plugins
- **Key Information**:
  - Plugin system introduced in Claude Code v1.0.33+
  - Packages skills, agents, hooks, MCP servers into installable bundles
  - Distributed via Git-based marketplaces
  - Syntax: `/plugin install {name}@{marketplace}`

### Claude Code Plugin Discovery

- **URL**: https://code.claude.com/docs/en/discover-plugins
- **Key Information**:
  - Official marketplace `claude-plugins-official` is pre-configured
  - Demo marketplace at `anthropics/claude-code` must be added manually
  - Plugins can be scoped: user, project, or local
  - Auto-update available for marketplace plugins

### Official Playwright Plugin (claude-plugins-official)

- **URL**: https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/playwright
- **Key Information**:
  - Wraps the same `@playwright/mcp@latest` MCP server
  - By Microsoft, 102,750+ installs
  - Functionally identical to manual `claude mcp add playwright` approach
  - `.mcp.json` contains: `{"playwright": {"command": "npx", "args": ["@playwright/mcp@latest"]}}`

### Playwright Plugin Page (Anthropic)

- **URL**: https://claude.com/plugins/playwright
- **Key Information**:
  - Official listing on Claude plugin directory
  - Features: browser navigation, form filling, screenshots, PDF generation, test assertions
  - Uses accessibility tree (not vision/screenshots)

### Frontend Design Plugin

- **URL**: https://claude.com/plugins/frontend-design
- **GitHub**: https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design
- **Key Information**:
  - By Anthropic, 324,000+ installs
  - Design aesthetics skill (NOT related to Playwright)
  - Auto-activates for frontend development tasks
  - Guides bold typography, color palettes, animations, layouts

### Playwright Skill (Community) HN Discussion

- **URL**: https://news.ycombinator.com/item?id=45642911
- **Key Information**:
  - 314 lines of instructions vs persistent MCP server
  - Claude writes and executes Playwright code directly
  - Returns screenshots and console output
  - Best for "scriptable manual testing" during development
  - Not designed for CI/CD test suites

---

## Search Queries Used

1. "Playwright MCP Claude Code CLI best practices 2026"
2. "claude mcp add --tool playwright skills installation 2026"
3. "playwright-cli install --skills claude code 2026"
4. "@playwright/cli install --skills documentation 2026"
5. "MCP Model Context Protocol vs CLI Skills agent workflow comparison 2026"

6. "Claude Code plugins system plugin install frontend-design 2026"
7. "Claude Code plugin vs MCP playwright 2026"
8. "Claude Code /plugin install exact command syntax marketplace 2026"
9. "claude-plugins-official playwright external_plugins"

---

## Data Collection Date

- **Initial Date**: 2026-02-13
- **Updated**: 2026-03-14 (added Claude Code plugin ecosystem research)
- **Research Duration**: ~45 minutes (initial) + ~30 minutes (update)
- **Sources Consulted**: 20+ articles, 8+ repositories, 3+ comparative analyses
