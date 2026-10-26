#!/usr/bin/env bash
# Install the PR's npm package, with the same files/dependencies as a release.
# The build context is read-only; generated archives never enter the image layer.
set -euo pipefail
package_source=${1:?source directory required}
package_stage=$(mktemp -d /tmp/hive-mind-package-XXXXXX)
trap 'rm -rf "$package_stage"' EXIT
package_archive=$(cd "$package_source" && npm pack --ignore-scripts --silent --pack-destination "$package_stage")
package_archive="$package_stage/$package_archive"
test -f "$package_archive"
# These are runtime inputs, not development scripts mounted into a test image.
for package_file in src/hive.mjs src/verify-agent-runtime.mjs src/codex-stock-skills-0.164.0.json; do
  tar -tzf "$package_archive" | grep -Fx "package/$package_file" >/dev/null
done
bun install -g "$package_archive"
package_version=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version' "$package_source/package.json")
test "$(hive --version)" = "$package_version"
