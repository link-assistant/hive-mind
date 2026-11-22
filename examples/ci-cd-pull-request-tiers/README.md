# Pull request CI tiers

The [CI/CD guide](../../docs/CI-CD-BEST-PRACTICES.md) explains the two pull request triggers, workspace test selection, job sizing, and the file-size ratchet.

## File-size ratchet

Copy [check-file-line-limits.mjs](./check-file-line-limits.mjs) into the repository that will enforce the limit. The example uses Node.js and Git. Run it with explicit Git pathspecs for the text files your existing limit covers. Use the same pathspecs in all three commands.

```bash
# Adopt once and commit the new .file-line-limits.json.
node scripts/check-file-line-limits.mjs --initialize -- '*.js' '*.mjs' '*.md'

# After shrinking an oversized file or staging its removal, lower its ceiling.
node scripts/check-file-line-limits.mjs --update -- '*.js' '*.mjs' '*.md'

# In pull request CI, set BASE_SHA from github.event.pull_request.base.sha.
node scripts/check-file-line-limits.mjs --base "$BASE_SHA" -- '*.js' '*.mjs' '*.md'
```

Land the adoption baseline before enabling the pull request comparison. Give checkout enough history to read the base commit. On main, run the command with just the pathspecs to verify the tracked files match the committed ceilings. The update command removes entries when files reach 1,500 lines or are deleted. New oversized files, growth above existing ceilings, and increases to the committed baseline fail validation.

## Language template patches

These patches target the release and security workflows of the upstream language templates. The Go template has a release workflow. Apply its patch or any of the others from that template's checkout.

```bash
git apply --check /path/to/js.patch
git apply /path/to/js.patch
```

| Template                                                                                               | Patch                          | Upstream base commit                       |
| ------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------ |
| [JavaScript/TypeScript](https://github.com/link-foundation/js-ai-driven-development-pipeline-template) | [js.patch](./js.patch)         | `74de898dd6ce548af5bcb9359e1dae75fd4ebd75` |
| [Rust](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template)                | [rust.patch](./rust.patch)     | `309387f761f9f0f1b2ea15bfe181cb51f5a9a1fb` |
| [Python](https://github.com/link-foundation/python-ai-driven-development-pipeline-template)            | [python.patch](./python.patch) | `b497e24e5be049cad0b9840eb0e0b8d2eb6077b0` |
| [Go](https://github.com/link-foundation/go-ai-driven-development-pipeline-template)                    | [go.patch](./go.patch)         | `065985538e6d1ede54116e11b70f5a2f1f6ad7b3` |
| [C#](https://github.com/link-foundation/csharp-ai-driven-development-pipeline-template)                | [csharp.patch](./csharp.patch) | `a0f2a171dc1ab02ad5d68147656660562f6e1504` |
| [Java](https://github.com/link-foundation/java-ai-driven-development-pipeline-template)                | [java.patch](./java.patch)     | `dd803a2d9fa5b3a992b435acce73162274fb9e8b` |
| [C++](https://github.com/link-foundation/cpp-ai-driven-development-pipeline-template)                  | [cpp.patch](./cpp.patch)       | `45c42aff119b366ba103a9342ec3c33731bb7e2e` |
| [PHP](https://github.com/link-foundation/php-ai-driven-development-pipeline-template)                  | [php.patch](./php.patch)       | `b61e334703d93a15e08bf1a278e0df0a9d6e98a8` |

JavaScript's commit tier runs the example package's unit tests on Ubuntu and retains the existing lint and policy checks. The ready tier runs the full runtime and OS matrix, Docker validation on applicable changes, and CodeQL. The other templates use their existing lint and policy checks in the commit tier, with a reduced test matrix where the template has one. Adapt the fast suite to your project as it grows, or add the workspace planner described in the guide.

To run the full tier again, mark the draft PR ready or dispatch checks against the intended ref. Select `release_mode: checks`, or set `checks_only: true` for Python and PHP. Security workflows with scheduled scans keep those scans. They can also be dispatched independently.

The patch files live in Hive Mind. Each upstream template needs its patch applied before its hosted workflows use the new triggers.
