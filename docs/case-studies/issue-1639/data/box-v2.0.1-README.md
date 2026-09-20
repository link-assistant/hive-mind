# box

A Docker container image that contains most popular language runtimes and tools to be reused for multiple software development tasks.

## Overview

This box provides a pre-configured development environment with common language runtimes installed. It is designed to be AI-agnostic and can be used as a base image for various development workflows.

## Included Runtimes & Tools

### Programming Languages
- **Node.js 20** (via NVM) + npm + Bun + Deno
- **Python** (latest stable via pyenv)
- **Go** (latest stable)
- **Rust** (via rustup) + Cargo
- **Java 21 LTS** (Eclipse Temurin via SDKMAN)
- **Kotlin** (via SDKMAN)
- **PHP 8.3** (via Homebrew)
- **Perl** (latest stable via Perlbrew)
- **Ruby** (latest stable via rbenv)
- **Swift 6.x** (latest stable)
- **R** (latest stable)
- **.NET SDK 8.0**
- **Assembly** (GNU Assembler, NASM, LLVM-MC, FASM)

### Theorem Provers
- **Lean** (via elan)
- **Rocq/Coq** (via opam)

### Build Tools
- **CMake**
- **Make**
- **GCC/G++**
- **Clang/Clang++**
- **LLVM**
- **LLD Linker**

### Development Tools
- **Git**
- **GitHub CLI (gh)**
- **Homebrew**

## Modular Architecture

The box is split into modular components, allowing you to use only what you need:

```
JS box (konard/box-js)
  └─ Essentials box (konard/box-essentials)
       ├─ box-python     (built in parallel)
       ├─ box-go         (built in parallel)
       ├─ box-rust       (built in parallel)
       ├─ box-java       (built in parallel)
       ├─ box-kotlin     (built in parallel)
       ├─ box-ruby       (built in parallel)
       ├─ box-php        (built in parallel)
       ├─ box-perl       (built in parallel)
       ├─ box-swift      (built in parallel)
       ├─ box-lean       (built in parallel)
       └─ box-rocq       (built in parallel)
            └─ Full box (konard/box) ← merges all via COPY --from
```

| Image | Description | Base Image |
|-------|-------------|------------|
| `konard/box` | Full box (all languages) | Assembled from all language images |
| `konard/box-essentials` | Essentials (git identity tools) | Built on JS box |
| `konard/box-js` | JavaScript only | Ubuntu 24.04 |
| `konard/box-python` | Python (pyenv) | Built on essentials |
| `konard/box-go` | Go (latest stable) | Built on essentials |
| `konard/box-rust` | Rust (rustup + cargo) | Built on essentials |
| `konard/box-java` | Java 21 (SDKMAN + Temurin) | Built on essentials |
| `konard/box-kotlin` | Kotlin (SDKMAN) | Built on essentials |
| `konard/box-ruby` | Ruby (rbenv) | Built on essentials |
| `konard/box-php` | PHP 8.3 (Homebrew) | Built on essentials |
| `konard/box-perl` | Perl (Perlbrew) | Built on essentials |
| `konard/box-swift` | Swift 6.x | Built on essentials |
| `konard/box-lean` | Lean (elan) | Built on essentials |
| `konard/box-rocq` | Rocq/Coq (Opam) | Built on essentials |

### Per-Language Install Scripts & Dockerfiles

Each language has its own standalone `install.sh` and `Dockerfile` under `ubuntu/24.04/<language>/`:

