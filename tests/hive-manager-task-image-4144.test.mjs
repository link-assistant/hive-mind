/**
 * Regression test for issue #4144: hive-manager passed the full deployment
 * image reference in HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG, so a DinD + socket
 * instance started its tasks from `konard/hive-mind-dind:konard/hive-mind-dind:…`.
 *
 * Every scenario runs the Docker options that `cli.sh` prints for the instance
 * through `getDockerIsolationImage()`, with the environment the release image
 * bakes, and checks that tasks reuse a valid reference to the instance image.
 *
 * @hive-mind-test-suite default,pr-essential
 * @see https://github.com/link-assistant/hive-mind/issues/4144
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getDockerIsolationImage } from '../src/hive-mind-image.lib.mjs';

const manager = process.env.HIVE_MANAGER_UNDER_TEST ?? fileURLToPath(new URL('../src/hive-manager/cli.sh', import.meta.url));
const RELEASE = '2.49.0';
const LATEST_ID = `sha256:${'1'.repeat(64)}`;
const OTHER_ID = `sha256:${'2'.repeat(64)}`;
// Docker's reference grammar, reduced to what the scenarios use: optional
// registry with port, path components, then a tag and/or a digest.
const REFERENCE = /^(?:[a-z0-9.-]+(?::\d+)?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[\w][\w.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/;

const key = reference => reference.replace(/[/:@]/g, '_');

// A fake Docker CLI with a local image store and a registry, both keyed by reference.
const FAKE_DOCKER = `key() { printf '%s' "$1" | tr '/:@' '___'; }
printf '%s\\n' "$*" >> docker.log
case "$1" in
  image)
    case "$2" in
      inspect)
        reference=\${!#}
        if [[ $reference == sha256:* ]]; then id=$reference
        else [[ -f images/$(key "$reference") ]] || exit 1; id=$(< "images/$(key "$reference")"); fi
        case "\${4-}" in
          '{{.Id}}') printf '%s\\n' "$id" ;;
          *Config.Env*) cat "environments/\${id#sha256:}" ;;
          *) [[ \${3-} != --format ]] || exit 1 ;;
        esac ;;
      rm) rm -- "images/$(key "\${!#}")" ;;
      *) exit 88 ;;
    esac ;;
  pull)
    [[ -f registry/$(key "$2") ]] || { printf 'manifest unknown: %s\\n' "$2" >&2; exit 1; }
    cp -- "registry/$(key "$2")" "images/$(key "$2")" ;;
  *) exit 88 ;;
esac`;

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'hive-manager-4144-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const directory of ['images', 'registry', 'environments']) mkdirSync(join(cwd, directory));
  writeFileSync(join(cwd, 'docker'), `#!/usr/bin/env bash\nset -eu\n${FAKE_DOCKER}\n`, { mode: 0o700 });
  const image = (store, reference, id) => writeFileSync(join(cwd, store, key(reference)), `${id}\n`);
  const baked = (id, environment) => writeFileSync(join(cwd, 'environments', id.slice('sha256:'.length)), environment);
  const has = reference => existsSync(join(cwd, 'images', key(reference)));
  const log = () => (existsSync(join(cwd, 'docker.log')) ? readFileSync(join(cwd, 'docker.log'), 'utf8') : '');
  const run = args => spawnSync('bash', [manager, ...args], { cwd, env: { ...process.env, PATH: `${cwd}:${process.env.PATH}` }, encoding: 'utf8', timeout: 10000 });
  return { cwd, image, baked, has, log, run };
}

async function socketIn(t, cwd) {
  const path = join(cwd, 'docker.sock');
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(path, resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return path;
}

// The environment Dockerfile.dind / Dockerfile bake into release images.
const releaseEnvironment = variant => ({ ...(variant === 'dind' ? { HIVE_MIND_IMAGE_VARIANT: 'dind' } : {}), HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG: RELEASE });

/** Collect the `--env NAME=VALUE` options from the dry-run plan. */
function plannedEnvironment(stdout) {
  const options = stdout.match(/^Docker options:(.*)$/m)?.[1] ?? '';
  return Object.fromEntries([...options.matchAll(/ --env (\S+)/g)].map(([, pair]) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
}

/** The task image a deployed instance resolves, with its baked environment underneath the manager's. */
function deployedTaskImage(stdout, variant) {
  return getDockerIsolationImage({ env: { ...releaseEnvironment(variant), ...plannedEnvironment(stdout) } });
}

function dryRun(run, args) {
  const result = run(['deploy', '--setup', '--state-dir', 'state', ...args, '--dry-run', 'apply']);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('DinD with a host socket gives tasks the immutable release reference of the instance image', async t => {
  const { cwd, image, baked, run } = fixture(t);
  const socket = await socketIn(t, cwd);
  image('images', 'konard/hive-mind-dind:latest', LATEST_ID);
  image('images', `konard/hive-mind-dind:${RELEASE}`, LATEST_ID);
  baked(LATEST_ID, `PATH=/usr/bin\nHIVE_MIND_IMAGE_VARIANT=dind\nHIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG=${RELEASE}\n`);

  const stdout = dryRun(run, ['--variant', 'dind', '--docker-socket', socket]);
  const environment = plannedEnvironment(stdout);
  const expected = `konard/hive-mind-dind:${RELEASE}`;

  // The original defect: the full reference was passed where a tag belongs.
  assert.equal(environment.HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG, undefined);
  assert.equal(environment.HIVE_MIND_DOCKER_ISOLATION_IMAGE, expected);
  // Passthrough seeds the nested daemon with exactly the image tasks start from.
  assert.equal(environment.DIND_HOST_PASSTHROUGH_IMAGES, expected);
  assert.equal(deployedTaskImage(stdout, 'dind'), expected);
  assert.match(deployedTaskImage(stdout, 'dind'), REFERENCE);
  assert.match(stdout, new RegExp(`^Task image ${expected}$`, 'm'));
  assert.match(stdout, new RegExp(`--label io\\.github\\.link-assistant\\.hive-manager\\.task-image=${expected}`));
});

test('the task image falls back to the deployment reference when the release tag is a different or absent image', async t => {
  const { cwd, image, baked, run } = fixture(t);
  const socket = await socketIn(t, cwd);
  image('images', 'konard/hive-mind-dind:latest', LATEST_ID);
  baked(LATEST_ID, `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG=${RELEASE}\n`);

  const absent = dryRun(run, ['--variant', 'dind', '--docker-socket', socket]);
  assert.equal(deployedTaskImage(absent, 'dind'), 'konard/hive-mind-dind:latest');
  assert.equal(plannedEnvironment(absent).DIND_HOST_PASSTHROUGH_IMAGES, 'konard/hive-mind-dind:latest');

  image('images', `konard/hive-mind-dind:${RELEASE}`, OTHER_ID);
  const different = dryRun(run, ['--variant', 'dind', '--docker-socket', socket]);
  assert.equal(deployedTaskImage(different, 'dind'), 'konard/hive-mind-dind:latest');

  // A custom image that inherits the base release tag but was not pulled yet.
  const unknown = dryRun(run, ['--variant', 'dind', '--docker-socket', socket, '--image', 'registry.example:5000/team/hive:custom']);
  assert.equal(deployedTaskImage(unknown, 'dind'), 'registry.example:5000/team/hive:custom');
  assert.match(deployedTaskImage(unknown, 'dind'), REFERENCE);
});

test('digest and registry-port references keep their repository when pinned', async t => {
  const { cwd, image, baked, run } = fixture(t);
  const socket = await socketIn(t, cwd);
  const digest = `registry.example:5000/team/hive-dind@sha256:${'a'.repeat(64)}`;
  image('images', digest, LATEST_ID);
  image('images', `registry.example:5000/team/hive-dind:${RELEASE}`, LATEST_ID);
  baked(LATEST_ID, `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG=${RELEASE}\n`);

  const stdout = dryRun(run, ['--variant', 'dind', '--docker-socket', socket, '--image', digest]);
  assert.equal(deployedTaskImage(stdout, 'dind'), `registry.example:5000/team/hive-dind:${RELEASE}`);
  assert.match(deployedTaskImage(stdout, 'dind'), REFERENCE);
});

test('prepare pulls the release tag of the instance image and keeps no unrelated image', async t => {
  const { image, baked, has, log, run } = fixture(t);
  image('registry', 'konard/hive-mind-dind:latest', LATEST_ID);
  image('registry', `konard/hive-mind-dind:${RELEASE}`, LATEST_ID);
  baked(LATEST_ID, `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG=${RELEASE}\n`);

  const same = run(['deploy', '--variant', 'dind', 'prepare']);
  assert.equal(same.status, 0, same.stderr);
  assert.match(same.stdout, new RegExp(`^Task image konard/hive-mind-dind:${RELEASE}$`, 'm'));
  assert.ok(has(`konard/hive-mind-dind:${RELEASE}`));

  image('registry', 'team/hive-dind:custom', OTHER_ID);
  image('registry', `team/hive-dind:${RELEASE}`, LATEST_ID);
  baked(OTHER_ID, `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG=${RELEASE}\n`);
  const custom = run(['deploy', '--variant', 'dind', '--image', 'team/hive-dind:custom', 'prepare']);
  assert.equal(custom.status, 0, custom.stderr);
  assert.match(custom.stdout, /^Task image team\/hive-dind:custom$/m);
  assert.ok(!has(`team/hive-dind:${RELEASE}`), 'an image that only shares the release tag is removed again');
  assert.match(log(), new RegExp(`image rm team/hive-dind:${RELEASE}`));

  // Plain instances without a socket run tasks in Screen and need no task image.
  const plain = run(['deploy', '--image', 'team/hive-dind:custom', 'prepare']);
  assert.equal(plain.status, 0, plain.stderr);
  assert.doesNotMatch(plain.stdout, /Task image/);
});

test('operators select the task image with --task-image, the profile or the environment file', async t => {
  const { cwd, image, baked, run } = fixture(t);
  const socket = await socketIn(t, cwd);
  image('images', 'konard/hive-mind-dind:latest', LATEST_ID);
  image('images', `konard/hive-mind-dind:${RELEASE}`, LATEST_ID);
  baked(LATEST_ID, `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG=${RELEASE}\n`);
  const dind = ['--variant', 'dind', '--docker-socket', socket];

  const flag = dryRun(run, [...dind, '--task-image', 'team/tasks:1.2.3']);
  assert.equal(deployedTaskImage(flag, 'dind'), 'team/tasks:1.2.3');
  assert.equal(plannedEnvironment(flag).DIND_HOST_PASSTHROUGH_IMAGES, 'team/tasks:1.2.3');

  writeFileSync(join(cwd, 'profile'), `variant=dind\ndocker-socket=${socket}\ntask-image=team/tasks:4.5.6\n`);
  assert.equal(deployedTaskImage(dryRun(run, ['--profile', 'profile']), 'dind'), 'team/tasks:4.5.6');

  // A tag from the environment file selects that tag of the deployment repository.
  writeFileSync(join(cwd, 'bot.env'), '  HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG=2.48.0\r\n');
  const tagged = dryRun(run, [...dind, '--image', 'team/hive-dind:custom', '--env-file', 'bot.env']);
  assert.equal(deployedTaskImage(tagged, 'dind'), 'team/hive-dind:2.48.0');

  writeFileSync(join(cwd, 'bot.env'), 'HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG=2.48.0\nHIVE_MIND_DOCKER_ISOLATION_IMAGE=team/tasks:7.8.9\n');
  assert.equal(deployedTaskImage(dryRun(run, [...dind, '--env-file', 'bot.env']), 'dind'), 'team/tasks:7.8.9');
  // The command line still wins over the environment file.
  assert.equal(deployedTaskImage(dryRun(run, [...dind, '--env-file', 'bot.env', '--task-image', 'team/tasks:1.2.3']), 'dind'), 'team/tasks:1.2.3');

  // A full reference where a tag belongs is the reported defect: reject it.
  writeFileSync(join(cwd, 'bot.env'), 'HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG=konard/hive-mind-dind:2.49.0\n');
  const invalid = run(['deploy', '--setup', ...dind, '--env-file', 'bot.env', '--dry-run', 'apply']);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /must be a tag, not an image reference/);
  assert.match(run(['deploy', '--setup', ...dind, '--task-image', 'bad image', '--dry-run', 'apply']).stderr, /Invalid task image/);
});

test('plain instances pass a task image only when they use the host Docker socket', async t => {
  const { cwd, image, baked, run } = fixture(t);
  const socket = await socketIn(t, cwd);
  image('images', 'konard/hive-mind:latest', LATEST_ID);
  image('images', `konard/hive-mind:${RELEASE}`, LATEST_ID);
  baked(LATEST_ID, `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG=${RELEASE}\n`);

  const screen = dryRun(run, []);
  assert.deepEqual(plannedEnvironment(screen), { GIT_CONFIG_GLOBAL: '/home/box/.config/git/config', TELEGRAM_ISOLATION: 'screen' });
  assert.doesNotMatch(screen, /Task image/);

  const host = dryRun(run, ['--docker-socket', socket]);
  assert.equal(deployedTaskImage(host, 'plain'), `konard/hive-mind:${RELEASE}`);
  assert.equal(plannedEnvironment(host).DIND_HOST_PASSTHROUGH_IMAGES, undefined);
});
