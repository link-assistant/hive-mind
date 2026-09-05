import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { prepareFormalAiRuntime, resetFormalAiRuntimeCache } from '../../src/formal-ai-runtime.lib.mjs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'formal-ai-version-probe-'));
let requests = 0;
const server = createServer((request, response) => {
  requests++;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ version: '0.346.0', memory: { compatible: true } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let runtime;
try {
  runtime = await prepareFormalAiRuntime({
    tool: 'agent',
    workdir: home,
    env: { HIVE_MIND_FORMAL_AI_BASE_URL: `http://127.0.0.1:${server.address().port}`, HIVE_MIND_FORMAL_AI_HOME_ROOT: home },
    log: async message => console.log(message),
    deps: {
      readVersionImpl: async () => '0.339.1',
      mkdtempImpl: async () => home,
      loadRegistryImpl: async () => [{ id: 'agent', global_configs: [] }],
      seedImpl: async () => [],
      configureImpl: async () => {},
    },
  });
  console.log(JSON.stringify({ localWrapperVersion: '0.339.1', actualServerVersion: '0.346.0', reportedRuntimeVersion: runtime.formalAiVersion, serverRequests: requests }, null, 2));
  assert.equal(runtime.formalAiVersion, '0.346.0', 'remote model provenance must identify the server that answers the request');
} finally {
  await runtime?.stop();
  resetFormalAiRuntimeCache();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(home, { recursive: true, force: true });
}
