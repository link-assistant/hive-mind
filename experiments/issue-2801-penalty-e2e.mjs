#!/usr/bin/env node
// Issue #2801: drive runDockerCpuPenaltyPass against a real container with
// short windows. A container burns every host CPU, gets capped to 2 CPUs,
// is made idle, and gets the cap lifted back to the host CPU count.
// Usage: [TRIGGER=20%] node experiments/issue-2801-penalty-e2e.mjs   (needs docker + alpine:3;
// lower TRIGGER on a host whose CPUs are shared with other load)
import { execFileSync } from 'node:child_process';
import { normalizeDockerCpuPenaltyConfig, runDockerCpuPenaltyPass, getDockerHostCpus } from '../src/docker-cpu-penalty.lib.mjs';

const name = `issue-2801-e2e-${process.pid}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const hostCpus = await getDockerHostCpus();
const config = normalizeDockerCpuPenaltyConfig({ triggerWindowMs: '20s', releaseWindowMs: '20s', triggerPercent: process.env.TRIGGER || '90%', minSamples: 4, coverageToleranceMs: 6000 });
const sessionInfo = { isolationBackend: 'docker', sessionId: name };
const nano = () => docker('inspect', '-f', '{{.HostConfig.NanoCpus}}', name);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

docker('run', '-d', '--rm', '--name', name, 'alpine:3', 'sh', '-c', `for i in $(seq ${hostCpus}); do (while [ ! -f /tmp/stop ]; do :; done) & done; sleep 300`);
console.log(
  `trigger=${config.triggerPercent}% host CPUs=${hostCpus}; loadavg=${(await import('node:os')).default
    .loadavg()
    .map(v => v.toFixed(1))
    .join(' ')}; started ${name}; NanoCpus=${nano()}`
);
try {
  const tick = async label => {
    const [outcome] = await runDockerCpuPenaltyPass([{ sessionName: name, sessionInfo }], { config, verbose: true });
    console.log(`${new Date().toISOString()} ${label} phase=${sessionInfo.cpuPenalty.phase} NanoCpus=${nano()} ${outcome?.action ? `ACTION ${outcome.action.type} ${outcome.action.cpus}` : outcome?.reason}`);
    return outcome;
  };
  const deadline = Date.now() + 60_000;
  while (sessionInfo.cpuPenalty?.phase !== 'penalized' && Date.now() < deadline) {
    await tick('busy');
    await pause(3000);
  }
  console.log(`--- penalized; making the container idle`);
  docker('exec', name, 'touch', '/tmp/stop');
  const liftDeadline = Date.now() + 60_000;
  while (sessionInfo.cpuPenalty?.phase !== 'observing' && Date.now() < liftDeadline) {
    await tick('idle');
    await pause(3000);
  }
  console.log(`--- final phase=${sessionInfo.cpuPenalty.phase} NanoCpus=${nano()} penaltyCount=${sessionInfo.cpuPenalty.penaltyCount} penalizedMs=${sessionInfo.cpuPenalty.penalizedMs}`);
} finally {
  docker('kill', name);
}
