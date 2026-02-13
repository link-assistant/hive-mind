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

---

## Search Queries Used

1. "Playwright MCP Claude Code CLI best practices 2026"
2. "claude mcp add --tool playwright skills installation 2026"
3. "playwright-cli install --skills claude code 2026"
4. "@playwright/cli install --skills documentation 2026"
5. "MCP Model Context Protocol vs CLI Skills agent workflow comparison 2026"

---

## Data Collection Date

- **Date**: 2026-02-13
- **Research Duration**: ~45 minutes
- **Sources Consulted**: 15+ articles, 5+ repositories, 3+ comparative analyses
