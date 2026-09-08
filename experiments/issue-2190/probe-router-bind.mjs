#!/usr/bin/env node
/**
 * Issue #2190: prove that the router sidecar launched with the new
 * `buildRouterSidecarRunArgs` (internal network primary, entrypoint that binds
 * the internal address only, bridge connected afterwards) is:
 *   1. healthy through its alias from inside the container,
 *   2. reachable from a task container on the internal network,
 *   3. NOT reachable from a container on the default bridge (its bridge IP:443),
 *   4. still able to reach the upstream internet (api.github.com) itself.
 *
 * Runs against real Docker with a throwaway state dir, a random TOKEN_SECRET
 * and an empty credential directory — no real credentials are involved.
 *
 * Usage: node experiments/issue-2190/probe-router-bind.mjs
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildRouterSidecarRunArgs, resolveRouterUpstreamNetwork, ROUTER_SIDECAR_BIND_COMMAND } from '../../src/router-sidecar.lib.mjs';
import { resolveRouterSidecarImage, ROUTER_SIDECAR_NETWORK_ALIAS, ROUTER_SIDECAR_NETWORK_NAME, ROUTER_SIDECAR_PORT } from '../../src/router-isolation.lib.mjs';

const execFileAsync = promisify(execFile);
const suffix = `probe-2190-${process.pid}`;
const containerName = `hive-mind-router-${suffix}`;
const network = `hive-mind-router-${suffix}`;
const docker = async (args, { ignoreError = false } = {}) => {
  try {
    const { stdout } = await execFileAsync('docker', args, { maxBuffer: 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    if (ignoreError) return null;
    throw new Error(`docker ${args.join(' ')}: ${error.stderr || error.message}`);
  }
};
const report = [];
const check = (label, ok, detail = '') => {
  report.push(`${ok ? 'PASS' : 'FAIL'}: ${label}${detail ? ` (${detail})` : ''}`);
  console.log(report.at(-1));
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-2190-'));
fs.mkdirSync(path.join(tmp, '.claude'));
fs.writeFileSync(path.join(tmp, '.claude', '.credentials.json'), '{}\n');
const image = resolveRouterSidecarImage(process.env);
console.log(`image=${image} container=${containerName} network=${network}`);
console.log(`bind command: ${ROUTER_SIDECAR_BIND_COMMAND}`);

try {
  await docker(['network', 'create', '--internal', network]);
  const args = buildRouterSidecarRunArgs({ image, tokenSecret: 'probe-secret', credentialMounts: [{ home: '.claude', target: '/data/claude', envVar: 'CLAUDE_CODE_HOME', source: path.join(tmp, '.claude') }], containerName, env: {} }).map(value => (value === ROUTER_SIDECAR_NETWORK_NAME ? network : value));
  // Use a probe-specific data volume so the shared one is not touched.
  const volumeIndex = args.findIndex(value => value.startsWith('hive-mind-router-data:'));
  args[volumeIndex] = `hive-mind-router-data-${suffix}:/data/router`;
  await docker(args);
  await docker(['network', 'connect', resolveRouterUpstreamNetwork(process.env), containerName]);

  const healthProbe = `fetch("https://${ROUTER_SIDECAR_NETWORK_ALIAS}:${ROUTER_SIDECAR_PORT}/health").then(r => process.exit(r.ok ? 0 : 1)).catch(e => { console.error(String(e)); process.exit(1) })`;
  let healthy = false;
  for (let attempt = 1; attempt <= 30 && !healthy; attempt += 1) {
    healthy = (await docker(['exec', '--env', 'NODE_TLS_REJECT_UNAUTHORIZED=0', containerName, 'bun', '-e', healthProbe], { ignoreError: true })) !== null;
    if (!healthy) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  check('router is healthy through its alias from inside the container', healthy);
  const logs = await docker(['logs', containerName], { ignoreError: true });
  console.log(`--- router logs ---\n${logs}\n---`);

  const internalIp = await docker(['inspect', containerName, '--format', `{{with index .NetworkSettings.Networks "${network}"}}{{.IPAddress}}{{end}}`]);
  const bridgeIp = await docker(['inspect', containerName, '--format', '{{with index .NetworkSettings.Networks "bridge"}}{{.IPAddress}}{{end}}']);
  console.log(`internal ip=${internalIp} bridge ip=${bridgeIp}`);
  // The router does not log its listen address, so prove the bind by asking
  // loopback inside the container: bound to 0.0.0.0 it would answer, bound to
  // the internal address alone it refuses.
  const loopback = await docker(['exec', '--env', 'NODE_TLS_REJECT_UNAUTHORIZED=0', containerName, 'bun', '-e', `fetch("https://127.0.0.1:${ROUTER_SIDECAR_PORT}/health").then(r => { console.log("status " + r.status); process.exit(0) }).catch(e => { console.log("error " + (e.code || e.message)); process.exit(0) })`]);
  check('the router is not bound on loopback (so not on 0.0.0.0)', /error/.test(loopback) && !/status/.test(loopback), loopback);

  const fromInternal = await docker(['run', '--rm', '--network', network, '--env', 'NODE_TLS_REJECT_UNAUTHORIZED=0', '--entrypoint', 'bun', image, '-e', `fetch("https://${ROUTER_SIDECAR_NETWORK_ALIAS}:${ROUTER_SIDECAR_PORT}/health").then(r => { console.log("status " + r.status); process.exit(0) }).catch(e => { console.log("error " + (e.code || e.message)); process.exit(0) })`]);
  check('a container on the internal network reaches the router', /status 200/.test(fromInternal), fromInternal);
  const fromBridge = await docker(['run', '--rm', '--network', 'bridge', '--env', 'NODE_TLS_REJECT_UNAUTHORIZED=0', '--entrypoint', 'bun', image, '-e', `fetch("https://${bridgeIp}:${ROUTER_SIDECAR_PORT}/health").then(r => { console.log("status " + r.status); process.exit(0) }).catch(e => { console.log("error " + (e.code || e.message)); process.exit(0) })`]);
  check('a container on the default bridge is refused', /error/.test(fromBridge) && !/status/.test(fromBridge), fromBridge);
  const fromHost = await execFileAsync('sh', ['-c', `curl -sk -m 5 -o /dev/null -w '%{http_code}' https://${bridgeIp}:${ROUTER_SIDECAR_PORT}/health || echo "exit=$?"`]).then(r => r.stdout.trim());
  check('the host cannot open the router port on the bridge address', !/^200$/.test(fromHost), fromHost);
  const upstream = await docker(['exec', containerName, 'bun', '-e', 'fetch("https://api.github.com/").then(r => { console.log("status " + r.status); process.exit(0) }).catch(e => { console.log("error " + (e.code || e.message)); process.exit(0) })']);
  check('the router itself still reaches api.github.com', /status \d+/.test(upstream), upstream);
  const issued = await docker(['exec', containerName, 'router', 'tokens', 'issue', '--label', 'hive-mind:probe', '--ttl-hours', '1'], { ignoreError: true });
  check('tokens can still be issued through docker exec', typeof issued === 'string' && /la_sk_/.test(issued));
} finally {
  await docker(['rm', '--force', containerName], { ignoreError: true });
  await docker(['network', 'rm', network], { ignoreError: true });
  await docker(['volume', 'rm', `hive-mind-router-data-${suffix}`], { ignoreError: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('\n' + report.join('\n'));
process.exit(report.some(line => line.startsWith('FAIL')) ? 1 : 0);
