# Issue 1705: Docker Inside Hive Mind Docker

## Summary

Issue #1705 asks for a Hive Mind Docker image that can run Docker-based tests
from inside the Hive Mind container. The motivating example is Monitor43 PR #2,
where the solver completed static work but could not run `task bdd-pending`
because the environment had no Docker daemon for Testcontainers-backed BDD
checks.

The implementation keeps the existing `konard/hive-mind` image and adds a
separate `konard/hive-mind-dind` image based on the latest Box DinD base,
`konard/box-dind:2.1.1`. This preserves the lower-privilege default image while
giving solvers an explicit image for repositories that require Docker, Docker
Compose, or Testcontainers during verification.

## Preserved Data

- `data/issue-1705.json`: primary issue data.
- `data/issue-1705-comments.json`: issue comments, empty at collection time.
- `data/pr-1736.json`: prepared PR metadata.
- `data/comerc-monitor43-pr-2-comments.txt`: related Monitor43 PR comments.
- `data/box-latest-release.json`: latest Box release metadata captured during implementation.
- `data/box-repo.json`: Box repository metadata.
- `data/box-v2.1.1-dind-Dockerfile`: upstream Box DinD Dockerfile.
- `data/box-v2.1.1-dind-entrypoint.sh`: upstream DinD entrypoint.
- `data/box-v2.1.1-dind-install.sh`: upstream Docker Engine installation script.
- `data/box-issue-80-case-study.md`: upstream Box DinD case study.
- `data/box-issue-80-research.md`: upstream Box DinD research notes.
- `data/research-sources.json`: primary and supporting research links.
- `logs/docker-command-check.log`: local verification that this workspace has no Docker CLI.
- `logs/docker-dind-variant-before.log`: failing regression test before the fix.

## Requirements

1. Hive Mind must provide an image where Docker can run inside the Hive Mind
   container.
2. The change must not replace or break the existing `konard/hive-mind` image.
3. The new image must use the latest `link-foundation/box` DinD work available
   during implementation.
4. Release automation must publish a distinct `hive-mind-dind` image.
5. PR automation must build and verify the new image before merge.
6. The solution must document runtime caveats because Docker-in-Docker needs
   elevated container permissions unless Sysbox is available.
7. The fix must include a reproducing test so future workflow or Dockerfile
   changes cannot silently remove the DinD variant.
8. The issue research, requirements, alternatives, and selected plan must be
   preserved under `docs/case-studies/issue-1705`.

## Relevant Facts

- Box release `v2.1.1` was the latest release when this change was implemented
  and publishes `konard/box-dind:2.1.1`.
- The upstream Box DinD image installs Docker Engine, CLI, Buildx, Compose,
  containerd, and `fuse-overlayfs`.
- The upstream DinD entrypoint starts `dockerd` as root, waits for
  `/var/run/docker.sock`, then hands the requested command to the `box` user
  through Box's normal entrypoint.
- Docker's documented `--privileged` mode gives a container elevated host
  capabilities, so it should remain opt-in rather than become the default Hive
  Mind image behavior.
- Sysbox is a runtime option that can run nested container workloads without
  the same broad privileged-container model, but it requires host installation.
- Mounting the host Docker socket would let the container control the host
  Docker daemon and is a poor default for autonomous solver workloads.
- Testcontainers expects access to a Docker-compatible environment; without it,
  projects with Docker-backed integration tests can only be checked statically.

## Options Considered

### Replace the Default Image With DinD

This is the simplest user experience because every Hive Mind container would
have Docker available. It was rejected because it changes the privilege model
for all users, makes `--privileged` or Sysbox a practical runtime requirement,
and would make users who do not need nested Docker pay for a larger and more
powerful image.

### Publish a Separate DinD Image

This is the selected design. The existing image stays `konard/hive-mind`, while
the Docker-enabled image is published as `konard/hive-mind-dind`. Users opt in
only when a target repository needs Docker-backed tests. The release workflow
can build and publish both images from the same npm release version.

### Mount the Host Docker Socket

This would avoid starting a second Docker daemon, but it exposes the host Docker
daemon to the autonomous container. It also mixes host containers with solver
containers, reducing isolation. It remains a manual user choice, not a baked-in
image design.

### Require Sysbox Only

Sysbox is attractive for shared hosts, but it is not installed by default on
GitHub-hosted runners or many user machines. The docs mention Sysbox as the
preferred shared-host runtime when available, while CI uses `--privileged`
because that is the practical portable verification path.

## Selected Plan

1. Add `Dockerfile.dind` based on `konard/box-dind:2.1.1`.
2. Keep installing the same Hive Mind AI tooling, MCP setup, and
   `configure-claude` baseline used by the normal Docker image.
3. End the DinD image as `USER root` with
   `ENTRYPOINT ["/usr/local/bin/dind-entrypoint.sh"]`, matching the upstream
   Box contract that starts `dockerd` and then drops to `box`.
4. Default the inner daemon to `DIND_STORAGE_DRIVER=vfs` so the smoke path works
   on overlay-backed hosts where nested `overlay2` returns `invalid argument`;
   callers can still opt into `overlay2` or `fuse-overlayfs` at runtime.
5. Update release workflow PR checks to build both Dockerfiles and run nested
   `docker run hello-world` inside the DinD image.
6. Add Docker Hub publish jobs for `konard/hive-mind-dind` in both normal and
   instant release paths, using the same published npm version as the standard
   image.
7. Update change detection so `Dockerfile.dind` triggers Docker checks.
8. Document the image and runtime requirements in Docker docs.
9. Add `tests/test-docker-dind-variant.mjs` to lock the Dockerfile, docs, change
   detection, PR verification, and release publishing contract.

## Verification Notes

The local workspace does not have the Docker CLI installed, so the full Docker
build and nested daemon smoke test cannot run here. This was recorded in
`logs/docker-command-check.log`. The GitHub Actions Docker PR check runs on an
Ubuntu runner with Docker and now verifies the DinD image with:

```bash
docker run --rm --privileged konard/hive-mind-dind:test bash -lc 'docker info && docker run hello-world'
```

The reproducing local test first failed with `Dockerfile.dind should exist`;
after the implementation it validates the new image, docs, change detection,
and release workflow wiring.

The first PR CI Docker smoke run built both images but failed nested Docker
startup because upstream auto-detection selected `overlay2` and dockerd logged
`failed to mount overlay: invalid argument`. The image now defaults
`DIND_STORAGE_DRIVER=vfs`, preserving a runtime override for hosts that support
faster nested overlay drivers.

## Source Links

- Hive Mind issue #1705: https://github.com/link-assistant/hive-mind/issues/1705
- Related Monitor43 PR #2: https://github.com/comerc/monitor43/pull/2#issuecomment-4334939125
- Box release v2.1.1: https://github.com/link-foundation/box/releases/tag/v2.1.1
- Box issue #80 case study: https://github.com/link-foundation/box/blob/v2.1.1/docs/case-studies/issue-80/CASE-STUDY.md
- Docker run reference: https://docs.docker.com/engine/containers/run/
- Docker Engine Ubuntu install: https://docs.docker.com/engine/install/ubuntu/
- Sysbox: https://github.com/nestybox/sysbox
- Testcontainers supported Docker environments: https://java.testcontainers.org/supported_docker_environment/
- OWASP Docker Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html
- Docker socket risk analysis: https://blog.quarkslab.com/why-is-exposing-the-docker-socket-a-really-bad-idea.html
