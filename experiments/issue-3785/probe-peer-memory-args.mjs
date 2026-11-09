// Runs the gate's delegated-cgroup memory probe against the selected daemon.
import { spawn } from 'node:child_process';
import { peerMemoryArgs } from '../../scripts/mounted-native-runtime.lib.mjs';
const docker = args =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('close', code => (code === 0 ? resolve() : reject(Object.assign(new Error(`docker exited ${code}`), { stderr }))));
  });
console.log(JSON.stringify(await peerMemoryArgs({ docker, image: process.argv[2] ?? 'node:24-bookworm-slim', bytes: 134217728 })));
