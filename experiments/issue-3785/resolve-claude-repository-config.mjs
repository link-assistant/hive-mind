// Issue #3785: print the per-session Claude args a checkout's own configuration produces.
// Usage: node resolve-claude-repository-config.mjs <checkout>
import { resolveRepositoryClaudePluginArgs, readRepositoryMcpServers } from '../../src/claude-repository-config.lib.mjs';
const projectDir = process.argv[2];
const log = async message => console.error(message);
const plugins = await resolveRepositoryClaudePluginArgs({ projectDir, log });
console.log(JSON.stringify({ pluginArgs: plugins.args, mcp: await readRepositoryMcpServers({ projectDir }) }));
