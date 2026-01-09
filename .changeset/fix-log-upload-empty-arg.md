---
'@link-assistant/hive-mind': patch
---

Fix gh-upload-log command invocation error caused by empty string argument

- Fixed bug where `gh-upload-log` failed with "Unknown argument: ''" when verbose=false
- The issue was caused by template literal interpolation `${verbose ? '--verbose' : ''}` passing empty string as an argument
- Now using array-based command building to avoid empty arguments
- Added improved handling for `error_during_execution` result subtype from Claude CLI
- Added tests for log upload command construction to prevent regression
