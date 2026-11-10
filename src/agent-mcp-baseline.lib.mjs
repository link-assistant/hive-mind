/** Validate the Playwright registration itself, rather than trusting its name.
 * This checks the image's supported command shape; executable/package integrity
 * and effective native discovery paths require separate runtime attestation.
 */
const sharedKeys = ['command', 'args', 'env'];
const keysByTool = {
  claude: new Set([...sharedKeys, 'type']),
  codex: new Set([...sharedKeys, 'env_vars', 'startup_timeout_sec', 'tool_timeout_sec', 'enabled', 'required', 'enabled_tools', 'disabled_tools']),
};
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
const emptyRecord = value => record(value) && Object.keys(value).length === 0;
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string' && item.length <= 256);
const packageName = /^@playwright\/mcp(?:@(?:latest|\d+\.\d+\.\d+))?$/u;

function approvedArguments(args) {
  if (!strings(args) || args.length > 32) return false;
  let index = ['-y', '--yes', '--no-install'].includes(args[0]) ? 1 : 0;
  if (!packageName.test(args[index++] ?? '')) return false;
  const seen = new Set();
  while (index < args.length) {
    const [flag, ...inline] = args[index++].split('=');
    if (seen.has(flag) || inline.length > 1) return false;
    seen.add(flag);
    if (['--isolated', '--headless', '--no-sandbox'].includes(flag)) {
      if (inline.length) return false;
    } else if (['--timeout-action', '--viewport-size'].includes(flag)) {
      const value = inline.length ? inline[0] : args[index++];
      if (flag === '--timeout-action' ? !/^[1-9]\d{0,6}$/u.test(value ?? '') : !/^[1-9]\d{1,4}x[1-9]\d{1,4}$/u.test(value ?? '')) return false;
    } else return false;
  }
  return true;
}

export function assertApprovedPlaywrightRegistration(server, tool) {
  let valid = record(server) && Object.keys(server).every(key => keysByTool[tool]?.has(key)) && server.command === 'npx' && approvedArguments(server.args);
  if (valid) {
    if (server.env !== undefined && !emptyRecord(server.env)) valid = false;
    if (tool === 'claude' && server.type !== undefined && server.type !== 'stdio') valid = false;
    if (tool === 'codex') {
      if (server.env_vars !== undefined && (!Array.isArray(server.env_vars) || server.env_vars.length)) valid = false;
      for (const key of ['startup_timeout_sec', 'tool_timeout_sec']) {
        if (server[key] !== undefined && (typeof server[key] !== 'number' || !Number.isFinite(server[key]) || server[key] <= 0 || server[key] > 3600)) valid = false;
      }
      for (const key of ['enabled', 'required']) if (server[key] !== undefined && typeof server[key] !== 'boolean') valid = false;
      for (const key of ['enabled_tools', 'disabled_tools']) if (server[key] !== undefined && !strings(server[key])) valid = false;
    }
  }
  // Never echo an untrusted command, argument, URL or environment value.
  if (!valid) throw new Error('Global Playwright MCP registration is not approved; no repair is permitted. Inspect its command, arguments, transport and environment.');
}
