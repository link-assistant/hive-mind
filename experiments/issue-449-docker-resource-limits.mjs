#!/usr/bin/env node

/**
 * Real-Docker smoke test for issue #449. This is intentionally not part of the
 * default suite because it pulls BusyBox and requires access to a Docker daemon.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applyDockerContainerResourceLimits } from '../src/container-resource-limits.lib.mjs';

const run = promisify(execFile);
const containerName = `hive-mind-issue-449-${process.pid}`;

try {
  await run('docker', ['run', '--detach', '--name', containerName, '--pull', 'missing', 'busybox:1.36', 'sleep', '120']);
  const cpu = await applyDockerContainerResourceLimits(containerName, { cpu: '50%' });
  assert.equal(cpu.success, true, cpu.error);

  const { stdout } = await run('docker', ['inspect', '--format', '{{json .HostConfig}}', containerName]);
  const hostConfig = JSON.parse(stdout);
  assert.equal(hostConfig.NanoCpus, cpu.resolved.cpuCores * 1_000_000_000);
  console.log(`PASS: Docker applied ${cpu.resolved.cpuCores} CPUs to ${containerName}`);

  const memory = await applyDockerContainerResourceLimits(containerName, { memory: '64MiB' });
  if (memory.success) {
    const inspected = await run('docker', ['inspect', '--format', '{{json .HostConfig}}', containerName]);
    const updated = JSON.parse(inspected.stdout);
    assert.equal(updated.Memory, 64 * 1024 ** 2);
    assert.equal(updated.MemorySwap, 64 * 1024 ** 2);
    console.log(`PASS: Docker applied 64 MiB RAM to ${containerName}`);
  } else {
    // Nested daemons without delegated memory controllers cannot enforce a RAM
    // limit. Production code deliberately fails the launch in this situation.
    assert.match(memory.error, /cgroup|memory|max|not supported/i);
    console.log(`SKIP: this Docker daemon cannot enforce RAM cgroups; launch would fail closed (${memory.error})`);
  }
} finally {
  await run('docker', ['rm', '--force', containerName]).catch(() => {});
}
