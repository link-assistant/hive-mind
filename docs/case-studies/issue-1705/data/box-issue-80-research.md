# Research: Building a `konard/super-box` (Docker-in-Box) Image

Background research for [issue #80](https://github.com/link-foundation/box/issues/80). The goal is a `super-box`
image that is a drop-in superset of `konard/box` (Ubuntu 24.04, non-root `box` user, multi-arch amd64+arm64,
published to Docker Hub and ghcr.io) plus the ability to launch and control Docker containers from inside it.
Where possible we also want each `super-box` instance to only "see" containers it created, so the host stays
reasonably safe.

This document is research-only. No code, no Dockerfile.

---

## 1) Patterns for nested containers

### 1a. Docker-in-Docker (DinD) with `docker:dind` and `--privileged`

The official [`docker`](https://hub.docker.com/_/docker) image ships a `dind` variant that runs a full `dockerd`
inside the container. It is the canonical pattern documented by Docker and used by GitLab Runner
([GitLab docs on `docker:dind`](https://docs.gitlab.com/ci/docker/using_docker_build/)).

- Privilege: requires `--privileged` (or a very wide cap-add + AppArmor/seccomp unconfined profile).
- Security posture: weak. `--privileged` essentially removes container/host isolation; container root effectively
  has host root via device access, capability set, and disabled LSM profiles
  ([GitLab forum](https://forum.gitlab.com/t/docker-in-docker-dind-privileged-true/73526),
  [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)).
- Performance: an extra storage driver layer (overlay-on-overlay) and a second daemon. Noticeable but acceptable
  for CI.
- Ergonomics: best-known pattern; tons of examples; works on plain Docker without extra runtimes.
- Gotchas: storage-driver issues on overlay-on-overlay, MTU/DNS quirks for the inner daemon,
  TLS handshake noise from `dockerd`, and the fact that a privileged DinD is roughly equivalent to giving the
  container root on the host
  ([jpetazzo's classic warning](https://github.com/jpetazzo/dind#warning-the-resulting-images-are-not-meant-to-replace-real-vms)).

### 1b. Docker-out-of-Docker (DooD) by mounting `/var/run/docker.sock`

Mount the host socket into the container; the container's `docker` CLI talks to the host daemon. Used by VS Code's
[`docker-outside-of-docker` Dev Container Feature](https://github.com/devcontainers/features/tree/main/src/docker-outside-of-docker).

- Privilege: no `--privileged`, but membership in the `docker` group inside the container is *de facto* root on the
  host
  ([raesene "The Dangers of docker.sock"](https://raesene.github.io/blog/2016/03/06/The-Dangers-Of-Docker.sock/),
  [Quarkslab analysis](https://blog.quarkslab.com/why-is-exposing-the-docker-socket-a-really-bad-idea.html)).
- Security posture: very weak from a host-safety standpoint (full daemon API access).
- Performance: negligible overhead.
- Ergonomics: any container the inner CLI starts is a *sibling* on the host, not a child. Bind-mounting
  workspace paths is awkward because paths are host paths, not container paths.
- Gotchas: read-only socket does not help much (`docker inspect` still leaks secrets); any compromise of the
  super-box is a host compromise.

### 1c. Rootless Docker-in-Docker (`docker:dind-rootless`)

The same official image but with `dockerd` running as a non-root user inside a user namespace
([Docker rootless docs](https://docs.docker.com/engine/security/rootless/),
[`Dockerfile-dind-rootless.template`](https://github.com/docker-library/docker/blob/master/Dockerfile-dind-rootless.template)).

- Privilege: still requires `--privileged` (or carefully crafted seccomp/AppArmor exemptions and unprivileged
  user-namespace support on the host); rootless reduces, but does not eliminate, the need to relax the LSM mask
  ([Docker rootless tips](https://docs.docker.com/engine/security/rootless/tips/)).
- Security posture: stronger than 1a. A daemon escape lands you as a remapped UID, not host root.
- Performance: comparable to DinD; some networking restrictions (slirp4netns is slower than bridge).
- Ergonomics: fewer caps in the inner daemon (no AppArmor inside, no overlay-fs without fuse-overlayfs).
- Gotchas: Ubuntu 23.10+ restricts unprivileged user namespaces by AppArmor, which breaks rootless DinD until you
  install the right profile or set `kernel.apparmor_restrict_unprivileged_userns=0`
  ([spad.uk write-up](https://www.spad.uk/posts/rootless-dind-noble/)).
  Ubuntu 24.04 ("noble") inherits this restriction, which directly affects this project.

### 1d. Sysbox runtime (Nestybox / Docker)

[`nestybox/sysbox`](https://github.com/nestybox/sysbox) is an OCI runtime (`sysbox-runc`) that turns containers into
"system containers" capable of running `systemd`, `dockerd`, and `kubelet` *without* `--privileged` and without
exposing the host socket
([Sysbox DinD guide](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/dind.md),
[Nestybox blog "Secure DinD"](https://blog.nestybox.com/2019/09/14/dind.html)).

- Privilege: none beyond what Sysbox itself grants; container root maps to an unprivileged host UID via user-ns.
- Security posture: strongest of the practical "real Docker inside" options.
- Performance: comparable to native; uses shiftfs/idmapped mounts to avoid `chown` storms.
- Ergonomics: identical UX to running `docker:dind`, just `--runtime=sysbox-runc`.
- Gotchas: requires the host operator to install Sysbox; not available on Docker Desktop or hosted CI by default;
  Nestybox was acquired by Docker Inc. in 2022 but the project remains community-driven.

### 1e. Podman-in-Podman

Podman is daemonless and supports rootless nesting natively
([Podman rootless tutorial](https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md),
[issue #15419 nested rootless](https://github.com/containers/podman/issues/15419)).

- Privilege: none; containers run in the user's namespace.
- Security posture: very strong if subuid/subgid ranges are sized correctly.
- Performance: good; fuse-overlayfs adds some overhead.
- Ergonomics: `podman` CLI is mostly Docker-compatible (`alias docker=podman`), but Compose/Buildx parity is not 1:1;
  some images that hard-code `/var/run/docker.sock` will need work.
- Gotchas: nested user namespaces require enough subuid/subgid range; "potentially insufficient UIDs/GIDs" errors are
  the canonical failure mode.

### 1f. Kaniko / BuildKit (build-only)

Not full daemons, but solve the most common "I need DinD just to build" use case.

- [`GoogleContainerTools/kaniko`](https://github.com/GoogleContainerTools/kaniko) — daemonless, no privileges, no
  nested containers; archived January 2025 with maintenance picked up by Chainguard.
- [`moby/buildkit`](https://github.com/moby/buildkit) (and `buildkit:rootless`) — modern replacement for Kaniko,
  used under the hood by `docker buildx`; supports rootless.
- For `super-box`, BuildKit/Buildx are useful as a *complement* (faster, safer image builds), but neither lets
  you `docker run` arbitrary containers, which is the user-facing requirement of this issue.

---

## 2) Per-container scoping of `docker ps -a`

### 2a. Built-in Docker

- **Label filters** (`docker ps --filter label=...`,
  [docs](https://docs.docker.com/engine/cli/filter/)) are *advisory*: they hide rows for the user, but the daemon
  still serves the full list to anyone with socket access. A super-box that sets a unique label on every container
  it creates and aliases `docker ps` to filter by that label is a UX convenience, *not* a security boundary.
- **userns-remap** ([docs](https://docs.docker.com/engine/security/userns-remap/)) is daemon-wide, not per-container
  caller, so it does not partition the visibility of `docker ps`.
- **Docker contexts** are CLI-side connection profiles; they do not change what a given daemon shows.

Conclusion: **Docker has no native multi-tenant view of `docker ps`.** Anyone who can reach the socket sees all
containers on that daemon.

### 2b. Socket proxies in front of `docker.sock`

- [`Tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy) — HAProxy with environment-flag
  ACLs on API endpoints (e.g. `CONTAINERS=1 POST=0`). Endpoint-level only; cannot filter response bodies.
- [`linuxserver/docker-socket-proxy`](https://github.com/linuxserver/docker-socket-proxy) — fork of the Tecnativa
  proxy.
- [`titpetric/docker-proxy-acl`](https://github.com/titpetric/docker-proxy-acl) and
  [`qdm12/docker-proxy-acl-alpine`](https://github.com/qdm12/docker-proxy-acl-alpine) — minimal allowlist proxies for
  endpoints (sometimes referred to as "jpillora-style" though jpillora's project is no longer the canonical one).
- [`FoxxMD/docker-proxy-filter`](https://github.com/FoxxMD/docker-proxy-filter) — sits behind a Tecnativa-style proxy
  and **rewrites** API responses, filtering `/containers/json` results by name and by label, returning 404 for
  inspect/exec/logs on containers that do not match
  ([explanatory blog post](https://blog.foxxmd.dev/posts/restricting-socket-proxy-by-container/)). This is the
  closest off-the-shelf primitive for the requested behaviour.
- [`DataDog/docker-filter`](https://github.com/DataDog/docker-filter) — older, archived, similar idea (read-only
  filtering proxy).

### 2c. Authorization plugins

Docker's authz plugin API ([docs](https://docs.docker.com/engine/extend/plugins_authorization/)) lets a daemon defer
each request to an external service. Two reference implementations:

- [`twistlock/authz`](https://github.com/twistlock/authz) — simple regex/policy file, user-based.
- [`casbin/docker-casbin-plugin`](https://github.com/casbin/docker-casbin-plugin) — Casbin engine, supports
  ACL/RBAC/ABAC.

Plugins can deny calls but they have limited ability to *rewrite* responses, so trimming `docker ps` output is
awkward. Better suited to "block create/exec on containers you do not own" than to producing a per-tenant view.

### 2d. Nested DinD (each box has its own daemon)

Because every super-box runs its own `dockerd` (option 1a/1c/1d), the inner daemon **only knows about containers
it created**. `docker ps -a` inside a super-box trivially returns only that box's children. This is the strongest
isolation guarantee for the host-safety goal: the host daemon is never reachable, the inner daemon's API is only
reachable inside the box, and one box cannot enumerate or kill another box's containers because they are on
different daemons. The cost is a privileged-or-Sysbox runtime requirement.

### 2e. Recommendation for strongest isolation

Ranked best-to-worst against the "host stays safe AND `docker ps` is naturally scoped" goal:

1. **Sysbox + nested DinD** — natural per-box scoping, no `--privileged`, no host socket.
2. **Rootless DinD (`docker:dind-rootless`)** — natural per-box scoping, still needs `--privileged` but escape lands
   in user-ns, not host root.
3. **Privileged DinD (`docker:dind`)** — natural per-box scoping, but a container escape is host root.
4. **DooD with `Tecnativa proxy` + `FoxxMD docker-proxy-filter`, scoped by a label set at container creation
   time** — host daemon is shared, scoping is enforced by the proxy. Weaker because anyone who can bypass the
   proxy reaches the host daemon.
5. **DooD with raw `docker.sock`** — *do not ship*. No isolation.

For a public image, Sysbox is the most defensible default but cannot be assumed to exist on the user's host. A
practical answer is: ship `super-box` as DinD by default (works everywhere with `--privileged`), document Sysbox
as the recommended secure runtime, and explicitly call out DooD as "convenience mode only".

---

## 3) Existing similar images / projects

- [`docker:dind`](https://hub.docker.com/_/docker) — official; Alpine-based; canonical reference.
- [`docker:dind-rootless`](https://hub.docker.com/_/docker) — official rootless variant; UID 1000.
- [`cruizba/ubuntu-dind`](https://github.com/cruizba/ubuntu-dind) — Ubuntu-based DinD with focal/jammy/noble tags,
  Buildx and Compose pre-installed, multi-arch (amd64/arm64). Closest analogue to what `super-box` wants.
- [`nestybox/ubuntu-bionic-systemd-docker`](https://hub.docker.com/r/nestybox/ubuntu-bionic-systemd-docker) and
  [`nestybox/dockerfiles`](https://github.com/nestybox/dockerfiles) — Sysbox-blessed system container images
  ("works only with `--runtime=sysbox-runc`").
- [`devcontainers/features` `docker-in-docker`](https://github.com/devcontainers/features/tree/main/src/docker-in-docker)
  — installer scripts that add `dockerd` to a Dev Container; designed for `--privileged` runs.
- [`devcontainers/features` `docker-outside-of-docker`](https://github.com/devcontainers/features/tree/main/src/docker-outside-of-docker)
  — installer scripts that add the Docker CLI and forward the host socket.
- [`myoung34/docker-github-actions-runner`](https://github.com/myoung34/docker-github-actions-runner) — Ubuntu-based
  self-hosted GitHub Actions runner image that bundles Docker; useful template for "Docker plus a non-root user
  plus an entrypoint that starts `dockerd`".
- [`actions-runner-controller/runner-images`](https://github.com/actions-runner-controller/runner-images) — official
  ARC runner images; same pattern at larger scale.
- [`tcardonne/docker-github-runner`](https://github.com/tcardonne/docker-github-runner) — alternative Ubuntu runner
  with Docker.
- [`jpetazzo/dind`](https://github.com/jpetazzo/dind) — historical reference and the original "warning, this is
  dangerous" essay by the author of DinD.
- [GitLab Runner DinD docs](https://docs.gitlab.com/ci/docker/using_docker_build/) — battle-tested DinD service
  pattern with `privileged = true` and a `tls`/non-tls split.
- [`moby/buildkit`](https://github.com/moby/buildkit) and
  [`GoogleContainerTools/kaniko`](https://github.com/GoogleContainerTools/kaniko) — for build-only scenarios.

The closest thing to "drop-in basis for `super-box`" is `cruizba/ubuntu-dind`: Ubuntu, multi-arch, includes Compose
and Buildx, and exposes a `start-docker.sh` entrypoint. The simplest path is to use the same recipe
(`apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin` plus an
init script) on top of `konard/box-essentials` and add the runtime layers via the existing `COPY --from` merge.

---

## 4) Risk summary and minimum README warnings

For a publicly published `konard/super-box` image, the README and the image description should make at least the
following points unambiguous:

- **Default mode requires `--privileged`.** Running this image with `docker run --privileged konard/super-box` is
  effectively equivalent to giving the container root on the host kernel. Do not run untrusted code or
  user-supplied workflows in this mode unless you accept that escape == host compromise
  ([OWASP Docker Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)).
- **Do not bind-mount the host `docker.sock` into this image.** Users following old DooD examples will be tempted
  to. Mounting the host socket is documented by Docker, OWASP, and Quarkslab as a host-takeover vector
  ([Quarkslab](https://blog.quarkslab.com/why-is-exposing-the-docker-socket-a-really-bad-idea.html)).
- **Prefer Sysbox where available.** Document
  `docker run --runtime=sysbox-runc konard/super-box` as the recommended secure invocation and link to
  [Sysbox installation](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/install-package.md).
- **Rootless variant is best-effort on Ubuntu 24.04 hosts** because of the `kernel.apparmor_restrict_unprivileged_userns`
  restriction; document the workaround
  ([spad.uk](https://www.spad.uk/posts/rootless-dind-noble/)).
- **`docker ps` inside the box only shows that box's containers** (because each box has its own daemon). State this
  explicitly so users do not assume they have visibility into the host or sibling boxes.
- **Storage isn't shared between runs by default.** The inner `/var/lib/docker` lives in the container's writable
  layer; pulled images vanish on `docker rm`. Recommend a named volume (`-v sb-data:/var/lib/docker`) for cache
  persistence and warn that the volume retains *everything* the box pulled.
- **CVE surface is doubled.** The image ships a host kernel-coupled `dockerd` plus `containerd` plus `runc` plus a
  CLI; track Docker advisories alongside whatever language runtimes are inherited from `konard/box`.
- **Multi-arch build caveat.** Building this image for arm64 with `qemu` will be slow because Docker daemon and
  containerd compile heavy; consider native arm64 runners or `--platform` matrix builds.

A reasonable minimum README banner is one line at the top — for example:
"`konard/super-box` runs a Docker daemon inside the container. The default `--privileged` mode is functionally
equivalent to host root; use `--runtime=sysbox-runc` or the rootless tag for untrusted workloads, and never mount
the host's `/var/run/docker.sock` into this image."