| Language | Directory | Key Tools |
|----------|-----------|-----------|
| JavaScript/TypeScript | `ubuntu/24.04/js/` | NVM, Node.js, Bun, Deno, npm |
| Python | `ubuntu/24.04/python/` | Pyenv, latest stable Python |
| Go | `ubuntu/24.04/go/` | Latest stable Go |
| Rust | `ubuntu/24.04/rust/` | rustup, Cargo |
| Java | `ubuntu/24.04/java/` | SDKMAN, Eclipse Temurin 21 |
| Kotlin | `ubuntu/24.04/kotlin/` | SDKMAN, Kotlin |
| .NET | `ubuntu/24.04/dotnet/` | .NET SDK 8.0 |
| R | `ubuntu/24.04/r/` | R base |
| Ruby | `ubuntu/24.04/ruby/` | rbenv, latest Ruby 3.x |
| PHP | `ubuntu/24.04/php/` | Homebrew, PHP 8.3 |
| Perl | `ubuntu/24.04/perl/` | Perlbrew, latest Perl |
| Swift | `ubuntu/24.04/swift/` | Swift 6.x |
| Lean | `ubuntu/24.04/lean/` | elan, Lean prover |
| Rocq/Coq | `ubuntu/24.04/rocq/` | Opam, Rocq prover |
| C/C++ | `ubuntu/24.04/cpp/` | CMake, Clang, LLVM, LLD |
| Assembly | `ubuntu/24.04/assembly/` | NASM, FASM (x86_64) |

Each install script can be run standalone on Ubuntu 24.04:

```bash
# Install just Go on your Ubuntu 24.04 system
curl -fsSL https://raw.githubusercontent.com/link-foundation/box/main/ubuntu/24.04/go/install.sh | bash
```

## Docker Images

### Docker Hub - Combo Boxes

