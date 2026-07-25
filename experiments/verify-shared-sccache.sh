#!/bin/sh
set -eu

SCCACHE_VERSION="${SCCACHE_VERSION:-0.16.0}"
experiment_root="$(mktemp -d)"
trap 'rm -rf "$experiment_root"' EXIT

case "$(uname -m)" in
  x86_64) sccache_arch=x86_64 ;;
  aarch64) sccache_arch=aarch64 ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

package="sccache-v${SCCACHE_VERSION}-${sccache_arch}-unknown-linux-musl"
release="https://github.com/mozilla/sccache/releases/download/v${SCCACHE_VERSION}"
curl -fsSL "$release/$package.tar.gz" -o "$experiment_root/sccache.tar.gz"
curl -fsSL "$release/$package.tar.gz.sha256" -o "$experiment_root/sccache.sha256"
echo "$(cat "$experiment_root/sccache.sha256")  $experiment_root/sccache.tar.gz" | sha256sum -c -
tar -xzf "$experiment_root/sccache.tar.gz" -C "$experiment_root"
mkdir "$experiment_root/bin"
cp "$experiment_root/$package/sccache" "$experiment_root/bin/sccache"
chmod +x "$experiment_root/bin/sccache"

create_checkout() {
  mkdir -p "$experiment_root/container-workspace/src"
  git -C "$experiment_root/container-workspace" init -q
  printf '[package]\nname = "shared-cache-proof"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nitoa = "=1.0.15"\n\n[lib]\npath = "src/lib.rs"\n' > "$experiment_root/container-workspace/Cargo.toml"
  printf 'pub fn answer() -> String { itoa::Buffer::new().format(42).to_owned() }\n' > "$experiment_root/container-workspace/src/lib.rs"
}

create_checkout

export PATH="$experiment_root/bin:$PATH"
export RUSTC_WRAPPER="$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)/src/hive-mind-sccache"
export SCCACHE_DIR="$experiment_root/shared-cache"
export SCCACHE_CACHE_SIZE=100M
export CARGO_INCREMENTAL=0

sccache --stop-server >/dev/null 2>&1 || true
sccache --zero-stats >/dev/null
(cd "$experiment_root/container-workspace" && cargo build)
cp "$experiment_root/container-workspace/Cargo.lock" "$experiment_root/Cargo.lock"
sccache --stop-server >/dev/null
rm -rf "$experiment_root/container-workspace"
create_checkout
cp "$experiment_root/Cargo.lock" "$experiment_root/container-workspace/Cargo.lock"

(cd "$experiment_root/container-workspace" && cargo build --locked)
stats="$(sccache --show-stats)"
printf '%s\n' "$stats"
hits="$(printf '%s\n' "$stats" | awk '/^Cache hits[[:space:]]/ { print $3; exit }')"
test "${hits:-0}" -gt 0
test -d "$experiment_root/shared-cache"
echo "Verified a cache hit across independent checkouts after deleting the first target/ tree."
