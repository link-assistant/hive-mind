---
"@link-assistant/hive-mind": minor
---

Add Java (OpenJDK) runtime installation support via SDKMAN in Ubuntu 24 server installation script

- Install SDKMAN as Java version manager (following pattern of pyenv for Python, nvm for Node.js)
- Install Java 21 LTS (Eclipse Temurin distribution) by default with fallback to OpenJDK
- Add SDKMAN configuration to .bashrc for persistence
- Add Java and SDKMAN to installation summary output
- Add zip package to prerequisites (required by SDKMAN)

Fixes #737
