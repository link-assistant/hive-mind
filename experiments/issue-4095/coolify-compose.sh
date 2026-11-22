#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export GITHUB_URL=https://github.com/example/fixture

src/hive-manager/cli.sh deploy compose -f coolify/docker-compose.yml --env-file /dev/null config --format json |
  node --input-type=module -e '
    import assert from "node:assert/strict";
    import { existsSync, readFileSync } from "node:fs";
    import { resolve } from "node:path";

    const { services } = JSON.parse(readFileSync(0, "utf8"));
    const service = services["hive-mind"];
    assert.equal(service.environment.GITHUB_URL, process.env.GITHUB_URL);
    assert.equal(service.build.context, process.cwd());
    assert.ok(existsSync(resolve(service.build.context, service.build.dockerfile)));
    assert.ok(service.volumes.some(mount => mount.source === resolve("coolify/claude-config") && mount.target === "/home/box/.claude"));
    console.log("Coolify Compose forwards the monitor URL and resolves the build and state paths.");
  '
