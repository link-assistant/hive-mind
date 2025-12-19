---
"@link-assistant/hive-mind": patch
---

Add preinstalled Rocq (formerly Coq) theorem prover runtime support

- Install opam (OCaml package manager) as prerequisite
- Configure Rocq-released repository for package installation
- Add Rocq prover with fallback to classic Coq package if unavailable
- Add CI verification checks for Opam and Rocq/Coq installation
- Include Opam paths in Docker environment variables
- Support both Rocq and Coq theorem provers across all deployment configurations
