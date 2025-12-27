---
'@link-assistant/hive-mind': patch
---

Add missing language runtimes, agents, and tools to /version command output

This patch adds comprehensive version detection for all components installed by the ubuntu-24-server-install.sh script:

**New Language Runtimes:**

- Deno (JavaScript/TypeScript runtime)
- Go (Golang)
- Java (via SDKMAN)
- Lean (theorem prover)
- Perl (via Perlbrew)
- OCaml (via Opam)
- Rocq/Coq (theorem prover)

**New Development Tools:**

- SDKMAN (Java version manager)
- Elan (Lean version manager)
- Lake (Lean package manager)
- Perlbrew (Perl version manager)
- Opam (OCaml package manager)

**New C/C++ Development Tools Section:**

- Make
- CMake
- GCC
- G++
- Clang
- LLVM
- LLD (LLVM linker)

The /version command now displays all installed components that are available in the hive environment.

Fixes #1007
