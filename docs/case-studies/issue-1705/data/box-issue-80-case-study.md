# Case Study: Issue #80 — `konard/box-dind` family (Docker‑in‑Box)

## Implementation Update (2026‑04‑28)

The case study below was written with the working name `konard/super-box`. After review, the project owner picked the final naming and scope:

- **Final name:** `dind-box` (suffix `-dind`), not `super-box`.
- **Scope:** add a dind sibling for **every** existing image variant (`-js`, `-essentials`, every language box, and the full box). Image names follow the existing convention:
  - `konard/box` → `konard/box-dind`
  - `konard/box-essentials` → `konard/box-essentials-dind`
  - `konard/box-js` → `konard/box-js-dind`
  - `konard/box-<language>` → `konard/box-<language>-dind`
- **Implementation:** a single generic recipe at [`ubuntu/24.04/dind/`](../../../ubuntu/24.04/dind/) (one `Dockerfile`, one `install.sh`, one `dind-entrypoint.sh`) that takes any base image as `--build-arg BASE_IMAGE=...` and produces the dind variant. The release workflow runs this recipe in a 14×2 (variant × arch) matrix and then assembles per‑variant multi‑arch manifests.
- **Architecture, security model, and host‑isolation guarantees are unchanged** from sections 3–6 below: the default tag is nested DinD on `--privileged`, Sysbox is the recommended secure runtime, DooD is rejected as a default, and `docker ps -a` is naturally scoped per container because each container owns its own `dockerd`.

The rest of this document is preserved as written so the original analysis remains auditable; references to `super-box` should be read as `box-dind`.

---

## Executive Summary

