#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #2296: a 20-hour Docker-isolated `--tool claude` session died on
 * "OAuth session expired and could not be refreshed". The task received
 * `~/.claude/.credentials.json` as a single-file bind mount, which
 *
 *   1. pins the inode it was created with, so the token the host rotated
 *      (temp file + rename) never reached the task, and
 *   2. leaves `.oauth_refresh.lock` (created next to the credential file) private
 *      to the container, so the task raced every other holder of the
 *      single-use refresh token.
 *
 * This test checks the self-check that detects the broken layout and — when a
 * Docker daemon is available — replays the rotation against the real mount
 * list the launcher builds.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';
import { getDockerIsolationAuthMounts, prepareDockerIsolationHostPaths } from '../src/isolation-runner.lib.mjs';
import { detectSingleFileCredentialMount, formatSingleFileCredentialMountWarning, parseMountPoints } from '../src/isolation-tool-mounts.lib.mjs';

let passed = 0;
let failed = 0;
function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// Real lines from `cat /proc/self/mountinfo` in the two layouts (trimmed).
const SINGLE_FILE_MOUNTINFO = ['1201 1090 0:52 / / rw,relatime - overlay overlay rw', '1230 1201 8:1 /home/box/.claude/.credentials.json /home/box/.claude/.credentials.json rw,relatime - ext4 /dev/sda1 rw', '1231 1201 8:1 /home/box/.claude/projects /home/box/.claude/projects rw,relatime - ext4 /dev/sda1 rw'].join('\n');
const DIRECTORY_MOUNTINFO = ['1201 1090 0:52 / / rw,relatime - overlay overlay rw', '1230 1201 8:1 /home/box/.claude /home/box/.claude rw,relatime - ext4 /dev/sda1 rw', '1231 1230 8:1 /home/box/.hive-mind/docker-isolation/t/claude/plugins /home/box/.claude/plugins rw,relatime - ext4 /dev/sda1 rw'].join('\n');

console.log('\n--- Self-check: a single-file credential mount is detected ---');

assertEqual(parseMountPoints('36 35 98:0 /mnt1 /mnt\\040with\\040space rw - ext3 /dev/root rw'), ['/mnt with space'], 'mountinfo octal escapes are decoded');
assertEqual(detectSingleFileCredentialMount({ tool: 'claude', homeDir: '/home/box', env: {}, readMountinfo: () => SINGLE_FILE_MOUNTINFO }), '/home/box/.claude/.credentials.json', 'the #2296 layout (credential file mounted on its own) is reported');
assertEqual(detectSingleFileCredentialMount({ tool: 'claude', homeDir: '/home/box', env: {}, readMountinfo: () => DIRECTORY_MOUNTINFO }), null, 'the shared-directory layout is not reported');
assertEqual(detectSingleFileCredentialMount({ tool: 'claude', homeDir: '/home/box', env: { CLAUDE_CONFIG_DIR: '/cfg' }, readMountinfo: () => '1 0 8:1 / /cfg/.credentials.json rw - ext4 /dev/sda1 rw' }), '/cfg/.credentials.json', 'CLAUDE_CONFIG_DIR is honoured');
assertEqual(detectSingleFileCredentialMount({ tool: 'codex', homeDir: '/home/box', env: {}, readMountinfo: () => '1 0 8:1 / /home/box/.codex/auth.json rw - ext4 /dev/sda1 rw' }), '/home/box/.codex/auth.json', 'codex auth.json mounted on its own is reported too');
assertEqual(
  detectSingleFileCredentialMount({
    tool: 'claude',
    readMountinfo: () => {
      throw new Error('ENOENT');
    },
  }),
  null,
  'a host without /proc (macOS) is not reported'
);

