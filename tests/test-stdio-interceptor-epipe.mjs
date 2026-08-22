#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const libPath = path.join(repoRoot, 'src', 'lib.mjs');
const useMBootstrapPath = pathToFileURL(path.join(repoRoot, 'src', 'use-m-bootstrap.lib.mjs')).href;

const runBrokenPipeCase = streamName => {
  const childScript = `
    import os from 'os';
    import path from 'path';

    const stream = process.${streamName};
    let writes = 0;
    stream.write = function () {
      writes += 1;
      const error = new Error('write EPIPE');
      error.code = 'EPIPE';
      throw error;
    };

    const { ensureUseM } = await import(${JSON.stringify(useMBootstrapPath)});
    await ensureUseM();
    const { setLogFile, setupStdioLogInterceptor } = await import(${JSON.stringify(libPath)});
    setLogFile(path.join(os.tmpdir(), 'stdio-interceptor-${streamName}.log'));
    setupStdioLogInterceptor();

    if (${JSON.stringify(streamName)} === 'stdout') {
      console.log('stdout still safe');
    } else {
      console.error('stderr still safe');
    }

    if (writes === 0) {
      throw new Error('Expected broken pipe write to be attempted');
    }
  `;

  return spawnSync(process.execPath, ['--input-type=module', '--eval', childScript], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
};

const assertPass = (condition, message, details = '') => {
  if (condition) {
    console.log(`✅ ${message}`);
    return;
  }

  console.error(`❌ ${message}`);
  if (details) {
    console.error(details);
  }
  process.exitCode = 1;
};

console.log('Testing stdio interceptor broken pipe handling...\n');

for (const streamName of ['stdout', 'stderr']) {
  const result = runBrokenPipeCase(streamName);
  const details = [`exit=${result.status}`, result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
  assertPass(result.status === 0, `${streamName} EPIPE is swallowed cleanly`, details);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
