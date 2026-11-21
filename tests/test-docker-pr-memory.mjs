#!/usr/bin/env node

/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-docker-pr-memory-'));
try {
  const bin = path.join(fixture, 'bin');
  fs.mkdirSync(bin);
  const mock = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const name = path.basename(process.argv[1]);
let args = process.argv.slice(2);
const root = process.env.HIVE_DOCKER_MEMORY_FIXTURE;
const log = entry => fs.appendFileSync(path.join(root, 'calls'), JSON.stringify(entry) + '\\n');
const refuse = message => { console.error(message); process.exit(1); };
log({name, args});
if (name === 'sudo') {
  if (args[0] === '-n') args.shift();
  if (args[0] === 'true') process.exit(0);
  if (args[0] === 'install' && args[1] === '-d' && args[2] === '/run/systemd/system/docker.service.d') process.exit(0);
  if (args[0] === 'tee' && args[1] === '/run/systemd/system/docker.service.d/hive-pr-memory.conf') {
    fs.writeFileSync(path.join(root, 'drop-in'), fs.readFileSync(0));
    process.exit(0);
  }
  if (args[0] === 'systemctl' && args[1] === 'daemon-reload') process.exit(0);
  if (args[0] === 'systemctl' && args[1] === 'restart' && args[2] === 'docker') {
    if (!fs.existsSync(path.join(root, 'drop-in'))) refuse('Docker restarted without memory configuration');
    const config = fs.readFileSync(path.join(root, 'drop-in'), 'utf8');
    if (!config.includes('GOMEMLIMIT=6GiB') || !config.includes('GOGC=50')) refuse('Missing exporter memory settings');
    fs.writeFileSync(path.join(root, 'running-config'), config);
    process.exit(0);
  }
  refuse('Unexpected privileged command: ' + args.join(' '));
}
if (args[0] === 'info') process.exit(0);
if (args[0] === 'images') { console.log('REPOSITORY TAG'); process.exit(0); }
if (args[0] === 'build') {
  if (process.env.GITHUB_ACTIONS === 'true' && !fs.existsSync(path.join(root, 'running-config'))) {
    refuse('CI exporter starts before the daemon memory policy is active');
  }
  console.log('Mock image build completed');
  process.exit(0);
}
refuse('Unexpected Docker command: ' + args.join(' '));
`;
  for (const name of ['sudo', 'docker']) fs.writeFileSync(path.join(bin, name), mock, { mode: 0o700 });
  for (const onActions of [true, false]) {
    const run = path.join(fixture, String(onActions));
    fs.mkdirSync(run);
    fs.copyFileSync('Dockerfile', path.join(run, 'Dockerfile'));
    fs.copyFileSync('Dockerfile.dind', path.join(run, 'Dockerfile.dind'));
    const result = spawnSync('bash', [path.resolve('scripts/docker-pr-build.sh')], {
      cwd: run,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_ACTIONS: String(onActions),
        DOCKER_PR_EXTRA_SWAP_GB: '0',
        DOCKER_PR_RESOURCE_SAMPLE_SECONDS: '0',
        HIVE_DOCKER_MEMORY_FIXTURE: run,
      },
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 0, `${onActions ? 'CI' : 'local'} build: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    const calls = fs.readFileSync(path.join(run, 'calls'), 'utf8').trim().split('\n').map(JSON.parse);
    const builds = calls.filter(call => call.name === 'docker' && call.args[0] === 'build');
    assert.equal(builds.length, 2, 'Both image variants must still be built');
    assert.ok(
      builds.every(call => call.args.includes('HIVE_MIND_INSTALL_SOURCE=true')),
      'Both variants must install the checked-out branch'
    );
    if (onActions) {
      const firstBuild = calls.findIndex(call => call.name === 'docker' && call.args[0] === 'build');
      const reload = calls.findIndex(call => call.name === 'sudo' && call.args.includes('daemon-reload'));
      const restart = calls.findIndex(call => call.name === 'sudo' && call.args.includes('restart'));
      assert.ok(reload >= 0 && restart > reload && firstBuild > restart, 'Reload and restart must precede either exporter');
    } else {
      assert.ok(!calls.some(call => call.name === 'sudo'), 'Local builds must leave the user daemon unchanged');
    }
  }
  console.log('PASS: CI exporter memory policy is active before both builds; local daemons remain unchanged.');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
