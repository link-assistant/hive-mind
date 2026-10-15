// Issue #2889 experiment 3: the real prune path against a real Docker daemon.
// Run: node docs/case-studies/issue-2889/experiments/03-prune-module.mjs "$PWD/src/kill-recovery-snapshot-cleanup.lib.mjs"
/* global process, console */
import { execFileSync } from 'node:child_process';
const lib = await import(process.argv[2]);
const IMG = 'rhysd/actionlint:1.7.12';
const NAME = 'kr2889-exp3';
const sh = (...args) => {
  try {
    const out = execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    console.log('$ docker', args.join(' ').slice(0, 120), '->', out.slice(0, 300));
    return out;
  } catch (error) {
    console.log(
      '$ docker',
      args.join(' ').slice(0, 120),
      '-> FAILED',
      String(error.stderr || error.message)
        .trim()
        .slice(0, 300)
    );
    return null;
  }
};
const task = "mkdir -p /tmp/ws/src /tmp/ws/target/debug /tmp/ws/web/node_modules/.cache; echo 'fn main() {}' > /tmp/ws/src/main.rs; echo '[package]' > /tmp/ws/Cargo.toml; printf 'Signature: 8a477f597d28d172789f06886806bc55\\n' > /tmp/ws/target/CACHEDIR.TAG; head -c 30000000 /dev/zero > /tmp/ws/target/debug/big; head -c 5000000 /dev/zero > /tmp/ws/web/node_modules/.cache/c; echo TASK-RAN >> /tmp/runs; sleep 1000";
const gate = `gate='/tmp/hive-mind-disk-baseline-${NAME}'; while [ ! -e "$gate" ]; do sleep 0.1; done; rm -f "$gate"; exec sh -c '${task.replaceAll("'", "'\\''")}'`;
sh('rm', '-f', NAME);
sh('create', '--name', NAME, '--entrypoint', '', IMG, 'sh', '-c', gate);
sh('start', NAME);
sh('exec', NAME, 'touch', `/tmp/hive-mind-disk-baseline-${NAME}`);
execFileSync('sleep', ['8']);
sh('kill', NAME);
console.log('SizeRw before:', sh('inspect', '--size', '-f', '{{.SizeRw}}', NAME));
const launch = await lib.inspectDockerTaskLaunch(NAME, { verbose: true });
console.log('launch:', JSON.stringify(launch));
const pruned = await lib.pruneStoppedContainerCaches(NAME, { launch, verbose: true });
console.log('pruned:', JSON.stringify(pruned));
console.log('state after:', sh('inspect', '--size', '-f', '{{.SizeRw}} {{.State.Status}} {{.State.ExitCode}}', NAME));
sh('commit', NAME, 'kr2889/snap3:1');
console.log('snapshot contents:', sh('run', '--rm', '--entrypoint', 'sh', 'kr2889/snap3:1', '-c', 'find /tmp/ws | sort; cat /tmp/runs; true'));
// Gate-open case: PID 1 is not the gate loop, so the script must refuse.
import { execFile } from 'node:child_process';
const runViaSnapshot = (cmd, args, opts) => {
  if (args[0] === 'start' || args[0] === 'kill') return Promise.resolve({ stdout: '' });
  // Run the prune script in a container whose PID 1 is the script itself, not the gate.
  const real = ['run', '--rm', '--entrypoint', 'sh', 'kr2889/snap3:1', '-c', args[4]];
  return new Promise((resolve, reject) => execFile(cmd, real, opts, (error, stdout) => (error ? reject(Object.assign(error, { stdout })) : resolve({ stdout }))));
};
const fake = await lib.pruneStoppedContainerCaches(NAME, { launch: { commandHandoff: false, startGate: 'fail-closed' }, run: runViaSnapshot });
console.log('gate-open case:', JSON.stringify(fake));
sh('rm', '-f', NAME);
sh('image', 'rm', 'kr2889/snap3:1');
