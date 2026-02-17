---
'@link-assistant/hive-mind': patch
---

fix: suppress dotenvx MISSING_ENV_FILE warnings in hive-telegram-bot --version

- Add early --version handling before loading dotenvx to avoid warnings
- Add ignore: ['MISSING_ENV_FILE'] option to make .env file optional
- Add tests for version output in tests/test-telegram-bot-version.mjs
