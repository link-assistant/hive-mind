---
'@link-assistant/hive-mind': minor
---

Add Figma Developer MCP preinstallation for Claude and agent commands

- Add `figma-developer-mcp` npm package installation to `scripts/ubuntu-24-server-install.sh`
- Add Figma MCP configuration to Claude CLI with FIGMA_API_KEY environment variable support
- Add Figma MCP installation to `coolify/Dockerfile` for production deployments
- Add Figma MCP installation to `.gitpod.Dockerfile` for Gitpod environments
- Add `FIGMA_API_KEY` passthrough to `docker-compose.yml`
- Add MCP Servers section to installation summary

Reference: https://github.com/GLips/Figma-Context-MCP
