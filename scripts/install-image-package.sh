#!/usr/bin/env bash
# Install the PR's npm package, with the same files/dependencies as a release.
# The build context is read-only; generated archives never enter the image layer.
#
# Issue #4050: the native Codex executable is not in the main tarball any more.
# A release installs it from the registry as the optional dependency alias
# @link-assistant/hive-mind-native-codex-linux-<arch>; a pull request has no
# published variant, so this installs the same packed variant at that alias.
set -euo pipefail
package_source=${1:?source directory required}
package_stage=$(mktemp -d /tmp/hive-mind-package-XXXXXX)
trap 'rm -rf "$package_stage"' EXIT
package_archive=$(cd "$package_source" && npm pack --ignore-scripts --silent --pack-destination "$package_stage")
package_archive="$package_stage/$package_archive"
test -f "$package_archive"
# These are runtime inputs, not development scripts mounted into a test image.
package_files=$(tar -tzf "$package_archive")
for package_file in src/hive.mjs src/verify-agent-runtime.mjs src/codex-stock-skills-0.164.0.json src/install-native-gemini.mjs src/native-gemini/recipe/manifest.json src/install-native-codex.mjs src/native-codex/recipe.json; do
  grep -Fx "package/$package_file" >/dev/null <<<"$package_files"
done
# The executables must never return to the main tarball (npm refused it with E413).
if grep -q '^package/src/native-codex/runtime/' <<<"$package_files"; then
  echo "ERROR: the main npm tarball bundles native Codex executables; see src/native-codex/PACKAGES.md" >&2
  exit 1
fi
case "$(uname -m)" in
  x86_64 | amd64) native_platform=linux-x64 ;;
  aarch64 | arm64) native_platform=linux-arm64 ;;
  *) echo "ERROR: no native Codex variant for $(uname -m)" >&2; exit 1 ;;
esac
node "$package_source/scripts/native-codex-packages.mjs" pack "$package_stage/variants" --runtime "$package_source/src/native-codex/runtime" --platform "$native_platform" --no-verify
variant_archive=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))[0].archive' "$package_stage/variants/variants.json")
variant_alias=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))[0].alias' "$package_stage/variants/variants.json")
# Native byte admission requires independent files, including package metadata;
# Bun's default hardlinks would alias its writable package cache.
bun install --backend=copyfile -g "$package_archive"
package_version=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version' "$package_source/package.json")
test "$(hive --version)" = "$package_version"
# Place the variant where the registry install would: next to the main package
# in Bun's global node_modules. Extraction writes independent (nlink 1) files.
hive_root=$(dirname "$(dirname "$(readlink -f "$(command -v hive)")")")
global_modules=$(dirname "$(dirname "$hive_root")")
test "$(basename "$global_modules")" = node_modules
variant_root="$global_modules/$variant_alias"
test ! -e "$variant_root"
mkdir -p "$variant_root"
tar -xzf "$variant_archive" -C "$variant_root" --strip-components=1 --no-same-owner
test -f "$variant_root/runtime/$native_platform/codex"
