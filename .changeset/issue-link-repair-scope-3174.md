---
'@link-assistant/hive-mind': patch
---

The post-session link repair no longer adds `Fixes` lines for sub-issues the pull request description keeps open ("Part of #7", "#236 to #246 stay open"), together with their own sub-issues, or for sub-issues in other repositories, and it removes such lines that an earlier repair added (issues #3174 and #3276). Before any merge, hive-mind now refuses a pull request that GitHub would use to close an issue in another repository, or an issue the description keeps open, for example through "does not close #7", which GitHub still closes.
