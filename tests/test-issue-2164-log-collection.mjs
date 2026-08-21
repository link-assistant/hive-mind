#!/usr/bin/env node
/**
 * Regression test for router/system log access (issue #2164, R8/R14/R15).
 *
 * The audit trail is the point of the feature, so the ways of reading it back
 * are load-bearing: the request logs must still be reachable after the idle
 * reconciler has stopped the sidecar, the collection must not be able to
 * damage what it collects, and the documented list of log locations must be the
 * same list the collector script walks.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2164
 */

import { buildRouterVolumeExportArgs, collectRouterLogs, describeSystemLogLocations, resolveSessionConsoleLogPath } from '../src/router-logs.lib.mjs';
import { ROUTER_DATA_MOUNT, ROUTER_DATA_VOLUME_NAME, ROUTER_SIDECAR_CONTAINER_NAME } from '../src/router-isolation.lib.mjs';
import { resolveLogPath } from '../src/telegram-log-command.lib.mjs';

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  PASS: ${label}`);
  passed++;
}

function fail(label, expected, actual) {
  console.error(`  FAIL: ${label}`);
  if (expected !== undefined) console.error(`     expected: ${JSON.stringify(expected)}`);
  if (actual !== undefined) console.error(`     actual:   ${JSON.stringify(actual)}`);
  failed++;
}

function assertEqual(actual, expected, label) {
  if (actual === expected) pass(label);
  else fail(label, expected, actual);
}

console.log('\n=== issue #2164: every log location is described in one place (R15) ===');

const locations = describeSystemLogLocations({ env: { HIVE_MIND_LOG_DIR: '/var/log/hive-mind', HIVE_MIND_STATE_DIR: '/var/lib/hive-mind' } });
const byKey = Object.fromEntries(locations.map(entry => [entry.key, entry]));

for (const key of ['run-logs', 'bot-logs', 'bot-state', 'session-console', 'container-logs', 'router-requests', 'router-audit', 'task-sessions']) {
  assertEqual(Boolean(byKey[key]), true, `the collection list covers ${key}`);
}
assertEqual(byKey['bot-logs'].path, '/var/log/hive-mind', 'the bot log directory follows HIVE_MIND_LOG_DIR');
assertEqual(byKey['bot-state'].path, '/var/lib/hive-mind', 'the state directory follows HIVE_MIND_STATE_DIR');
assertEqual(byKey['bot-state'].description.includes('0600'), true, 'and warns that it holds the signing secret, so nobody copies it into a shared archive');
assertEqual(
  locations.every(entry => entry.description.length > 20),
  true,
  'every location explains what it holds rather than just naming a path'
);

// The collector and the Telegram /log command must agree, or an operator ends
// up with an archive that is missing the log the bot was happy to serve.
assertEqual(resolveSessionConsoleLogPath({ sessionId: 'u-1', backend: 'docker' }), resolveLogPath({ statusResult: { uuid: 'u-1', isolation: 'docker' }, isolationBackend: 'docker' }), 'the collector looks for a session console log exactly where /log does');

console.log('\n=== issue #2164: the volume can be read with no router running ===');

const exportArgs = buildRouterVolumeExportArgs({ destination: '/tmp/out', uid: 1000, gid: 1000 });
assertEqual(exportArgs.includes(`${ROUTER_DATA_VOLUME_NAME}:${ROUTER_DATA_MOUNT}:ro`), true, 'the evidence volume is mounted read-only, so collecting it can never damage it');
assertEqual(exportArgs.slice(0, 4).join(' '), 'run --rm --entrypoint cp', 'a throwaway container runs cp instead of the router server');
assertEqual(exportArgs.includes('--user') && exportArgs.includes('1000:1000'), true, 'the copy runs as the caller, so the exported logs are readable without root');
assertEqual(exportArgs[exportArgs.length - 1], '/export/', 'and lands in the bind-mounted destination');

console.log('\n=== issue #2164: collection prefers the live sidecar, then the volume ===');

const makeDocker = ({ running, cpWorks = true, exportWorks = true }) => {
  const calls = [];
  const run = async (binary, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'inspect') {
      if (!running) throw new Error('No such object');
      return { stdout: 'true|ghcr.io/link-assistant/router:latest|sha256:abc\n' };
    }
    if (args[0] === 'cp' && !cpWorks) throw new Error('cannot copy');
    if (args[0] === 'run' && !exportWorks) throw new Error('no such volume');
    return { stdout: '' };
  };
  return { calls, run };
};

const live = makeDocker({ running: true });
const fromContainer = await collectRouterLogs({ destination: '/tmp/hive-mind-logs-test', run: live.run });
assertEqual(fromContainer.via, 'container', 'a running sidecar is copied from directly');
assertEqual(
  live.calls.some(call => call === `cp ${ROUTER_SIDECAR_CONTAINER_NAME}:${ROUTER_DATA_MOUNT}/. /tmp/hive-mind-logs-test`),
  true,
  'and the volume contents are copied, not the mount point itself'
);

const stopped = makeDocker({ running: false });
const fromVolume = await collectRouterLogs({ destination: '/tmp/hive-mind-logs-test', run: stopped.run });
assertEqual(fromVolume.via, 'volume', 'once the idle reconciler has stopped the sidecar, the volume is read instead');
assertEqual(fromVolume.collected, true, 'so the request logs remain reachable after the container is gone (R8)');

const brokenCp = makeDocker({ running: true, cpWorks: false });
assertEqual((await collectRouterLogs({ destination: '/tmp/hive-mind-logs-test', run: brokenCp.run })).via, 'volume', 'a failed container copy falls back to the volume rather than giving up');

const nothing = makeDocker({ running: false, exportWorks: false });
const failedCollection = await collectRouterLogs({ destination: '/tmp/hive-mind-logs-test', run: nothing.run });
assertEqual(failedCollection.collected, false, 'a router that was never started collects nothing');
assertEqual(typeof failedCollection.error, 'string', 'and says so instead of reporting an empty success');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
