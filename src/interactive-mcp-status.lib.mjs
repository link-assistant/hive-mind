const PLAYWRIGHT_TOOL_PREFIX = 'mcp__playwright__';

export const isUnavailableMcpStatus = status => {
  const normalized = String(status || '').toLowerCase();
  return /\b(pending|disabled|failed|error|disconnected|not[-_\s]+connected|unavailable|timeout|timed[-_\s]+out)\b/.test(normalized);
};

export const hasPlaywrightMcpTools = tools => (Array.isArray(tools) ? tools : []).some(tool => String(tool || '').startsWith(PLAYWRIGHT_TOOL_PREFIX));

export const formatInteractiveMcpServerStatus = server => {
  const name = server?.name || 'unknown';
  const status = String(server?.status || 'unknown').trim() || 'unknown';
  const normalizedStatus = status.toLowerCase();
  let displayStatus = status;

  if (normalizedStatus === 'pending') {
    displayStatus = 'pending - not connected; MCP tools unavailable';
  } else if (isUnavailableMcpStatus(status)) {
    displayStatus = `${status} - MCP tools unavailable`;
  }

  return `\`${name}\` (${displayStatus})`;
};

export const getInteractiveMcpDiagnostics = (mcpServers = [], tools = []) => {
  const servers = Array.isArray(mcpServers) ? mcpServers : [];
  const diagnostics = [];

  for (const server of servers) {
    const name = String(server?.name || '').toLowerCase();
    if (!name.includes('playwright')) continue;
    if (!isUnavailableMcpStatus(server?.status)) continue;
    if (hasPlaywrightMcpTools(tools)) continue;

    diagnostics.push(`⚠️ Playwright MCP server is ${server?.status || 'unknown'}, but no \`${PLAYWRIGHT_TOOL_PREFIX}*\` browser tools were exposed. Browser automation hints are disabled until the MCP client reports the server as connected.`);
  }

  return diagnostics;
};

export const formatInteractiveMcpServersList = (mcpServers = []) => {
  const servers = Array.isArray(mcpServers) ? mcpServers : [];
  return servers.length > 0 ? servers.map(formatInteractiveMcpServerStatus).join(', ') : '_None_';
};
