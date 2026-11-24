#!/usr/bin/env bash
# Exercise package selection over real OpenSSH and npm with offline fixtures.
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
manager=${HIVE_MANAGER_UNDER_TEST:-$repo/src/hive-manager/cli.sh}
tmp=$(mktemp -d)
container=hive-manager-4135-$$
image=$container:local
cleanup() {
  if (( $? )); then
    if [[ -f $tmp/dispatch ]]; then cat "$tmp/dispatch" >&2; fi
    docker logs --tail 10 "$container" >&2 || :
  fi
  docker rm -f "$container" >/dev/null 2>&1 || :
  docker image rm "$image" >/dev/null 2>&1 || :
  rm -rf -- "$tmp"
}
trap cleanup EXIT

docker build -q -t "$image" - <<'DOCKERFILE'
FROM alpine:3.23
RUN apk add --no-cache bash nodejs npm openssh-server && passwd -d root
DOCKERFILE

package=@link-assistant/hive-mind
pin=2.48.0
for version in "$pin" 2.49.0; do
  pkg=$tmp/$version
  mkdir -p "$pkg/src/hive-manager"/{lib,storage}
  printf '{"name":"%s","version":"%s","bin":{"hive":"src/hive.mjs"}}\n' "$package" "$version" > "$pkg/package.json"
  printf '#!/usr/bin/env node\n' > "$pkg/src/hive.mjs"
  chmod +x "$pkg/src/hive.mjs"
  touch "$pkg/src/hive-manager/lib/terminal.mjs"
  cat > "$pkg/src/hive-manager/storage/main.mjs" <<MODULE
import { readFileSync } from 'node:fs';
console.log(JSON.stringify({ release: '$version', args: process.argv.slice(2), input: readFileSync(0, 'utf8') }));
process.exitCode = 17;
MODULE
done
mkdir "$tmp/installed" "$tmp/selected"
ln -s "/fixture/$pin/src/hive.mjs" "$tmp/selected/hive"
cat > "$tmp/installed/npm" <<'NPM_SHIM'
#!/usr/bin/env bash
set -eu
[[ "$1 $2 $3 $5" == 'exec --yes --package --' ]]
printf 'npm requested <%s>\n' "$4" >&2
shift 5
export PATH="/fixture/selected:$PATH"
exec "$@"
NPM_SHIM
chmod +x "$tmp/installed/npm"

ssh-keygen -q -t ed25519 -N '' -f "$tmp/client"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/host"
printf 'stage %s\n' "$(cat "$tmp/host.pub")" > "$tmp/known_hosts"
docker run -d --name "$container" -p 127.0.0.1::22 \
  --mount "type=bind,source=$tmp,target=/fixture,readonly" "$image" sh -ec '
  mkdir -m 700 /root/.ssh
  cp /fixture/client.pub /root/.ssh/authorized_keys
  printf "PATH=/fixture/installed:/usr/bin:/bin\n" > /root/.ssh/environment
  exec /usr/sbin/sshd -D -e -h /fixture/host -o PermitRootLogin=prohibit-password \
    -o PermitUserEnvironment=PATH -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no
' >/dev/null
port=$(docker port "$container" 22/tcp)
cat > "$tmp/config" <<CONFIG
Host stage
  HostName 127.0.0.1
  HostKeyAlias stage
  Port ${port##*:}
  User root
  StrictHostKeyChecking yes
  UserKnownHostsFile $tmp/known_hosts
  IdentitiesOnly yes
  IdentityFile $tmp/client
  BatchMode yes
CONFIG
for ((attempt = 0; attempt < 5; attempt++)); do
  if ssh -F "$tmp/config" stage true; then break; fi
  sleep 1
done

probe() {
  local result code=0
  result=$(printf 'input\n' | env HIVE_MANAGER_PACKAGE_VERSION="$pin" HIVE_MANAGER_PACKAGE_DIAGNOSTICS=1 \
    bash "$manager" --ssh-config "$tmp/config" --host stage deploy --state-dir '/state dir' disk --help \
    "a 'quote'" '' 2> "$tmp/dispatch") || code=$?
  [[ $code == 17 ]]
  [[ $result == "{\"release\":\"$pin\",\"args\":[\"disk\",\"\",\"hive-mind\",\"/state dir\",\"--help\",\"a 'quote'\",\"\"],\"input\":\"input\\n\"}" ]]
}

probe
grep -Fx "npm requested <$package@$pin>" "$tmp/dispatch"
ln -s /fixture/2.49.0/src/hive.mjs "$tmp/installed/hive"
probe
grep -F "skipping installed package $package@2.49.0" "$tmp/dispatch"
ln -sfn "/fixture/$pin/src/hive.mjs" "$tmp/installed/hive"
probe
grep -Fx "hive-manager: installed package $package@$pin" "$tmp/dispatch"
if grep -q 'npm requested' "$tmp/dispatch"; then exit 1; fi

# Exercise the actual npm argument transport with an offline local dependency.
rm -- "$tmp/installed/npm" "$tmp/installed/hive"
docker exec "$container" sh -ec '
  cd /root
  printf "offline=true\n" > .npmrc
  printf "{\"dependencies\":{\"@link-assistant/hive-mind\":\"%s\"}}\n" "$1" > package.json
  mkdir -p node_modules/@link-assistant node_modules/.bin
  ln -s "/fixture/$1" node_modules/@link-assistant/hive-mind
  ln -s "/fixture/$1/src/hive.mjs" node_modules/.bin/hive
' fixture "$pin"
probe
grep -Fx "hive-manager: npm package $package@$pin" "$tmp/dispatch"
printf 'OpenSSH package selection smoke passed\n'