| Image | Multi-arch | AMD64 | ARM64 |
|-------|------------|-------|-------|
| Full Box | [`konard/box:latest`](https://hub.docker.com/r/konard/box/tags?name=latest) | [`latest-amd64`](https://hub.docker.com/r/konard/box/tags?name=latest-amd64) | [`latest-arm64`](https://hub.docker.com/r/konard/box/tags?name=latest-arm64) |
| Essentials | [`konard/box-essentials:latest`](https://hub.docker.com/r/konard/box-essentials/tags?name=latest) | [`latest-amd64`](https://hub.docker.com/r/konard/box-essentials/tags?name=latest-amd64) | [`latest-arm64`](https://hub.docker.com/r/konard/box-essentials/tags?name=latest-arm64) |
| JS | [`konard/box-js:latest`](https://hub.docker.com/r/konard/box-js/tags?name=latest) | [`latest-amd64`](https://hub.docker.com/r/konard/box-js/tags?name=latest-amd64) | [`latest-arm64`](https://hub.docker.com/r/konard/box-js/tags?name=latest-arm64) |

### Docker Hub - Language Boxes

| Language | Multi-arch | AMD64 | ARM64 |
|----------|------------|-------|-------|
| Python | [`konard/box-python:latest`](https://hub.docker.com/r/konard/box-python/tags?name=latest) | [`latest-amd64`](https://hub.docker.com/r/konard/box-python/tags?name=latest-amd64) | [`latest-arm64`](https://hub.docker.com/r/konard/box-python/tags?name=latest-arm64) |
| Go | [`konard/box-go:latest`](https://hub.docker.com/r/konard/box-go/tags?name=latest) | [`latest-amd64`](https://hub.docker.com/r/konard/box-go/tags?name=latest-amd64) | [`latest-arm64`](https://hub.docker.com/r/konard/box-go/tags?name=latest-arm64) |
| Rust | [`konard/box-rust:latest`](https://hub.docker.com/r/konard/box-rust/tags?name=latest) | [`latest-amd64`](https://hub.docker.com/r/konard/box-rust/tags?name=latest-amd64) | [`latest-arm64`](https://hub.docker.com/r/konard/box-rust/tags?name=latest-arm64) |
| Java | [`konard/box-java:latest`](https://hub.docker.com/r/konard/box-java/tags?name=latest) | [`latest-amd64`](https://hub.docker.com/r/konard/box-java/tags?name=latest-amd64) | [`latest-arm64`](https://hub.docker.com/r/konard/box-java/tags?name=latest-arm64) |
| Kotlin | [`konard/box-kotlin:latest`](https://hub.docker.com/r/konard/box-kotlin/tags?name=latest) | [`latest-amd64`](https://hub.docker.com/r/konard/box-kotlin/tags?name=latest-amd64) | [`latest-arm64`](https://hub.docker.com/r/konard/box-kotlin/tags?name=latest-arm64) |
| Ruby | [`konard/box-ruby:latest`](https://hub.docker.com/r/konard/box-ruby/tags?name=latest) | [`latest-amd64`](https://hub.docker.com/r/konard/box-ruby/tags?name=latest-amd64) | [`latest-arm64`](https://hub.docker.com/r/konard/box-ruby/tags?name=latest-arm64) |
| PHP | [`konard/box-php:latest`](https://hub.docker.com/r/konard/box-php/tags?name=latest) | [`latest-amd64`](https://hub.docker.com/r/konard/box-php/tags?name=latest-amd64) | [`latest-arm64`](https://hub.docker.com/r/konard/box-php/tags?name=latest-arm64) |
| Perl | [`konard/box-perl:latest`](https://hub.docker.com/r/konard/box-perl/tags?name=latest) | [`latest-amd64`](https://hub.docker.com/r/konard/box-perl/tags?name=latest-amd64) | [`latest-arm64`](https://hub.docker.com/r/konard/box-perl/tags?name=latest-arm64) |
| Swift | [`konard/box-swift:latest`](https://hub.docker.com/r/konard/box-swift/tags?name=latest) | [`latest-amd64`](https://hub.docker.com/r/konard/box-swift/tags?name=latest-amd64) | [`latest-arm64`](https://hub.docker.com/r/konard/box-swift/tags?name=latest-arm64) |
| Lean | [`konard/box-lean:latest`](https://hub.docker.com/r/konard/box-lean/tags?name=latest) | [`latest-amd64`](https://hub.docker.com/r/konard/box-lean/tags?name=latest-amd64) | [`latest-arm64`](https://hub.docker.com/r/konard/box-lean/tags?name=latest-arm64) |
| Rocq | [`konard/box-rocq:latest`](https://hub.docker.com/r/konard/box-rocq/tags?name=latest) | [`latest-amd64`](https://hub.docker.com/r/konard/box-rocq/tags?name=latest-amd64) | [`latest-arm64`](https://hub.docker.com/r/konard/box-rocq/tags?name=latest-arm64) |

### GitHub Container Registry - Combo Boxes

| Image | Multi-arch | AMD64 | ARM64 |
|-------|------------|-------|-------|
| Full Box | [`ghcr.io/link-foundation/box:latest`](https://github.com/link-foundation/box/pkgs/container/box?tag=latest) | [`latest-amd64`](https://github.com/link-foundation/box/pkgs/container/box?tag=latest-amd64) | [`latest-arm64`](https://github.com/link-foundation/box/pkgs/container/box?tag=latest-arm64) |
| Essentials | [`ghcr.io/link-foundation/box-essentials:latest`](https://github.com/link-foundation/box/pkgs/container/box-essentials?tag=latest) | [`latest-amd64`](https://github.com/link-foundation/box/pkgs/container/box-essentials?tag=latest-amd64) | [`latest-arm64`](https://github.com/link-foundation/box/pkgs/container/box-essentials?tag=latest-arm64) |
| JS | [`ghcr.io/link-foundation/box-js:latest`](https://github.com/link-foundation/box/pkgs/container/box-js?tag=latest) | [`latest-amd64`](https://github.com/link-foundation/box/pkgs/container/box-js?tag=latest-amd64) | [`latest-arm64`](https://github.com/link-foundation/box/pkgs/container/box-js?tag=latest-arm64) |

### GitHub Container Registry - Language Boxes

| Language | Multi-arch | AMD64 | ARM64 |
|----------|------------|-------|-------|
| Python | [`ghcr.io/link-foundation/box-python:latest`](https://github.com/link-foundation/box/pkgs/container/box-python?tag=latest) | [`latest-amd64`](https://github.com/link-foundation/box/pkgs/container/box-python?tag=latest-amd64) | [`latest-arm64`](https://github.com/link-foundation/box/pkgs/container/box-python?tag=latest-arm64) |
| Go | [`ghcr.io/link-foundation/box-go:latest`](https://github.com/link-foundation/box/pkgs/container/box-go?tag=latest) | [`latest-amd64`](https://github.com/link-foundation/box/pkgs/container/box-go?tag=latest-amd64) | [`latest-arm64`](https://github.com/link-foundation/box/pkgs/container/box-go?tag=latest-arm64) |
| Rust | [`ghcr.io/link-foundation/box-rust:latest`](https://github.com/link-foundation/box/pkgs/container/box-rust?tag=latest) | [`latest-amd64`](https://github.com/link-foundation/box/pkgs/container/box-rust?tag=latest-amd64) | [`latest-arm64`](https://github.com/link-foundation/box/pkgs/container/box-rust?tag=latest-arm64) |
| Java | [`ghcr.io/link-foundation/box-java:latest`](https://github.com/link-foundation/box/pkgs/container/box-java?tag=latest) | [`latest-amd64`](https://github.com/link-foundation/box/pkgs/container/box-java?tag=latest-amd64) | [`latest-arm64`](https://github.com/link-foundation/box/pkgs/container/box-java?tag=latest-arm64) |
| Kotlin | [`ghcr.io/link-foundation/box-kotlin:latest`](https://github.com/link-foundation/box/pkgs/container/box-kotlin?tag=latest) | [`latest-amd64`](https://github.com/link-foundation/box/pkgs/container/box-kotlin?tag=latest-amd64) | [`latest-arm64`](https://github.com/link-foundation/box/pkgs/container/box-kotlin?tag=latest-arm64) |
| Ruby | [`ghcr.io/link-foundation/box-ruby:latest`](https://github.com/link-foundation/box/pkgs/container/box-ruby?tag=latest) | [`latest-amd64`](https://github.com/link-foundation/box/pkgs/container/box-ruby?tag=latest-amd64) | [`latest-arm64`](https://github.com/link-foundation/box/pkgs/container/box-ruby?tag=latest-arm64) |
| PHP | [`ghcr.io/link-foundation/box-php:latest`](https://github.com/link-foundation/box/pkgs/container/box-php?tag=latest) | [`latest-amd64`](https://github.com/link-foundation/box/pkgs/container/box-php?tag=latest-amd64) | [`latest-arm64`](https://github.com/link-foundation/box/pkgs/container/box-php?tag=latest-arm64) |
| Perl | [`ghcr.io/link-foundation/box-perl:latest`](https://github.com/link-foundation/box/pkgs/container/box-perl?tag=latest) | [`latest-amd64`](https://github.com/link-foundation/box/pkgs/container/box-perl?tag=latest-amd64) | [`latest-arm64`](https://github.com/link-foundation/box/pkgs/container/box-perl?tag=latest-arm64) |
| Swift | [`ghcr.io/link-foundation/box-swift:latest`](https://github.com/link-foundation/box/pkgs/container/box-swift?tag=latest) | [`latest-amd64`](https://github.com/link-foundation/box/pkgs/container/box-swift?tag=latest-amd64) | [`latest-arm64`](https://github.com/link-foundation/box/pkgs/container/box-swift?tag=latest-arm64) |
| Lean | [`ghcr.io/link-foundation/box-lean:latest`](https://github.com/link-foundation/box/pkgs/container/box-lean?tag=latest) | [`latest-amd64`](https://github.com/link-foundation/box/pkgs/container/box-lean?tag=latest-amd64) | [`latest-arm64`](https://github.com/link-foundation/box/pkgs/container/box-lean?tag=latest-arm64) |
| Rocq | [`ghcr.io/link-foundation/box-rocq:latest`](https://github.com/link-foundation/box/pkgs/container/box-rocq?tag=latest) | [`latest-amd64`](https://github.com/link-foundation/box/pkgs/container/box-rocq?tag=latest-amd64) | [`latest-arm64`](https://github.com/link-foundation/box/pkgs/container/box-rocq?tag=latest-arm64) |

## Usage

### Quick Start

Pull multi-arch (auto-selects your platform):
```bash
docker pull konard/box:latest
```

Pull specific architecture:
```bash
# AMD64
docker pull konard/box:latest-amd64

# ARM64 (Apple Silicon, Raspberry Pi, etc.)
docker pull konard/box:latest-arm64
```

Pull from GHCR:
```bash
docker pull ghcr.io/link-foundation/box:latest
```

### Run interactively

```bash
docker run -it ghcr.io/link-foundation/box:latest
```

### Use as base image

```dockerfile
FROM ghcr.io/link-foundation/box:latest

# Your additional setup here
COPY . /home/box
RUN npm install
```

### Build locally

```bash
git clone https://github.com/link-foundation/box.git
cd box
docker build -t box .
```

## Architecture Support

The image is built for both `linux/amd64` and `linux/arm64` architectures.

### CI/CD Build Requirements

**IMPORTANT: ARM64 builds MUST use native ARM64 runners.**

| Architecture | Runner | Build Time |
|-------------|--------|------------|
| `linux/amd64` | `ubuntu-latest` | ~5-10 minutes |
| `linux/arm64` | `ubuntu-24.04-arm` (native) | ~30-60 minutes |

Native ARM64 runners provide optimal build performance for compilation-heavy workloads. Emulation would incur a 10-30x performance penalty.

For detailed analysis, see [Case Study: Issue #7](docs/case-studies/issue-7/README.md).

## Environment

The container runs as the `box` user with home directory at `/home/box`. All language runtimes are installed in user-local directories under `/home/box`:

- Node.js: `~/.nvm`
- Python: `~/.pyenv`
- Go: `~/.go`
- Rust: `~/.cargo`
- Java/Kotlin: `~/.sdkman`
- Ruby: `~/.rbenv`
- Swift: `~/.swift`
- Lean: `~/.elan`
- Perl: `~/.perl5`
- OCaml/Rocq: `~/.opam`

<!-- COMPONENT_SIZES_START -->
## Component Sizes

_Last updated: 2026-04-06T08:34:59Z_

**Total installation size: 7280.0 MB**

| Component | Category | Size (MB) |
|-----------|----------|-----------|
| Swift 6.x | Runtime | 2655.24 |
| Opam + Rocq/Coq | Runtime | 1017.0 |
| Rust (via rustup) | Runtime | 647.44 |
| SDKMAN + Java 21 | Runtime | 579.09 |
| .NET SDK 8.0 | Runtime | 504.93 |
| Pyenv + Python (latest) | Runtime | 387.94 |
| Perlbrew + Perl (latest) | Runtime | 364.98 |
| Go (latest) | Runtime | 281.75 |
| NVM + Node.js 20 | Runtime | 230.95 |
| Kotlin (via SDKMAN) | Runtime | 173.97 |
| rbenv + Ruby (latest) | Runtime | 165.15 |
| Deno | Runtime | 123.64 |
| R Language | Runtime | 121.13 |
| Bun | Runtime | 99.68 |
| PHP 8.3 (via Homebrew) | Runtime | 55.47 |
| Lean (via elan) | Runtime | 13.23 |
| C/C++ Tools (CMake, Clang, LLVM, LLD) | Build Tools | 58.83 |
| Assembly Tools (NASM, FASM) | Build Tools | 3.92 |
| GitLab CLI | Development Tools | 30.06 |
| gh-setup-git-identity | Development Tools | 4.61 |
| glab-setup-git-identity | Development Tools | 4.48 |
| GitHub CLI | Development Tools | 0.54 |
| Homebrew | Package Manager | 179.75 |
| Python Build Dependencies | Dependencies | 44.24 |
| Bubblewrap | Dependencies | 0.18 |
| Ruby Build Dependencies | Dependencies | 0.0 |
| Essential Tools | System | 0.75 |

_Note: Sizes are measured after cleanup and may vary based on system state and package versions._

<!-- COMPONENT_SIZES_END -->

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture and design decisions
- [REQUIREMENTS.md](REQUIREMENTS.md) - Project requirements and constraints
- [docs/case-studies/](docs/case-studies/) - Case studies and incident analysis

## License

MIT License - see [LICENSE](LICENSE) for details.
