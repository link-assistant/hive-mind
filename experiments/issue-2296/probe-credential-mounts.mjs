#!/usr/bin/env node
/**
 * Issue #2296: real-Docker probe of how a host-side atomic credential rotation
 * (temp file + rename, which is how Claude Code writes `.credentials.json`)
 * reaches a running container, for a single-file bind mount versus a
 * directory bind mount, and whether the refresh lock is shared.
 *
 * Usage: node experiments/issue-2296/probe-credential-mounts.mjs [image]
 * Needs a working `docker` and the image (default alpine:3.20).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const image = process.argv[2] || 'alpine:3.20';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const hostHome = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2296-probe-'));
const hostClaude = path.join(hostHome, '.claude');
const overlay = path.join(hostHome, 'overlay-plugins');
fs.mkdirSync(path.join(hostClaude, 'plugins', 'host-only-plugin'), { recursive: true });
fs.mkdirSync(overlay, { recursive: true });
const credentials = path.join(hostClaude, '.credentials.json');
fs.writeFileSync(credentials, 'v1\n', { mode: 0o600 });

const name = `issue-2296-probe-${process.pid}`;
const results = [];
const check = (label, actual, expected) => {
  const ok = actual === expected;
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};
const readIn = file => docker('exec', name, 'cat', file);

try {
  docker('run', '-d', '--name', name, '-v', `${credentials}:/file-mount/.claude/.credentials.json`, '-v', `${hostClaude}:/dir-mount/.claude`, '-v', `${overlay}:/dir-mount/.claude/plugins`, image, 'sleep', '300');
  check('single-file mount before rotation', readIn('/file-mount/.claude/.credentials.json'), 'v1');
  check('directory mount before rotation', readIn('/dir-mount/.claude/.credentials.json'), 'v1');

  // Rotate on the host exactly like an atomic writer: stage, then rename over.
  const staging = `${credentials}.tmp-${process.pid}`;
  fs.writeFileSync(staging, 'v2\n', { mode: 0o600 });
  fs.renameSync(staging, credentials);
  check('host after atomic rotation', fs.readFileSync(credentials, 'utf8').trim(), 'v2');
  check('single-file mount after rotation (stale inode = bug)', readIn('/file-mount/.claude/.credentials.json'), 'v1');
  check('directory mount after rotation', readIn('/dir-mount/.claude/.credentials.json'), 'v2');

  // A container-side atomic write through the directory mount reaches the host.
  docker('exec', name, 'sh', '-c', 'printf "v3\\n" > /dir-mount/.claude/.credentials.json.tmp && mv /dir-mount/.claude/.credentials.json.tmp /dir-mount/.claude/.credentials.json');
  check('host after container rotation via directory mount', fs.readFileSync(credentials, 'utf8').trim(), 'v3');

  // Through the single-file mount the rename is refused (bind-mount target is busy).
  let renameRefused = false;
  try {
    docker('exec', name, 'sh', '-c', 'printf "v4\\n" > /file-mount/.claude/new && mv /file-mount/.claude/new /file-mount/.claude/.credentials.json');
  } catch {
    renameRefused = true;
  }
  check('container rename onto single-file mount refused', renameRefused, true);

  // The refresh lock lives next to the credentials: shared only via the directory.
  docker('exec', name, 'mkdir', '/dir-mount/.claude/.oauth_refresh.lock');
  check('lock created in container is visible on host', fs.existsSync(path.join(hostClaude, '.oauth_refresh.lock')), true);
  docker('exec', name, 'mkdir', '/file-mount/.claude/.oauth_refresh.lock');
  check('lock created beside a single-file mount stays private', fs.readdirSync(hostClaude).filter(entry => entry.startsWith('.oauth')).length, 1);

  // The per-task overlay hides host plugins inside the shared directory.
  check('host plugins hidden by per-task overlay', docker('exec', name, 'ls', '/dir-mount/.claude/plugins'), '');
} finally {
  try {
    docker('rm', '-f', name);
  } catch {
    // ignore
  }
  fs.rmSync(hostHome, { recursive: true, force: true });
}
const failed = results.filter(ok => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks matched`);
process.exit(failed ? 1 : 0);