const logged = [];
const audit = await runAgentConfigAudit({ tool: 'claude', homeDir: fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2296-audit-')), autoRepair: false, log: async message => logged.push(message), detectCredentialMount: ({ tool }) => (tool === 'claude' ? '/home/box/.claude/.credentials.json' : null) });
assertEqual(audit.singleFileCredentialMounts, ['/home/box/.claude/.credentials.json'], 'the startup audit returns the offending mount');
assertEqual(logged.includes(formatSingleFileCredentialMountWarning('/home/box/.claude/.credentials.json')), true, 'the startup audit warns about it');
assertEqual(/single-file mount/.test(logged[0]) && /refresh lock/.test(logged[0]) && /#2296/.test(logged[0]), true, 'the warning names the cause and the issue');

console.log('\n--- Real Docker: host rotation and refresh lock reach the task (skipped without a daemon) ---');

const IMAGE = process.env.HIVE_MIND_TEST_ALPINE_IMAGE || 'alpine:3.20';
function dockerAvailable() {
  if (process.env.HIVE_MIND_SKIP_DOCKER_TESTS) return false;
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 15000 });
    execFileSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore', timeout: 15000 });
    return true;
  } catch {
    try {
      execFileSync('docker', ['pull', IMAGE], { stdio: 'ignore', timeout: 90000 });
      return true;
    } catch {
      return false;
    }
  }
}

if (!dockerAvailable()) {
  console.log(`  SKIP: no usable Docker daemon or ${IMAGE} image`);
} else {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2296-home-'));
  const name = `issue-2296-test-${process.pid}`;
  const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 60000 }).trim();
  try {
    const claudeDir = path.join(home, '.claude');
    fs.mkdirSync(path.join(claudeDir, 'plugins', 'cache', 'superpowers'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, '.credentials.json'), '{"v":1}\n');
    prepareDockerIsolationHostPaths({ tool: 'claude', homeDir: home, sessionId: 'task' });
    const mounts = getDockerIsolationAuthMounts({ tool: 'claude', homeDir: home, sessionId: 'task', env: {} }).filter(mount => mount.source.startsWith(home));
    const user = typeof process.getuid === 'function' ? ['--user', `${process.getuid()}:${process.getgid()}`] : [];
    docker('run', '-d', '--name', name, ...user, ...mounts.flatMap(mount => ['-v', `${mount.source}:${mount.target}`]), IMAGE, 'sleep', '120');
    const inside = file => docker('exec', name, 'cat', file);

    // Claude Code writes the credential file atomically: temp file + rename.
    fs.writeFileSync(path.join(claudeDir, '.credentials.json.tmp'), '{"v":2}\n');
    fs.renameSync(path.join(claudeDir, '.credentials.json.tmp'), path.join(claudeDir, '.credentials.json'));
    assertEqual(inside('/home/box/.claude/.credentials.json'), '{"v":2}', 'a token rotated on the host is what the task reads next');

    docker('exec', name, 'sh', '-c', 'printf \'{"v":3}\\n\' > /home/box/.claude/.credentials.json.tmp && mv /home/box/.claude/.credentials.json.tmp /home/box/.claude/.credentials.json');
    assertEqual(fs.readFileSync(path.join(claudeDir, '.credentials.json'), 'utf8').trim(), '{"v":3}', 'a token the task rotates atomically reaches the host (no EBUSY)');

    docker('exec', name, 'mkdir', '/home/box/.claude/.oauth_refresh.lock');
    assertEqual(fs.existsSync(path.join(claudeDir, '.oauth_refresh.lock')), true, 'the task and the host share one .oauth_refresh.lock');

    assertEqual(docker('exec', name, 'ls', '-A', '/home/box/.claude/plugins'), '', 'the host plugins stay hidden from the task (issue #2190)');
    docker('exec', name, 'sh', '-c', 'echo "{\\"enabledPlugins\\":{\\"x\\":true}}" > /home/box/.claude/settings.json');
    assertEqual(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'), '{}\n', 'settings the task writes never reach the host (issue #2190)');

    assertEqual(detectSingleFileCredentialMount({ tool: 'claude', homeDir: '/home/box', env: {}, readMountinfo: () => docker('exec', name, 'cat', '/proc/self/mountinfo') }), null, 'the self-check passes inside the container the launcher describes');
  } finally {
    try {
      docker('rm', '-f', name);
    } catch {
      // The container may never have started.
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
