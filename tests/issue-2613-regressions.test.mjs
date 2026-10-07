/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { execVersionCommand, VERSION_COMMAND_CONCURRENCY } from '../src/version-command.lib.mjs';
import { uploadLogWithGhUploadLog } from '../src/log-upload.lib.mjs';
import { publishLogToPullRequestBranch } from '../src/log-upload-branch.lib.mjs';
import { resolveStartupLogDirectory } from '../src/solve.bootstrap.lib.mjs';
import { buildSolveArgv, labelDraftPullRequest } from '../scripts/formal-ai-draft.lib.mjs';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const permissionDenied = { code: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration (https://api.github.com/gists)' };

test('simultaneous version reports share the concurrency limit and return valid output', { timeout: 10_000 }, async () => {
  let running = 0;
  let peak = 0;
  const onDiagnostic = message => {
    if (message.includes('started:')) peak = Math.max(peak, ++running);
    if (message.includes('finished:')) running--;
  };
  const probe = () => execVersionCommand(`"${process.execPath}" --max-old-space-size=32 -e 'setTimeout(() => console.log("1.2.3"), 100)'`, 2000, { onDiagnostic });
  const batches = await Promise.all([Promise.all(Array.from({ length: 4 }, probe)), Promise.all(Array.from({ length: 4 }, probe))]);
  assert.deepEqual(batches.flat(), Array(8).fill('1.2.3'));
  assert.equal(peak, VERSION_COMMAND_CONCURRENCY);
  assert.equal(running, 0);
});

async function withDirectory(fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2613-'));
  try {
    await fn(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('a timed-out version probe kills its shell descendants', { timeout: 10_000, skip: process.platform !== 'linux' }, async () => {
  await withDirectory(async directory => {
    const script = path.join(directory, 'probe.mjs');
    const pidFile = path.join(directory, 'pid.txt');
    // Finite runtime and a 32 MB heap: this probe never stresses the host.
    await fs.writeFile(script, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 4000);`);
    let pid;
    try {
      assert.equal(await execVersionCommand(`"${process.execPath}" --max-old-space-size=32 "${script}"; wait`, 600), null);
      pid = Number(await fs.readFile(pidFile, 'utf8'));
      // Linux can retain a killed process as a zombie until its parent reaps it.
      let state;
      // SIGKILL and shell close can race with the child's final kernel exit.
      // Wait for that observable state, rather than treating a dying task as a leak.
      for (let attempt = 0; attempt < 20; attempt++) {
        state = await fs.readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
        if (!state || /\) Z /.test(state)) break;
        await delay(10);
      }
      assert.ok(!state || /\) Z /.test(state), `version probe left process ${pid} running: ${state}`);
    } finally {
      pid ??= Number(await fs.readFile(pidFile, 'utf8').catch(() => '0'));
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already exited */
        }
      }
    }
  });
});

test('diagnostic sink errors do not interrupt version probe cleanup', { timeout: 5000 }, async () => {
  const sinks = [
    () => {
      throw new Error('diagnostic sink failed');
    },
    async () => {
      throw new Error('async diagnostic sink failed');
    },
  ];
  for (const onDiagnostic of sinks) {
    const result = await execVersionCommand(`${JSON.stringify(process.execPath)} --max-old-space-size=32 -e 'setTimeout(() => console.log("1.0.0"), 50)'`, 2000, { onDiagnostic });
    assert.equal(result, '1.0.0');
  }
});

test('startup log directory supports aliases, equals syntax and the argument separator', () => {
  assert.equal(resolveStartupLogDirectory(['--log-dir', '/first', '-l=/last']), '/last');
  assert.equal(resolveStartupLogDirectory(['--log-dir=/logs']), '/logs');
  assert.equal(resolveStartupLogDirectory(['-l', '/logs']), '/logs');
  assert.equal(resolveStartupLogDirectory(['--', '--log-dir=/ignored']), null);
  assert.equal(resolveStartupLogDirectory(['--log-dir', '--verbose']), null);
});

test('formal drafts preserve development logs and create missing labels', async () => {
  assert.ok(buildSolveArgv({ issueUrl: 'https://github.com/o/r/issues/1' }).includes('--development-log'));
  const calls = [];
  await labelDraftPullRequest({
    repository: 'o/r',
    number: 2,
    gh: async args => {
      calls.push(args);
      if (calls.length === 1) throw new Error("'formal-ai-draft' not found in repository labels");
    },
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[1][0], 'label');
  assert.deepEqual(calls[0], calls[2]);
  for (const creationError of ['label already exists', 'HTTP 422: Validation Failed {"errors":[{"resource":"Label","code":"already_exists","field":"name"}]}']) {
    let racedCalls = 0;
    await labelDraftPullRequest({
      repository: 'o/r',
      number: 2,
      gh: async () => {
        racedCalls++;
        if (racedCalls === 1) throw new Error("'formal-ai-draft' not found");
        if (racedCalls === 2) throw new Error(creationError);
      },
    });
    assert.equal(racedCalls, 3, 'simultaneous label creation must still apply the label');
  }
  await assert.rejects(
    labelDraftPullRequest({
      repository: 'o/r',
      number: 2,
      gh: async () => {
        throw new Error('HTTP 403');
      },
    }),
    /HTTP 403/
  );
});

test('checks-only workflow dispatch has defaults for all required inputs', async () => {
  const workflow = await fs.readFile(path.join(root, '.github/workflows/release.yml'), 'utf8');
  const dispatch = workflow.slice(workflow.indexOf('  workflow_dispatch:'), workflow.indexOf('\npermissions:'));
  assert.match(dispatch, /bump_type:[\s\S]*?default: (?:'patch'|"patch"|patch)\s*\n/);
});

test('branch fallback commits only its sanitized log and refuses other checkouts', { timeout: 20_000 }, async () => {
  await withDirectory(async directory => {
    const repositoryPath = path.join(directory, 'checkout');
    const remote = path.join(directory, 'remote.git');
    await fs.mkdir(repositoryPath);
    const git = (...args) => execFileAsync('git', args, { cwd: repositoryPath });
    await git('init', '--initial-branch=issue-2613-test');
    await execFileAsync('git', ['init', '--bare', '--initial-branch=main', remote]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('commit', '--allow-empty', '-m', 'Initial');
    await git('remote', 'add', 'origin', remote);
    await fs.writeFile(path.join(repositoryPath, 'unrelated.txt'), 'staged work');
    await git('add', 'unrelated.txt');
    const logFile = path.join(directory, 'session.log');
    await fs.writeFile(logFile, 'complete diagnostics\n');
    const { $: realDollar } = await globalThis.use('command-stream');
    let remoteUrl = 'https://github.com/o/r.git';
    let failPush = false;
    const fakeDollar =
      options =>
      async (strings, ...values) => {
        const command = strings.join('?');
        if (command.startsWith('gh pr view')) return { code: 0, stdout: JSON.stringify({ headRefName: 'issue-2613-test', baseRefName: 'main', headRepositoryOwner: { login: 'o' }, headRepository: { name: 'r' } }) };
        if (command === 'git remote get-url --push origin') return { code: 0, stdout: remoteUrl };
        if (failPush && command.startsWith('git push origin')) return { code: 1, stdout: '', stderr: 'remote: permission denied' };
        return realDollar({ ...options, mirror: false })(strings, ...values);
      };
    const options = { logFile, repositoryPath, owner: 'o', repo: 'r', prNumber: 2614, $: fakeDollar, log: async () => {} };
    const result = await publishLogToPullRequestBranch(options);
    assert.equal(result.success, true);
    assert.match(result.url, /\/blob\/[a-f\d]{40}\/dev\/log\//);
    const { stdout: staged } = await git('diff', '--cached', '--name-only');
    assert.equal(staged.trim(), 'unrelated.txt');
    const { stdout: committed } = await git('show', '--format=', '--name-only', 'HEAD');
    assert.ok(!committed.includes('unrelated.txt'));
    const { stdout: files } = await git('ls-tree', '-r', '--name-only', 'HEAD');
    const solveLog = files
      .trim()
      .split('\n')
      .find(file => file.endsWith('/solve.log'));
    assert.equal(await fs.readFile(path.join(repositoryPath, solveLog), 'utf8'), 'complete diagnostics\n');
    failPush = true;
    const unpublished = await publishLogToPullRequestBranch({ ...options, sessionId: 'failed-push' });
    assert.equal(unpublished.success, false);
    assert.equal(unpublished.url, undefined, 'an unpushed log must not be reported as attached');
    failPush = false;
    remoteUrl = 'https://github.com/other/repository.git';
    assert.equal((await publishLogToPullRequestBranch(options)).success, false);
    remoteUrl = 'https://github.com/o/r.git';
    await git('switch', '-c', 'other');
    assert.equal((await publishLogToPullRequestBranch(options)).success, false);
  });
});

test('permanent Gist permission failure is attempted once without splitting', { timeout: 15_000 }, async () => {
  await withDirectory(async directory => {
    const logFile = path.join(directory, 'session.log');
    await fs.writeFile(logFile, 'complete diagnostic line\n'.repeat(20));
    let calls = 0;
    const sleeps = [];
    const result = await uploadLogWithGhUploadLog({
      logFile,
      isPublic: true,
      partSizeBytes: 64,
      runUpload: async () => {
        calls++;
        return permissionDenied;
      },
      sleep: async delay => sleeps.push(delay),
    });
    assert.equal(result.success, false);
    assert.equal(calls, 1);
    assert.deepEqual(sleeps, []);
  });
});

test('failed Gist upload publishes the complete sanitized log through the branch fallback', { timeout: 15_000 }, async () => {
  await withDirectory(async directory => {
    const logFile = path.join(directory, 'session.log');
    const secret = `ghp_${'A'.repeat(36)}`;
    const content = `diagnostic start\ncredential: ${secret}\ncomplete final diagnostic\n`;
    await fs.writeFile(logFile, content);
    let received;
    const result = await uploadLogWithGhUploadLog({
      logFile,
      isPublic: true,
      runUpload: async () => permissionDenied,
      sleep: async () => {},
      publishToBranch: async sanitizedFile => {
        received = await fs.readFile(sanitizedFile, 'utf8');
        return { success: true, type: 'repository', url: 'https://github.com/link-assistant/hive-mind/blob/abc/dev/log/session.log' };
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.type, 'repository');
    assert.ok(!received.includes(secret));
    assert.match(received, /^diagnostic start\n/);
    assert.match(received, /complete final diagnostic\n$/);
  });
});

test('solve --log-dir writes startup and parsing diagnostics in the requested directory', { timeout: 30_000 }, async () => {
  await withDirectory(async directory => {
    const logDir = path.join(directory, 'mounted-logs');
    const emptyPath = path.join(directory, 'empty-bin');
    await fs.mkdir(emptyPath);
    const { stdout: globalModules } = await execFileAsync('npm', ['root', '-g']);
    await fs.writeFile(path.join(emptyPath, 'npm'), `#!/bin/sh\nif [ "$1 $2" = 'root -g' ]; then echo '${globalModules.trim()}'; else exit 1; fi\n`, { mode: 0o755 });
    await assert.rejects(execFileAsync(process.execPath, [path.join(root, 'src/solve.mjs'), 'https://github.com/o/r/issues/1', '--log-dir', logDir, '--verbose', '--definitely-invalid-option'], { cwd: directory, env: { ...process.env, PATH: emptyPath }, maxBuffer: 1024 * 1024 }), { code: 1 });
    const logs = await fs.readdir(logDir).catch(() => []);
    assert.equal(logs.length, 1, 'the directory bind-mounted by Formal AI Draft must contain its log');
    const content = await fs.readFile(path.join(logDir, logs[0]), 'utf8');
    assert.match(content, /Solve\.mjs Log/);
    assert.match(content, /Raw command executed/);
    assert.match(content, /Unknown argument/);

    const blockedDirectory = path.join(directory, 'not-a-directory');
    await fs.writeFile(blockedDirectory, 'ordinary file');
    await assert.rejects(execFileAsync(process.execPath, [path.join(root, 'src/solve.mjs'), 'https://github.com/o/r/issues/1', '--log-dir', blockedDirectory, '--definitely-invalid-option'], { cwd: directory, env: { ...process.env, PATH: emptyPath }, maxBuffer: 1024 * 1024 }), { code: 1 });
    const fallbackLog = (await fs.readdir(directory)).find(name => /^solve-.*\.log$/.test(name));
    assert.ok(fallbackLog, 'an unusable log directory must retain startup diagnostics in the working directory');
    const fallbackContent = await fs.readFile(path.join(directory, fallbackLog), 'utf8');
    assert.match(fallbackContent, /Could not move the session log/);
    assert.match(fallbackContent, /Raw command executed/);
    assert.match(fallbackContent, /Unknown argument/);
  });
});
