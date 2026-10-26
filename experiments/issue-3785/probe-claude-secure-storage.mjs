// Verify the pinned Linux CLI's independent credential-root selector with
// synthetic credentials and disposable homes. No provider request is required.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-claude-secure-'));
const binary = process.argv[2] || '/home/box/.local/share/claude/versions/2.1.310';
const credential = plan => JSON.stringify({ claudeAiOauth: { accessToken: 'SYNTHETIC_NOT_A_PROVIDER_TOKEN', refreshToken: 'SYNTHETIC_NOT_A_REFRESH_TOKEN', expiresAt: Date.now() + 3600000, scopes: ['user:inference', 'user:profile'], subscriptionType: plan, rateLimitTier: 'default_claude_max_5x' } });
try {
  const canonical = path.join(root, 'canonical');
  const home = path.join(root, 'home');
  const config = path.join(root, 'private-config');
  for (const dir of [canonical, config, path.join(home, '.claude')]) await fs.mkdir(dir, { recursive: true });
  const auth = path.join(canonical, '.credentials.json');
  const privateAuth = path.join(config, '.credentials.json');
  const defaultAuth = path.join(home, '.claude/.credentials.json');
  const untouched = credential('pro');
  await fs.writeFile(auth, credential('max'), { mode: 0o600 });
  await fs.writeFile(privateAuth, untouched, { mode: 0o600 });
  await fs.writeFile(defaultAuth, untouched, { mode: 0o600 });
  const env = { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: config, CLAUDE_SECURESTORAGE_CONFIG_DIR: canonical, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const run = async (args, selected = env) => {
    const pending = execute('python3', ['-c', 'import os,resource,sys; resource.setrlimit(resource.RLIMIT_DATA,(1610612736,1610612736)); resource.setrlimit(resource.RLIMIT_CORE,(0,0)); os.execvpe(sys.argv[1],sys.argv[1:],os.environ)', binary, ...args], { env: selected, cwd: home, maxBuffer: 128 * 1024, signal: globalThis.AbortSignal.timeout(15000), killSignal: 'SIGKILL' });
    pending.child.stdin.end();
    return pending;
  };
  const status = JSON.parse((await run(['auth', 'status', '--json'])).stdout);
  assert.equal(status.loggedIn, true);
  assert.equal(status.subscriptionType, 'max');
  const empty = JSON.parse((await run(['auth', 'status', '--json'], { ...env, CLAUDE_SECURESTORAGE_CONFIG_DIR: '' })).stdout);
  assert.equal(empty.subscriptionType, 'pro', 'empty explicitly selects the conventional default credential root');
  await run(['auth', 'logout']);
  await assert.rejects(fs.access(auth), { code: 'ENOENT' });
  assert.equal(await fs.readFile(privateAuth, 'utf8'), untouched);
  assert.equal(await fs.readFile(defaultAuth, 'utf8'), untouched);
  console.log('PASS: Claude 2.1.310 Linux status and native logout use the independent secure-storage directory; private configuration credentials remain unchanged.');
  console.log('PASS: an explicitly empty selector uses HOME/.claude despite a relocated configuration directory.');
} catch (error) {
  await fs.writeFile('/tmp/issue-3785-claude-secure-private.log', `${error.stack || error}\n${error.stdout || ''}\n${error.stderr || ''}`, { mode: 0o600 });
  for (const key of Reflect.ownKeys(error)) delete error[key];
  error.message = 'Disposable Claude CLI probe did not complete.';
  throw new Error('Disposable Claude secure-storage probe failed; inspect its private local log.', { cause: error });
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
