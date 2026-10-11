/**
 * Regression coverage for production cleanup failures in issue #2629.
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as logic from '../src/cleanup.lib.mjs';
import * as os from '../src/cleanup.os.lib.mjs';
import * as osModule from '../src/cleanup.docker.os.lib.mjs';

const UUID = 'e6c1dd3f-3acd-475d-8df4-f45b75879a8b';
const RESUME = `${UUID}-resume-1`;
const NOW = Date.parse('2026-10-07T18:00:00Z');
const stopped = (name = UUID, extras = {}) => ({ name, id: 'a'.repeat(64), state: 'exited', status: 'Exited (1) 3 days ago', exitCode: 1, finishedAt: '2026-10-04T18:00:00Z', ...extras });
const daemonError = () => Object.assign(new Error('docker failed'), { stderr: 'snapshotter.Usage failed: snapshot not found' });

test('resume names are detected and malformed suffixes are rejected', () => {
  assert.equal(logic.isDockerIsolationSessionName(RESUME), true);
  for (const name of [`${UUID}-resume-x`, `${UUID}-resume-1-extra`, 'database']) assert.equal(logic.isDockerIsolationSessionName(name), false);
  const rows = os.parseDockerPsJsonLines(JSON.stringify({ ID: 'abc', Names: RESUME, State: 'exited', Status: 'Exited (127) 1 hour ago' }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].exitCode, 127);
});

test('discovery retries without asking Docker for all sizes', () => {
  let attempts = 0;
  const rows = os.listDockerIsolationContainers({
    execFn: (_cmd, args) => {
      assert.equal(args.includes('--no-trunc'), true);
      assert.equal(args.includes('{{json .}}'), false);
      assert.equal(
        args.some(arg => arg.includes('.Size')),
        false
      );
      if (++attempts < 3) throw daemonError();
      return `abc\t${RESUME}\texited\tExited (127) 1 hour ago\tbase:latest\t2026-10-07 09:00:00 +0000 UTC`;
    },
  });
  assert.equal(attempts, 3);
  assert.equal(rows[0].name, RESUME);
});

test('persistent daemon failure is an error rather than an empty host', () => {
  let attempts = 0;
  assert.throws(
    () =>
      os.listDockerIsolationContainers({
        execFn: () => {
          attempts++;
          throw daemonError();
        },
      }),
    /docker ps failed.*snapshotter/s
  );
  assert.equal(attempts, 3);
});

test('empty successful listing is allowed', () => {
  assert.deepEqual(os.listDockerIsolationContainers({ execFn: () => '' }), []);
});

test('failed container retention uses its finish time, never its creation time', () => {
  const containers = [stopped(), stopped(RESUME, { finishedAt: '2026-10-07T17:00:00Z', createdAt: '2026-09-01T00:00:00Z' }), stopped(`${UUID}-resume-2`, { finishedAt: null })];
  const plan = logic.planDockerIsolationCleanup({ containers, mode: 'failed-older-than=48h', now: NOW });
  assert.deepEqual(
    plan.remove.map(x => x.name),
    [UUID]
  );
  assert.equal(plan.keep.length, 2);
  assert.equal(plan.remove[0].command, `docker rm ${UUID}`);
});

test('TTL leaves successful containers eligible for default cleanup', () => {
  const plan = logic.planDockerIsolationCleanup({ containers: [stopped(UUID, { exitCode: 0, finishedAt: '2026-10-07T17:00:00Z' })], mode: 'failed-older-than=48h', now: NOW });
  assert.equal(plan.remove.length, 1);
});

test('default still keeps failed containers', () => {
  assert.equal(logic.planDockerIsolationCleanup({ containers: [stopped()] }).keep.length, 1);
});

test('running, paused, restarting and active parent sessions survive all modes', () => {
  for (const mode of ['all', 'succeeded', 'failed-older-than=48h']) {
    for (const state of ['running', 'paused', 'restarting']) {
      assert.equal(logic.planDockerIsolationCleanup({ containers: [stopped(UUID, { state })], mode, now: NOW }).remove.length, 0);
    }
    const plan = logic.planDockerIsolationCleanup({ containers: [stopped(RESUME)], mode, now: NOW, sessionTasks: [{ sessionId: 'execution-id', sessionName: UUID, status: 'executing' }] });
    assert.equal(plan.remove.length, 0);
    assert.equal(plan.keep[0].session.sessionId, 'execution-id');
  }
});

test('invalid retention values are rejected', () => {
  for (const mode of ['failed-older-than=0h', 'failed-older-than=-1h', 'failed-older-than=abc', 'failed-older-than=Infinityd']) assert.throws(() => logic.normalizeDockerIsolationCleanupMode(mode), /Invalid/);
});

test('size reporting distinguishes unknown bytes', () => {
  const plan = logic.planDockerIsolationCleanup({ containers: [stopped(UUID, { size: 15 * 1024 ** 3 })] });
  assert.match(logic.formatDockerIsolationContainerSummary(plan.keep[0]), /15G/);
  assert.match(logic.formatDockerIsolationContainerSummary(stopped()), /size \?/);
});

test('active reinspection or missing state prevents removal', () => {
  for (const state of ['true false 99', 'false true 0', 'false false 20', '', 'false false 0 paused']) {
    const calls = [];
    const result = os.removeDockerContainer(UUID, {
      execFn: (_cmd, args) => {
        calls.push(args);
        return state;
      },
    });
    assert.equal(result, false);
    assert.equal(
      calls.some(args => args[0] === 'rm'),
      false
    );
  }
});

test('removal uses inspected immutable ID without force, including a restart race', () => {
  const calls = [];
  const result = os.removeDockerContainer(RESUME, {
    id: 'a'.repeat(64),
    execFn: (_cmd, args) => {
      calls.push(args);
      if (args[0] === 'inspect') return 'false false 0 exited';
      if (args[0] === 'rm') throw Object.assign(new Error('restarted'), { stderr: 'container is running' });
      throw new Error('unexpected command');
    },
  });
  assert.equal(result, false);
  assert.deepEqual(calls.at(-1), ['rm', 'a'.repeat(64)]);
});

test('stopped resume removal succeeds without force', () => {
  const calls = [];
  assert.equal(
    os.removeDockerContainer(RESUME, {
      execFn: (_cmd, args) => {
        calls.push(args);
        return args[0] === 'inspect' ? 'false false 0 exited' : RESUME;
      },
    }),
    true
  );
  assert.deepEqual(calls.at(-1), ['rm', RESUME]);
});

test('log upload staging clones are recognized without matching arbitrary logs', () => {
  assert.ok(logic.matchHiveMindPattern('log-tmp-hive-mind-log-upload-abc-sanitized-123'));
  assert.ok(logic.matchHiveMindPattern('log-home-box-hive-telegram-bot-2026-10-07'));
  assert.equal(logic.matchHiveMindPattern('log-home-box-unrelated'), null);
});

test('size inspection failures preserve discovered containers and finish metadata', () => {
  const containers = [stopped(RESUME)];
  osModule.collectDockerContainerMetadata(containers, {
    execFn: (_cmd, args) => {
      if (args.includes('--size')) throw daemonError();
      return JSON.stringify({ Status: 'exited', Running: false, Restarting: false, Pid: 0, FinishedAt: '2026-10-04T18:00:00Z', ExitCode: 127 });
    },
  });
  assert.equal(containers.length, 1);
  assert.equal(containers[0].size, null);
  assert.equal(containers[0].exitCode, 127);
  assert.equal(logic.planDockerIsolationCleanup({ containers, mode: 'failed-older-than=48h', now: NOW }).remove.length, 1);
});

test('measurement budget exhaustion does not stop discovery or finish-time inspection', () => {
  const containers = [stopped()];
  osModule.collectDockerContainerMetadata(containers, {
    sizeBudgetMs: 0,
    execFn: (_cmd, args) => {
      assert.equal(args.includes('--size'), false);
      return JSON.stringify({ Status: 'exited', FinishedAt: '2026-10-04T18:00:00Z' });
    },
  });
  assert.equal(containers[0].size, null);
  assert.match(logic.formatDockerCleanupBytes(containers), /unknown/);
});

const IMAGE = { name: `start-command-resume/${UUID}:1`, id: `sha256:${'b'.repeat(64)}`, sessionId: UUID, attempt: '1', size: null };

test('resume snapshot discovery ignores unrelated repositories and tags', () => {
  const images = osModule.listDockerResumeImages({
    execFn: () =>
      [
        { Repository: `start-command-resume/${UUID}`, Tag: '1', ID: IMAGE.id },
        { Repository: 'unrelated', Tag: 'latest', ID: IMAGE.id },
        { Repository: `start-command-resume/${UUID}`, Tag: 'latest', ID: IMAGE.id },
      ]
        .map(row => JSON.stringify(row))
        .join('\n'),
  });
  assert.equal(images.length, 1);
  assert.equal(images[0].name, IMAGE.name);
});

test('snapshot bytes use unique size rather than shared or virtual bytes', () => {
  const images = [{ ...IMAGE }];
  osModule.collectDockerResumeImageSizes(images, { execFn: () => `Images space usage:\n\nREPOSITORY  TAG  IMAGE ID  CREATED  SIZE  SHARED SIZE  UNIQUE SIZE  CONTAINERS\nstart-command-resume/${UUID}  1  bbbbbbbbbbbb  1 hour ago  9.4GB  5GB  4.4GB  1\n` });
  assert.equal(images[0].size, 4400000000);
  osModule.collectDockerResumeImageSizes([{ ...IMAGE }], {
    execFn: () => {
      throw daemonError();
    },
  });
});

test('resume image plan removes snapshots only when their containers are removed', () => {
  const containers = [stopped(RESUME, { image: IMAGE.name })];
  const defaultPlan = logic.planDockerIsolationCleanup({ containers });
  assert.equal(logic.planDockerResumeImageCleanup({ images: [IMAGE], containerPlan: defaultPlan }).remove.length, 0);
  const allPlan = logic.planDockerIsolationCleanup({ containers, mode: 'all' });
  assert.equal(logic.planDockerResumeImageCleanup({ images: [IMAGE], containerPlan: allPlan }).remove.length, 1);
  assert.equal(logic.planDockerResumeImageCleanup({ images: [IMAGE], containerPlan: allPlan, sessionTasks: [{ sessionName: UUID, status: 'executing' }] }).remove.length, 0);
});

test('all mode can remove orphan resume snapshots but default mode keeps unknown outcomes', () => {
  for (const [mode, count] of [
    ['all', 1],
    ['succeeded', 0],
  ]) {
    assert.equal(logic.planDockerResumeImageCleanup({ images: [IMAGE], containerPlan: logic.planDockerIsolationCleanup({ mode }) }).remove.length, count);
  }
});

test('image deletion refuses referenced images, retags and unknown IDs', () => {
  const calls = [];
  assert.equal(
    osModule.removeDockerResumeImage(IMAGE, {
      execFn: (_cmd, args) => {
        calls.push(args);
        return 'other-container';
      },
    }),
    false
  );
  assert.equal(calls.length, 1);
  assert.equal(osModule.removeDockerResumeImage({ ...IMAGE, id: null }), false);
  assert.equal(osModule.removeDockerResumeImage(IMAGE, { execFn: (_cmd, args) => (args[0] === 'ps' ? '' : `sha256:${'c'.repeat(64)}`) }), false);
});

test('unused image deletion targets its ID without force', () => {
  const calls = [];
  assert.equal(
    osModule.removeDockerResumeImage(IMAGE, {
      execFn: (_cmd, args) => {
        calls.push(args);
        return args[0] === 'ps' ? '' : IMAGE.id;
      },
    }),
    true
  );
  assert.deepEqual(calls.at(-1), ['image', 'rm', IMAGE.id]);
});

test('successful resume exit wins over a failed parent outcome', () => {
  const plan = logic.planDockerIsolationCleanup({ containers: [stopped(RESUME, { exitCode: 0 })], sessionTasks: [{ sessionName: UUID, status: 'failed', exitCode: 137 }] });
  assert.equal(plan.remove.length, 1);
  assert.equal(plan.remove[0].successful, true);
});

test('an older terminal execution cannot overwrite an executing session name', () => {
  const plan = logic.planDockerIsolationCleanup({
    containers: [stopped(RESUME)],
    mode: 'all',
    sessionTasks: [
      { sessionId: 'live-execution', sessionName: UUID, status: 'executing' },
      { sessionId: 'old-execution', sessionName: UUID, status: 'failed' },
    ],
  });
  assert.equal(plan.remove.length, 0);
});

test('active task listing preserves concurrent sessions of the same issue', async () => {
  const tasks = await os.getActiveTasks({
    resolveBranches: false,
    sessionTasks: [
      { owner: 'fixture', repo: 'tasks', number: 2629, type: 'issue', sessionId: UUID, status: 'executing', terminal: false },
      { owner: 'fixture', repo: 'tasks', number: 2629, type: 'issue', sessionId: RESUME, status: 'executing', terminal: false },
    ],
  });
  assert.equal(tasks.filter(task => task.owner === 'fixture').length, 2);
});

test('executing resume session protects its parent container and orphan snapshot', () => {
  const sessionTasks = [{ sessionName: RESUME, sessionId: 'resume-execution', status: 'executing' }];
  const containerPlan = logic.planDockerIsolationCleanup({ containers: [stopped()], sessionTasks, mode: 'all' });
  assert.equal(containerPlan.remove.length, 0);
  assert.equal(logic.planDockerResumeImageCleanup({ images: [IMAGE], containerPlan: logic.planDockerIsolationCleanup({ mode: 'all' }), sessionTasks }).remove.length, 0);
});

test('removal rechecks retention and success if a container resumed and finished again', () => {
  for (const mode of ['succeeded', 'failed-older-than=48h']) {
    const calls = [];
    const ok = osModule.removeDockerContainer(UUID, {
      mode,
      now: NOW,
      execFn: (_cmd, args) => {
        calls.push(args);
        if (args[0] !== 'inspect') return UUID;
        return args.some(arg => arg.includes('.State.FinishedAt')) ? 'false false 0 exited 1 2026-10-07T17:59:00Z' : 'false false 0 exited';
      },
    });
    assert.equal(ok, false);
    assert.equal(
      calls.some(args => args[0] === 'rm'),
      false
    );
  }
});
