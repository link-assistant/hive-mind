// Generate a stock-skills manifest from a clean, credential-free app-server.
// Usage: node experiments/issue-4169/probe-stock-codex.mjs VERSION [CODEX_PATH]
import console from 'node:console';
import process from 'node:process';
import { readCodexStockManifest } from '../../src/codex-runtime-probe.lib.mjs';
import { locateNativeCommand } from '../../src/native-agent-command.lib.mjs';

const [version, command = 'codex'] = process.argv.slice(2);
if (!version) throw new Error('Supply the expected Codex version.');
const entrypoint = await locateNativeCommand(command, process.env.PATH);
const { cliVersion, files } = await readCodexStockManifest({ entrypoint, version });
const sortedFiles = Object.fromEntries(
  Object.keys(files)
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map(file => [file, files[file]])
);
console.log(JSON.stringify({ cliVersion, files: sortedFiles }, null, 2));
