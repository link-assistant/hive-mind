/* global AbortSignal, console, process */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

for (const args of [['mcp', 'list'], ['debug', 'models', '--bundled'], ['app-server']]) {
  const home = await mkdtemp(path.join(tmpdir(), 'hive-codex-stock-'));
  const child = spawn('codex', ['-c', 'features.remote_plugin=false', '-c', 'features.plugins=false', '-c', 'features.apps=false', ...args], {
    cwd: home,
    env: { HOME: home, CODEX_HOME: home, PATH: process.env.PATH, TOKIO_WORKER_THREADS: '2' },
    stdio: ['pipe', 'pipe', 'ignore'],
    signal: AbortSignal.timeout(10_000),
  });
  try {
    const closed = once(child, 'close');
    if (args[0] === 'app-server') {
      const lines = createInterface({ input: child.stdout });
      child.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'stock-probe', version: '1.0.0' } } })}\n`);
      for await (const line of lines) {
        const response = JSON.parse(line);
        if (response.id === 1) child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n${JSON.stringify({ id: 2, method: 'skills/list', params: { cwds: [home], forceReload: true } })}\n`);
        if (response.id === 2) {
          console.log(JSON.stringify(response.result?.data?.[0]?.skills?.map(({ name, scope }) => ({ name, scope }))));
          lines.close();
          child.stdin.end();
          break;
        }
      }
      child.kill();
    } else {
      child.stdout.resume();
    }
    const files = await readdir(path.join(home, 'skills/.system')).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    console.log(args.join(' '), await closed, files.sort());
  } finally {
    child.kill();
    await rm(home, { recursive: true, force: true });
  }
}