Issue [#80](https://github.com/link-foundation/box/issues/80) requests a new image variant — provisionally
`konard/super-box` — that is a strict superset of `konard/box` (Ubuntu 24.04, non‑root `box` user, multi‑arch
amd64+arm64, all language runtimes from the existing modular pipeline) plus the ability to **launch and
control Docker containers from inside the box**. As a stretch goal, the issue asks that each `super-box`
instance see only the containers it created (`docker ps -a` should be naturally scoped) so the host system
remains "somewhat safe".

This document is the case‑study deliverable from the issue. It is research only — no code, no Dockerfile.
Implementation will land in a follow‑up PR once the chosen solution plan is approved.

The companion file [`research.md`](./research.md) collects the upstream evidence (Docker docs, Sysbox,
Tecnativa proxy, Devcontainers Features, OWASP, Quarkslab, GitLab Runner, etc.) that the conclusions below
rest on. The original issue text is preserved in [`issue.md`](./issue.md).

---

## 1. Problem Statement

The existing `konard/box` image is an "everything‑languages" development environment but cannot run Docker
inside itself. Workflows that need to build/launch other containers (CI runners, AI agents that orchestrate
sandbox containers, dev‑container‑style scenarios, integration tests against `docker compose`, etc.) cannot
use `konard/box` directly. They either fall back to a different base or to fragile DooD setups that bind‑mount
the host `/var/run/docker.sock`.

Adding a `super-box` variant that bundles Docker (CLI + daemon + Compose + Buildx) addresses that gap while
keeping the rest of the language matrix intact.

The host‑safety stretch goal — "each box only sees containers it created in `docker ps -a`" — is non‑trivial
because Docker has no native multi‑tenant view of `docker ps`. Section 5 below explains how nested DinD
provides this property naturally as a side effect of each box owning its own daemon.

---

## 2. Requirements Extracted From the Issue

The issue text is short. We unpack it into explicit, testable requirements so each can be addressed by the
solution plan.

### Functional Requirements

| ID | Requirement | Source phrase |
|---|---|---|
| **FR‑80.1** | Publish a new image (working name `konard/super-box`) that is a **superset** of `konard/box`. | "does all the same" |
| **FR‑80.2** | The image MUST include the Docker daemon (`dockerd`), the Docker CLI, `containerd`, `runc`, Buildx, and Compose v2 so that users can `docker build`, `docker run`, `docker compose up` from inside the running container. | "built up on docker with elevated permissions, that allows to control docker from inside dockers" |
| **FR‑80.3** | The image MUST start the inner Docker daemon automatically (or via a documented entrypoint) so an interactive `docker run -it konard/super-box` is immediately usable. | "control docker from inside dockers" |
| **FR‑80.4** | The image MUST be multi‑arch (`linux/amd64` + `linux/arm64`), matching the rest of the box matrix. | Project convention (REQUIREMENTS.md FR‑4) |
| **FR‑80.5** | The image MUST be published to both Docker Hub (`konard/super-box`) and ghcr.io (`ghcr.io/link-foundation/super-box`), matching the rest of the box matrix. | Project convention (REQUIREMENTS.md FR‑5) |

### Security / Isolation Requirements (Stretch)

| ID | Requirement | Source phrase |
|---|---|---|
| **FR‑80.6** | Each `super-box` instance SHOULD see only the containers it has itself created when running `docker ps -a`. | "each docker container only has access to dockers in `docker ps -a`, which were created by that docker" |
| **FR‑80.7** | The host system SHOULD remain reasonably safe — a compromise of the box SHOULD NOT trivially imply host root. | "so host system is somewhat safe" |
| **FR‑80.8** | The README MUST document the privilege model and the recommended secure invocation. | Implicit (project documents NFR‑2 in REQUIREMENTS.md). |

### Non‑Functional / Process Requirements

| ID | Requirement | Source / rationale |
|---|---|---|
| **NFR‑80.1** | The image MUST run as a **non‑root** user by default (`box`), consistent with the rest of the project. | REQUIREMENTS.md NFR‑2 |
| **NFR‑80.2** | The image MUST integrate with the existing modular pipeline (`build-essentials → languages → full`) and reuse `COPY --from` to avoid duplicating language installs. | ARCHITECTURE.md ("Modular Design") |
| **NFR‑80.3** | The image MUST follow the per‑image change‑detection pattern of the release workflow so unrelated branches don't trigger unnecessary super‑box rebuilds. | REQUIREMENTS.md CI‑3 |
| **DOC‑80.1** | A case study MUST be compiled in `docs/case-studies/issue-80/` containing the issue text, requirements, solution plans, and references. | Issue body explicit ask |
| **DOC‑80.2** | The README MUST be updated with the new image table entries and a security banner. | Project convention (issue #71 set the precedent for image tables) |

---

## 3. Why This Is Hard

Three things make a "Docker inside a container" image more interesting than a normal Dockerfile:

1. **Privilege.** A real Docker daemon needs `CAP_SYS_ADMIN` and access to `/dev`, network namespaces, and
   either overlay or fuse‑overlayfs. The standard solution is `--privileged`, which removes most container
   isolation. ([OWASP Docker Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html))
2. **Storage drivers.** `dockerd` writing to `/var/lib/docker` on top of an overlay filesystem (the container's
   writable layer) is the classic "overlay on overlay" failure case. Workarounds: a tmpfs at
   `/var/lib/docker`, a named volume, vfs as a fallback, or fuse‑overlayfs in rootless mode.
   ([jpetazzo's classic warning](https://github.com/jpetazzo/dind))
3. **Per‑caller views of the API.** Docker has no notion of "tenants" on `docker.sock`. Anyone reachable on
   that socket sees *all* containers on that daemon. Achieving FR‑80.6 therefore requires either a separate
   daemon per box (nested DinD) or a filtering proxy in front of a shared daemon.

---

## 4. Solution Space (one section per requirement)

### 4.1 Solution plan for FR‑80.1, FR‑80.2, FR‑80.3 — "Docker available inside the box"

Three viable patterns; one recommended.

| Option | What it is | Privilege | Verdict |
|---|---|---|---|
| **A. Nested Docker‑in‑Docker (DinD)** — `dockerd` runs inside `super-box` | Install `docker-ce`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin` from Docker's apt repo and start `dockerd` from the entrypoint. | `--privileged` (or Sysbox) | **Recommended.** Matches the issue's wording ("docker from inside dockers") literally and gives FR‑80.6 for free. |
| **B. Docker‑outside‑of‑Docker (DooD)** — host socket bind‑mounted in | Only the Docker CLI is shipped; users run `docker run -v /var/run/docker.sock:/var/run/docker.sock konard/super-box`. | none, but `docker` group inside ≡ host root | **Rejected as default.** Violates FR‑80.7 (mounting host socket is a documented host‑takeover vector — [Quarkslab](https://blog.quarkslab.com/why-is-exposing-the-docker-socket-a-really-bad-idea.html)) and breaks FR‑80.6 (any sibling container is visible). |
| **C. Rootless DinD** — `docker:dind-rootless` recipe | `dockerd` runs as user `box` inside a user namespace. | `--privileged` still recommended; escape lands in user‑ns, not host root | **Ship as a secondary tag** (`konard/super-box-rootless`) once core image is solid. |

**Recommended plan for FR‑80.1/2/3:** Option A as the default tag, Option C as a secondary tag. The reference
recipe to crib from is [`cruizba/ubuntu-dind`](https://github.com/cruizba/ubuntu-dind) (Ubuntu, multi‑arch,
Compose + Buildx, has a `start-docker.sh` entrypoint). Implementation skeleton:

1. Create `ubuntu/24.04/super-box/install.sh` that adds Docker's apt repository and installs
   `docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`.
2. Create `ubuntu/24.04/super-box/Dockerfile` that:
   - `FROM ${ESSENTIALS_IMAGE}` (parallel to `full-box`),
   - copies the language layers via `COPY --from=...-stage` exactly like `full-box/Dockerfile` does,
   - runs `super-box/install.sh`,
   - drops a `/usr/local/bin/super-box-entrypoint.sh` that starts `dockerd` (in DinD mode) and then `exec`s
     the existing `entrypoint.sh`.
3. Wire the new image into `.github/workflows/release.yml` as a sibling job to `build-full-amd64/arm64`,
   reusing the same change‑detection inputs.
4. Tag matrix: `latest`, `{version}`, `{version}-amd64`, `{version}-arm64`, `latest-amd64`, `latest-arm64`,
   plus `rootless` variants when option C lands.

### 4.2 Solution plan for FR‑80.4 (multi‑arch) and NFR‑80.2/3 (pipeline integration)

This is the cheap part — the existing pipeline already builds one extra image (`full-box`) the same way. Add
`super-box` as a peer matrix entry. Native ARM64 runners (`ubuntu-24.04-arm`, see REQUIREMENTS.md CI‑1) are
mandatory: the Docker daemon and `containerd` are compilation‑heavy in qemu and would blow the 120‑minute
ARM64 budget.

Change detection should treat changes under `ubuntu/24.04/super-box/**` as triggering only the super‑box
build, exactly like other language images. Change to `essentials-box` already cascades.

### 4.3 Solution plan for FR‑80.5 (registries)

Mirrors the rest of the project; nothing special. Push `konard/super-box` and
`ghcr.io/link-foundation/super-box` from the workflow with the same retry logic added in
[PR #79](https://github.com/link-foundation/box/pull/79) (issue #78).

### 4.4 Solution plan for FR‑80.6 — "`docker ps` only shows my containers"

Only two approaches actually deliver this guarantee. Both are listed; one is recommended.

| Option | What it is | Strength of guarantee | Verdict |
|---|---|---|---|
| **D. Nested DinD (default of 4.1.A)** — each `super-box` runs its own `dockerd` | The inner daemon literally only knows about containers the box created. `docker ps` is naturally scoped. | Strong: separate Linux namespaces, separate state directory, separate API socket. One box cannot enumerate or kill another box's containers because they live on different daemons. | **Recommended.** Free side‑effect of 4.1.A. |
| **E. Shared host daemon + filtering proxy** | Bind‑mount `docker.sock` into a [`Tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy) that is then chained through [`FoxxMD/docker-proxy-filter`](https://github.com/FoxxMD/docker-proxy-filter) to filter `/containers/json` by a per‑box label. | Medium: proxy enforces the view, but anyone who escapes the proxy reaches the host daemon. | Document only as an optional pattern for users who have a strong reason to share the host daemon. |

**Conclusion for FR‑80.6:** picking 4.1.A (nested DinD) satisfies FR‑80.6 implicitly; no socket proxy or
authz plugin is needed for the default tag. Mention the authz alternatives in `research.md` for completeness:

- [`twistlock/authz`](https://github.com/twistlock/authz) — regex‑based ACL plugin.
- [`casbin/docker-casbin-plugin`](https://github.com/casbin/docker-casbin-plugin) — Casbin RBAC/ABAC.
- [Docker authz plugin API docs](https://docs.docker.com/engine/extend/plugins_authorization/).

These are useful when you cannot accept a separate daemon per tenant; we can.

### 4.5 Solution plan for FR‑80.7 — "host stays somewhat safe"

The default DinD tag still requires `--privileged`, which is **not** "host‑safe" in the strict sense.
Two complementary mitigations:

1. **Document Sysbox as the recommended secure runtime.** [Sysbox](https://github.com/nestybox/sysbox) is a
   drop‑in OCI runtime that runs system containers (including a nested `dockerd`) **without** `--privileged`
   and without exposing host devices. The README should include
   `docker run --runtime=sysbox-runc konard/super-box` as the recommended invocation for production / shared
   hosts and link to [Sysbox installation](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/install-package.md).
2. **Ship a `konard/super-box-rootless` tag** (Option C) so users who cannot install Sysbox still have a
   meaningful step up from full DinD. Note the Ubuntu 24.04 caveat:
   `kernel.apparmor_restrict_unprivileged_userns=1` breaks rootless DinD until the user installs the
   AppArmor profile or flips the sysctl ([spad.uk write‑up](https://www.spad.uk/posts/rootless-dind-noble/)).

### 4.6 Solution plan for FR‑80.8 / DOC‑80.2 — README updates

The README must include:

- A new "Docker‑in‑Box" section under "Docker Images" listing `konard/super-box` and the GHCR equivalent in
  the same multi‑arch table format established by issue #71.
- A security banner with at least four lines (privilege model, do‑not‑mount‑host‑socket warning, recommended
  Sysbox invocation, `docker ps` scoping behaviour). Concrete wording is in
  [`research.md` §4](./research.md).

### 4.7 Solution plan for NFR‑80.1 — non‑root by default

Even in DinD mode the box user can stay non‑root for the *user shell*. The pattern is:

1. The container starts as root just long enough for the entrypoint to run `dockerd` (root‑owned by design).
2. The entrypoint then `su`/`gosu`/`runuser`s into `box` for the interactive shell.
3. `box` is added to the inner `docker` group so that `docker` CLI calls from the user shell talk to the
   inner `dockerd` over `/var/run/docker.sock`.

This matches `cruizba/ubuntu-dind`'s behaviour and the standard `docker:dind` recipe.

---

## 5. Reference Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  konard/super-box (Ubuntu 24.04)                            │
│                                                             │
│   ┌─────────────────────────────┐                           │
│   │  user shell (UID 1000 box)  │  → docker CLI, compose,   │
│   │  + all language runtimes    │    buildx, full-box langs │
│   └──────────────┬──────────────┘                           │
│                  │ unix socket /var/run/docker.sock         │
│                  ▼                                          │
│   ┌─────────────────────────────┐                           │
│   │  inner dockerd (root)       │  → /var/lib/docker        │
│   │  containerd, runc, buildkit │    (in container layer or │
│   │                             │     mounted volume)       │
│   └──────────────┬──────────────┘                           │
│                  │  spawns                                  │
│                  ▼                                          │
│   ┌─────────────────────────────┐                           │
│   │  child containers           │  ← only these show in     │
│   │  (created by this super-box)│    `docker ps -a` (FR-6)  │
│   └─────────────────────────────┘                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                  │ runs under
                  ▼
        host kernel (Linux)  +  host dockerd (NOT shared)
```

Key property: the inner `dockerd` does not know about the host `dockerd`, and vice versa. The host socket is
**not** bind‑mounted. `docker ps -a` inside the box returns only the inner daemon's containers, satisfying
FR‑80.6 by construction.

---

## 6. Existing Components Worth Reusing

Documented in detail in [`research.md`](./research.md) §3. Highlights:

- [`cruizba/ubuntu-dind`](https://github.com/cruizba/ubuntu-dind) — closest analogue; Ubuntu noble, multi‑arch,
  bundled Compose + Buildx, has a `start-docker.sh`. Use as the recipe template.
- [`docker:dind` / `docker:dind-rootless`](https://hub.docker.com/_/docker) — official; canonical reference
  for the entrypoint and storage‑driver handling.
- [`devcontainers/features` `docker-in-docker`](https://github.com/devcontainers/features/tree/main/src/docker-in-docker)
  — installer script with documented options (Compose version, dind storage driver, etc.) we can mirror.
- [`nestybox/sysbox`](https://github.com/nestybox/sysbox) — the secure runtime to recommend.
- [`Tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy) +
  [`FoxxMD/docker-proxy-filter`](https://github.com/FoxxMD/docker-proxy-filter) — only relevant if we ever
  ship a "shared host daemon" mode; not needed for the default plan.
- [`twistlock/authz`](https://github.com/twistlock/authz) /
  [`casbin/docker-casbin-plugin`](https://github.com/casbin/docker-casbin-plugin) — authz plugin alternatives
  for completeness.

We do **not** need to vendor any of these; the install steps from `cruizba/ubuntu-dind` and
`devcontainers/features` are short enough to inline into `ubuntu/24.04/super-box/install.sh`.

---

## 7. Implementation Plan (sequenced)

A separate PR after this case study is approved. Sketch:

1. **Add `ubuntu/24.04/super-box/{install.sh,Dockerfile}`** — DinD recipe on top of essentials, mirroring
   `full-box`'s `COPY --from` language merge. Entrypoint starts `dockerd`, then drops to `box`.
2. **Add release‑workflow job** `build-super-box-amd64/arm64` and `manifest-super-box`. Use the existing
   change‑detection pattern; add `super-box/**` to the per‑image filter.
3. **Smoke test** in CI: `docker run --privileged konard/super-box docker run hello-world` on both arches.
4. **Update README.md** — new image rows, security banner, link to this case study.
5. **Update REQUIREMENTS.md / ARCHITECTURE.md** — add a short "super‑box" subsection to the modular‑design
   section.
6. **Bump VERSION** so the existing release workflow publishes the new image.
7. **(Optional, follow‑up)** Add `konard/super-box-rootless` tag once the default tag has shipped a release
   cycle.

Each step is a separate commit, all on branch `issue-80-bded956c66f7`.

---

## 8. Risks & Open Questions

- **Inner `/var/lib/docker` storage strategy.** Default to overlay2 inside the container layer and accept that
  pulled images vanish on `docker rm`; document `-v sb-data:/var/lib/docker` as the recommended persistent
  pattern. Decide before implementation: do we set `tmpfs:/var/lib/docker` by default to avoid surprising
  layer growth?
- **Image size.** `super-box` will be `full-box` plus ~150–200 MB for `docker-ce` + `containerd` + Buildx +
  Compose. Acceptable, but should be measured by `scripts/measure-disk-space.sh` and reported in the README
  size table.
- **GitHub Actions compatibility.** `actions/checkout` and `docker/build-push-action` inside `super-box`
  should "just work", but it should be tested explicitly because some users will use `super-box` as a
  self‑hosted runner image.
- **arm64 build time.** Adding Docker increases build time. Stay within REQUIREMENTS.md NFR‑1 (120 min for
  ARM64). Likely fine — `docker-ce` is published as binary debs by Docker Inc., no compilation needed.
- **Naming.** "super-box" is the issue's working name. Open question for the implementation PR: keep it as
  `super-box`, or use a more conventional `box-dind` / `box-docker`? The case study uses `super-box`
  throughout; the implementation PR can pick a final name.

---

## 9. References

- [Issue #80](https://github.com/link-foundation/box/issues/80)
- [`research.md`](./research.md) — upstream evidence supporting the conclusions in this document
- Project conventions:
  - [REQUIREMENTS.md](../../../REQUIREMENTS.md) — FR‑1…5, NFR‑1…3, CI‑1…4
  - [ARCHITECTURE.md](../../../ARCHITECTURE.md) — modular design, COPY‑‑from assembly
- Docker / Sysbox / proxy upstreams (full URLs in `research.md`):
  - [docker:dind / docker:dind-rootless](https://hub.docker.com/_/docker)
  - [`cruizba/ubuntu-dind`](https://github.com/cruizba/ubuntu-dind)
  - [`nestybox/sysbox`](https://github.com/nestybox/sysbox)
  - [`devcontainers/features` docker-in-docker](https://github.com/devcontainers/features/tree/main/src/docker-in-docker)
  - [`Tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy)
  - [`FoxxMD/docker-proxy-filter`](https://github.com/FoxxMD/docker-proxy-filter)
  - [Docker authz plugin API](https://docs.docker.com/engine/extend/plugins_authorization/)
  - [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)
  - [Quarkslab on `/var/run/docker.sock`](https://blog.quarkslab.com/why-is-exposing-the-docker-socket-a-really-bad-idea.html)
  - [GitLab: using Docker build (DinD service)](https://docs.gitlab.com/ci/docker/using_docker_build/)
