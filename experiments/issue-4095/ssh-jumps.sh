#!/usr/bin/env bash
# Exercise two real OpenSSH jump hosts and strict host-key checks.
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
tmp=$(mktemp -d)
prefix=hive-manager-ssh-$$
image=$prefix:local
cleanup() {
  if (( $? )); then
    for server in one two target; do docker logs --tail 12 "$prefix-$server" >&2 || :; done
  fi
  docker rm -f "$prefix-one" "$prefix-two" "$prefix-target" >/dev/null 2>&1 || :
  docker network rm "$prefix-front" "$prefix-back" >/dev/null 2>&1 || :
  docker image rm "$image" >/dev/null 2>&1 || :
  rm -rf -- "$tmp"
}
trap cleanup EXIT

docker build --tag "$image" - <<'DOCKERFILE'
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server && \
    rm -rf /var/lib/apt/lists/* && mkdir -p /run/sshd && \
    useradd --create-home box && passwd -d box && \
    printf '#!/bin/bash\nshift 5\nexec "$@"\n' >/usr/local/bin/docker && chmod +x /usr/local/bin/docker
ENTRYPOINT ["/bin/sh","-ec","install -m 644 /client.pub /etc/ssh/manager-authorized-keys; exec /usr/sbin/sshd -D -e -h /etc/ssh/manager-host-key -o AuthorizedKeysFile=/etc/ssh/manager-authorized-keys -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no"]
DOCKERFILE

ssh-keygen -q -t ed25519 -N '' -f "$tmp/client"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/host"
printf 'first,second,target %s\n' "$(cat "$tmp/host.pub")" > "$tmp/known_hosts"
docker network create "$prefix-front" >/dev/null
docker network create "$prefix-back" >/dev/null
for name in one two target; do
  publish=()
  network=$prefix-front
  if [[ $name == one ]]; then publish=(-p 127.0.0.1::22); fi
  if [[ $name == target ]]; then network=$prefix-back; fi
  docker run -d --name "$prefix-$name" --network "$network" "${publish[@]}" \
    --mount "type=bind,source=$tmp/host,target=/etc/ssh/manager-host-key,readonly" \
    --mount "type=bind,source=$tmp/client.pub,target=/client.pub,readonly" "$image" >/dev/null
done
docker network connect "$prefix-back" "$prefix-two"
port=$(docker port "$prefix-one" 22/tcp)
cat > "$tmp/config" <<CONFIG
Host first
  HostName 127.0.0.1
  Port ${port##*:}
  HostKeyAlias first
Host second
  HostName $prefix-two
  HostKeyAlias second
Host target
  HostName $prefix-target
  HostKeyAlias target
Host *
  User box
  StrictHostKeyChecking yes
  UserKnownHostsFile $tmp/known_hosts
  IdentitiesOnly yes
  IdentityFile $tmp/client
  BatchMode yes
  ConnectTimeout 10
CONFIG

for ((attempt = 0; attempt < 5; attempt++)); do
  if ssh -F "$tmp/config" first true; then break; fi
  sleep 1
done

manager=(bash "$repo/src/hive-manager.sh" --ssh-config "$tmp/config" --jump first,second --host target)
set +e
result=$(printf 'stdin over two hops\n' | "${manager[@]}" deploy exec -- sh -c 'printf "%s\n" "$1"; cat; exit 17' _ "quoted ' argument")
status=$?
set -e
[[ $status == 17 ]]
[[ $result == "$(printf '%s\n' "quoted ' argument" 'stdin over two hops')" ]]
printf '%s\n' 'OpenSSH two-jump smoke passed'
