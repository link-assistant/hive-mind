#!/usr/bin/env bash
# Verify the Git config mount through a real local Docker socket using disposable containers.
set -euo pipefail

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
fixture=$(mktemp -d)
cli_container=''
cleanup() {
  if [[ $cli_container ]]; then docker rm "$cli_container" >/dev/null || true; fi
  rm -rf -- "$fixture"
}
trap cleanup EXIT

image=${HIVE_TEST_NODE_IMAGE:-node:24-alpine}
cli_image=${HIVE_TEST_DOCKER_CLI_IMAGE:-docker:29-cli}
docker image inspect "$image" "$cli_image" >/dev/null
cli_container=$(docker create --pull never "$cli_image")
docker cp "$cli_container:/usr/local/bin/docker" "$fixture/docker"
mkdir -- "$fixture/gh" "$fixture/git"
printf '[user]\n  name = Hive Test\n  email = fixture@example.invalid\n' > "$fixture/git/config"

for layout in unbacked file-bind directory-bind; do
  git_bind=()
  case "$layout" in
    file-bind) git_bind=(--mount "type=bind,source=$fixture/git/config,target=/home/box/.gitconfig,readonly") ;;
    directory-bind) git_bind=(--mount "type=bind,source=$fixture/git,target=/home/box/.config/git,readonly") ;;
  esac
  docker run --rm --pull never --network none -i \
    --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
    --mount "type=bind,source=$fixture/docker,target=/usr/local/bin/docker,readonly" \
    --mount "type=bind,source=$fixture/gh,target=/home/box/.config/gh,readonly" \
    --mount "type=bind,source=$repo/src,target=/hive,readonly" \
    "${git_bind[@]}" "$image" node --input-type=module - "$layout" "$image" "$fixture" <<'NODE'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { DockerMountBackingError, resolveDockerIsolationMountSources } from '/hive/docker-mount-namespace.lib.mjs';

const [, , layout, image, hostState] = process.argv;
const gitTarget = '/home/box/.gitconfig';
const source = layout === 'directory-bind' ? '/home/box/.config/git/config' : gitTarget;
if (layout === 'unbacked') writeFileSync(source, 'synthetic private config');
const mounts = [{ source: '/home/box/.config/gh', target: '/home/box/.config/gh' }, { source, target: gitTarget }];
const result = resolveDockerIsolationMountSources({ mounts, image, env: { ...process.env, DOCKER_HOST: 'unix:///var/run/docker.sock' } });
if (layout === 'unbacked') {
  await assert.rejects(result, error => error instanceof DockerMountBackingError && error.message.includes(`source "${source}"`));
} else {
  const [, mount] = await result;
  assert.deepEqual(mount, { source: `${hostState}/git/config`, target: gitTarget });
  const contents = execFileSync('docker', ['run', '--rm', '--pull', 'never', '--network', 'none', '--mount', `type=bind,source=${mount.source},target=${mount.target},readonly`, image, 'cat', mount.target]);
  assert.deepEqual(contents, readFileSync(source));
}
console.log(`DooD ${layout} verified`);
NODE
done
