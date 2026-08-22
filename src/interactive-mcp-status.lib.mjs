const PLAYWRIGHT_TOOL_PREFIX = 'mcp__playwright__';

// A `pending` (or `connecting`) MCP server is still being connected/reconnected
// in the background. It is NOT a failure: Claude Code enables Tool Search by
// default, so MCP tools are deferred and load on demand, and Claude waits for a
// still-connecting server before it uses one of that server's tools. See
// https://code.claude.com/docs/en/mcp and issue #1901.
export const isConnectingMcpStatus = status => /\b(pending|connecting)\b/i.test(String(status || ''));

// Terminal/unhealthy states where the MCP client has given up (or the server is
// turned off). Claude Code reconnects an HTTP/SSE server with exponential
// backoff and only marks it `failed` after the attempts are exhausted; at that
// point the server's tools never load.
export const isFailedMcpStatus = status => {
  const normalized = String(status || '').toLowerCase();
  return /\b(disabled|failed|error|disconnected|not[-_\s]+connected|unavailable|timed[-_\s]+out)\b|(?:^|[^a-z0-9_-])timeout(?:$|[^a-z0-9_-])/.test(normalized);
};

// Backwards-compatible umbrella: any non-connected status (still connecting OR
// failed). Prefer the narrower helpers above when the connecting/failed
// distinction matters (e.g. whether to warn a human reviewer).
export const isUnavailableMcpStatus = status => isConnectingMcpStatus(status) || isFailedMcpStatus(status);

export const hasPlaywrightMcpTools = tools => (Array.isArray(tools) ? tools : []).some(tool => String(tool || '').startsWith(PLAYWRIGHT_TOOL_PREFIX));

export const formatInteractiveMcpServerStatus = server => {
  const name = server?.name || 'unknown';
  const status = String(server?.status || 'unknown').trim() || 'unknown';
  let displayStatus = status;

  if (isConnectingMcpStatus(status)) {
    displayStatus = `${status} - connecting; tools load on demand via Tool Search`;
  } else if (isFailedMcpStatus(status)) {
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
    // With Tool Search the deferred `mcp__playwright__*` tools are intentionally
    // absent from system.init `tools`, so their absence is not a problem by
    // itself. If they are already present the server is fully connected.
    if (hasPlaywrightMcpTools(tools)) continue;
    // `pending`/`connecting` is the normal startup state — Claude waits for the
    // server before using a browser tool — so only warn when the MCP client has
    // actually failed to connect.
    if (!isFailedMcpStatus(server?.status)) continue;

    diagnostics.push(`⚠️ Playwright MCP server is ${server?.status || 'unknown'} (failed to connect), so no \`${PLAYWRIGHT_TOOL_PREFIX}*\` browser tools are available. Browser automation stays disabled until the MCP server connects.`);
  }

  return diagnostics;
};

export const formatInteractiveMcpServersList = (mcpServers = []) => {
  const servers = Array.isArray(mcpServers) ? mcpServers : [];
  return servers.length > 0 ? servers.map(formatInteractiveMcpServerStatus).join(', ') : '_None_';
};
