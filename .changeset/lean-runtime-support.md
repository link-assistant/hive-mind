---
"@link-assistant/hive-mind": patch
---

Add Lean runtime preinstallation support via elan

- Install elan (Lean version manager) with stable toolchain in all deployment environments
- Add Lean/elan to PATH in Dockerfile, .gitpod.Dockerfile, coolify/Dockerfile
- Add installation verification for elan, lean, and lake commands
- Add CI checks to verify Lean installation in Docker builds
