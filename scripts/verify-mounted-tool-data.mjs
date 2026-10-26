// Installed-package directory-mount gate. These are synthetic filesystem
// writers, not native OAuth/history lifecycle or refresh-coordination tests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const entry = await fs.realpath(process.argv[2]);
const installed = path.dirname(entry);
const { buildDockerIsolationStartArgs, prepareDockerIsolationHostPaths, resolveDockerIsolationMountSources } = await import(pathToFileURL(path.join(installed, 'isolation-runner.lib.mjs')));
const { SHARED_TOOL_DATA_ENV } = await import(pathToFileURL(path.join(installed, 'tool-data-mounts.lib.mjs')));
// Execute the installed validator itself inside the disposable child. The
// package directory need not be available in the outer daemon's namespace.
const validator = await fs.readFile(path.join(installed, 'tool-data-mounts.lib.mjs'), 'utf8');
const image = process.env.HIVE_MOUNT_TEST_IMAGE;
const expectedHome = process.env.HIVE_MOUNT_TEST_EXPECTED_HOME;
const fixture = process.env.HIVE_MOUNT_TEST_FIXTURE || '/mount-fixture';
assert.ok(image && expectedHome, 'the packaged-image gate requires explicit fixture and image paths');
const homeDir = path.join(fixture, 'home');
const env = { PATH: process.env.PATH, DOCKER_HOST: 'unix:///var/run/docker.sock', HIVE_MIND_DOCKER_ISOLATION_IMAGE: image, XDG_DATA_HOME: path.join(homeDir, '.local/share') };
const docker = async args => {
  try {
    return await execute('docker', args, { env, maxBuffer: 128 * 1024, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    await fs.writeFile('/tmp/hive-tool-data-gate-private.log', `${JSON.stringify({ code: error.code, signal: error.signal })}\n${error.stderr || ''}`, { mode: 0o600 });
    // execFile's original error embeds its complete argv/source payload. Keep
    // those bytes in the private log rather than serializing them as a cause.
    for (const key of Reflect.ownKeys(error)) delete error[key];
    error.message = 'Disposable Docker fixture did not complete.';
    throw new Error('Synthetic tool-data Docker gate failed; inspect /tmp/hive-tool-data-gate-private.log.', { cause: error });
  }
};

for (const [tool, app] of [
  ['agent', 'link-assistant-agent'],
  ['opencode', 'opencode'],
]) {
  const prepared = await prepareDockerIsolationHostPaths({ tool, homeDir, env });
  const source = path.join(env.XDG_DATA_HOME, app);
  const target = `/home/box/.local/share/${app}`;
  const auth = path.join(source, 'auth.json');
  await fs.writeFile(auth, '{"synthetic":"G0"}', { mode: 0o600 });
  if (tool === 'agent') {
    await fs.mkdir(path.join(source, 'bin'), { recursive: true });
    await fs.writeFile(path.join(source, 'bin/operator-cache'), 'protected');
  }
  const planned = await buildDockerIsolationStartArgs('solve', [], { homeDir, tool, sessionId: 'data-mount-contract', env, sharedDataIdentity: prepared.identity, resolveMountSources: resolveDockerIsolationMountSources });
  const mount = planned.find(arg => arg.endsWith(`:${target}`));
  assert.equal(mount, `${path.join(expectedHome, '.local/share', app)}:${target}`);
  const marker = planned.find(arg => arg.startsWith(`${SHARED_TOOL_DATA_ENV}=`));
  assert.ok(marker, 'the production planner must pass the prepared directory identity');
  const cacheMounts = planned.flatMap((arg, index) => (arg === '--mount' ? ['--mount', planned[index + 1]] : []));
  const names = [0, 1].map(() => `hive-data-contract-${randomUUID()}`);
  const check = (name, operation) => docker(['exec', name, 'node', '--max-old-space-size=64', '--input-type=module', '-e', `${validator}\nawait assertSharedToolData({tool:${JSON.stringify(tool)}});\n${operation}`]);
  const requireGeneration = generation => `if(JSON.parse(await fs.readFile(${JSON.stringify(`${target}/auth.json`)})).synthetic!==${JSON.stringify(generation)})throw new Error('Credential generation mismatch');`;
  try {
    const results = await Promise.allSettled(names.map(name => docker(['run', '--detach', '--pull', 'never', '--name', name, '--network', 'none', '--read-only', '--user', `${process.getuid()}:${process.getgid()}`, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '32', '--ulimit', 'data=1073741824:1073741824', '--env', 'HOME=/tmp/task-home', '--env', 'NODE_OPTIONS=', '--env', 'XDG_DATA_HOME=/home/box/.local/share', '--env', marker, '--volume', mount, ...cacheMounts, '--tmpfs', '/tmp:rw,noexec,nosuid,size=8388608,mode=1777', '--entrypoint', 'node', image, '--max-old-space-size=64', '-e', 'setInterval(()=>{},1000)'])));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    for (const name of names) await check(name, requireGeneration('G0'));
    await fs.writeFile(`${auth}.new`, '{"synthetic":"G1"}', { mode: 0o600 });
    await fs.rename(`${auth}.new`, auth);
    for (const name of names) await check(name, requireGeneration('G1'));
    await check(names[0], `await fs.writeFile(${JSON.stringify(`${target}/auth.new`)},'{"synthetic":"G2"}');await fs.rename(${JSON.stringify(`${target}/auth.new`)},${JSON.stringify(`${target}/auth.json`)});await fs.writeFile(${JSON.stringify(`${target}/task-a-history`)},'persisted');`);
    assert.equal(JSON.parse(await fs.readFile(auth)).synthetic, 'G2');
    await check(names[1], `${requireGeneration('G2')}if(await fs.readFile(${JSON.stringify(`${target}/task-a-history`)},'utf8')!=='persisted')throw new Error('Peer history missing');await fs.writeFile(${JSON.stringify(`${target}/task-b-history`)},'persisted');await fs.unlink(${JSON.stringify(`${target}/auth.json`)});`);
    await assert.rejects(fs.access(auth), { code: 'ENOENT' });
    await check(names[0], `try{await fs.access(${JSON.stringify(`${target}/auth.json`)});throw new Error('Deleted credentials remain visible');}catch(error){if(error.code!=='ENOENT')throw error;}`);
    await fs.writeFile(auth, '{"synthetic":"G3"}', { mode: 0o600 });
    for (const name of names) await check(name, `${requireGeneration('G3')}if(await fs.readFile(${JSON.stringify(`${target}/task-b-history`)},'utf8')!=='persisted')throw new Error('Peer history missing');let rejected=false;try{await assertSharedToolData({tool:${JSON.stringify(tool)},env:{...process.env,XDG_DATA_HOME:'/tmp/private-data'}});}catch{rejected=true;}if(!rejected)throw new Error('Private storage accepted');`);
    if (tool === 'agent') {
      await check(names[0], `await fs.writeFile(${JSON.stringify(`${target}/bin/task-cache`)},'private');try{await fs.access(${JSON.stringify(`${target}/bin/operator-cache`)});throw new Error('Operator executable cache leaked');}catch(error){if(error.code!=='ENOENT')throw error;}`);
      await check(names[1], `try{await fs.access(${JSON.stringify(`${target}/bin/task-cache`)});throw new Error('Peer executable cache leaked');}catch(error){if(error.code!=='ENOENT')throw error;}`);
      await assert.rejects(fs.access(path.join(source, 'bin/task-cache')), { code: 'ENOENT' });
      assert.equal(await fs.readFile(path.join(source, 'bin/operator-cache'), 'utf8'), 'protected');
    }
    console.log(`${tool}: installed directory projection preserves atomic replacements, deletion/recreation and two-task filesystem writes; private redirection is rejected.`);
  } finally {
    await Promise.all(names.map(name => docker(['rm', '-f', name]).catch(() => {})));
  }
}
