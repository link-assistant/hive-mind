---
'@link-assistant/hive-mind': patch
---

Fix the CI/CD errors, false negatives and warnings found on `main` (#4055):

- **Native recovery on `linux-arm64`.** Selected native SQLite corruption recovery no longer fails with `requires closed database handles` when SQLx is still closing a dropped connection on its worker thread. The VFS reports the holder through `errno`: `EBUSY` for this process and `EWOULDBLOCK` for a native peer. The backup waits at most 5 s for this process's own handles and still refuses live peers. `HIVE_CODEX_SQLITE_TRACE=1` traces each attempt and is off by default.
- **Formal AI draft health.** Repeated draft failures no longer split into separate streaks by release version. Twelve drafts that failed on missing `2.40.0` and `2.40.1` images stayed green because neither streak reached the threshold.
- **Dependabot.** The `docker-compose` entry matched no dependency and warned daily, so it is removed. A daily `Dependabot Health` workflow fails when a Dependabot group pull request stays open long enough to block newer updates (dependabot/dependabot-core#16791).
- **Native experiment probes.** Compiles that take 7–10 s had a 30 s limit, and one slow runner failed the job with only `exit code 1`. The five probe scripts now share a 120 s compile limit, the configuration lock probe prints the compiler output and elapsed time on failure, and each experiment job prints the newest log on failure.
- **ESLint 10.15.0.** Published during this pull request, so the no-cooldown dependency freshness gate required it.
- **Process liveness checks.** A task that its reaper is releasing shows `X (dead)` in `/proc/<pid>/stat`, right after `Z`. Six checks, including the runtime probe cleanup in `verify-agent-runtime`, treated it as alive, which failed a Router native-lifetime test at random.
- **Native Codex variants and Docker images.** 2.40.2 published its main package while npm was still processing the linux-arm64 variant, so the arm64 image installed without it and no 2.40.2 image was published. The release now publishes the main package only after npm can install every variant, and the Docker jobs also wait for the variants a release pins. The image build prints why native Codex was refused.
