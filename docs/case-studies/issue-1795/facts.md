# Facts — Issue #1795

## From `data/triggering-log.txt`

| Fact                                   | Evidence                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Solver version                         | `🚀 solve v1.69.10` (line 20).                                                                                       |
| Command (relevant flags only)          | `--model opus --tool claude --attach-logs --verbose --no-tool-check --disable-report-issue --language en` (line 22). |
| `auto-fork` was implicit, not explicit | The command does not include `--auto-fork`; the option defaults to `true` (see `src/solve.config.lib.mjs:93`).       |
| Repository visibility                  | `private` (line 57).                                                                                                 |
| User permissions on the repo           | `{"admin":false,"maintain":false,"pull":true,"push":false,"triage":false}` (line 56).                                |
| The auto-fork decision in this run     | `❌ --auto-fork failed: Repository is private and you don't have write access` (lines 60–66).                        |
| The terminal `safeExit` reason         | `Auto-fork failed - private repository without access` (line 72).                                                    |
| Post-failure path still ran            | Token sanitization, code-block escaping, and a tracked comment to issue #1 (lines 76–91).                            |
| Comment was actually posted to GitHub  | API response shows `comment id=4435534043` and `author_association: MEMBER` (line 91).                               |

## From `src/solve.fork-detection.lib.mjs` (pre-fix)

| Fact                                                                          | Citation                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `handleAutoForkOption` is invoked unconditionally when `argv.autoFork` is on. | `src/solve.mjs:256`                                                |
| Pre-fix, `!isPublic` immediately routed to `safeExit(1, …)`.                  | `src/solve.fork-detection.lib.mjs:53-67` (pre-fix).                |
| `allow_forking` was not consulted at any point.                               | `grep -r "allow_forking" src/` returned no matches before the fix. |
| `gh repo fork` is the only fork-creation call in the codebase.                | `src/solve.repository.lib.mjs:581-585`.                            |

## From the GitHub REST API

| Fact                                                                                                 | Source                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /repos/{owner}/{repo}` includes `allow_forking: boolean` and `visibility: "public"\|"private"`. | <https://docs.github.com/en/rest/repos/repos#get-a-repository>                                                                                                         |
| A user with `pull` access may fork a private repository when `allow_forking` is `true`.              | <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-the-forking-policy-for-your-repository> |
| For organisation-owned repositories, the org must also allow private-repo forking.                   | Same source as above ("Managing the forking policy" → "Organizations").                                                                                                |
