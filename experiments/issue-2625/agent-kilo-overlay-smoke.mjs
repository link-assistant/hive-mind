// Run the real Agent CLI with the provider entry Hive Mind supplies for its
// default free model (issue #2625). Needs network; no API key.
//   node experiments/issue-2625/agent-kilo-overlay-smoke.mjs [agent-version]
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAgentModelOverlayEnv } from '../../src/agent-model-overlay.lib.mjs';
import { defaultModels } from '../../src/models/catalog.mjs';
import { mapModelForTool } from '../../src/models/index.mjs';

const version = process.argv[2] || '0.26.11';
const model = mapModelForTool('agent', defaultModels.agent);
const env = { ...process.env, ...getAgentModelOverlayEnv({ env: process.env, mappedModel: model }) };
const cwd = mkdtempSync(join(tmpdir(), 'agent-overlay-'));
const result = spawnSync('npx', ['-y', `@link-assistant/agent@${version}`, '--model', model, '-p', 'Reply with exactly: hello', '--no-summarize-session', '--no-generate-title'], { cwd, env, encoding: 'utf8', timeout: 240_000 });
const output = `${result.stdout}${result.stderr}`;
const reply = output.match(/"text":\s*"(hello[^"]*)"/i)?.[1];
console.log(JSON.stringify({ model, version, exit: result.status, reply: reply ?? null, notFound: /not found in provider/.test(output), freeTierError: /FreeTierError/.test(output) }));
process.exitCode = result.status === 0 && reply ? 0 : 1;
