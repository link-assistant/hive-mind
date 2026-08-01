### Recent CI/CD runs on `main`

| Workflow            | Status    | Conclusion | Commit    | Run                                                                     |
| ------------------- | --------- | ---------- | --------- | ----------------------------------------------------------------------- |
| JS CI/CD Pipeline   | completed | failure    | `cff4148` | [run](https://github.com/link-assistant/agent/actions/runs/30572373896) |
| Rust CI/CD Pipeline | completed | failure    | `7af549d` | [run](https://github.com/link-assistant/agent/actions/runs/28688932169) |

Use all the best practices from CI/CD templates (check full file tree to compare for all GitHub workflow and CI/CD scripts file), if the same issue is found in template report issue also in templates:

- https://github.com/link-foundation/js-ai-driven-development-pipeline-template
- https://github.com/link-foundation/rust-ai-driven-development-pipeline-template

We should compare all files, so we don't have more CI/CD errors in the future and reuse all the best practices from these templates.

Follow the CI/CD best practices collected in [https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md](https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md).

Please plan and execute everything in this single pull request, you have unlimited time and context, as context auto-compacts and you can continue indefinitely, until it is each and every requirement fully addressed, and everything is totally done.

---

<details>
<summary>Context collected by <code>/fix --ci-cd</code></summary>

- **Repository:** [link-assistant/agent](https://github.com/link-assistant/agent)
- **Default branch:** `main`
- **Latest commit:** `fd42c4b` ([commit](https://github.com/link-assistant/agent/commit/fd42c4b6a56822e3239a2098a29062714c9c3585)) — 0.25.4
- **CI/CD runs found:** 2 (2 not passing)

**Detected languages**

- **TypeScript** — 54.9%
- **JavaScript** — 28.1%
- **Rust** — 16.4%
- **Shell** — 0.6%

**Recommended CI/CD templates**

Apply the best practices from these templates, in priority order (most-used language first):

1. **JavaScript / TypeScript** — [link-foundation/js-ai-driven-development-pipeline-template](https://github.com/link-foundation/js-ai-driven-development-pipeline-template) _(detected: TypeScript, JavaScript)_
2. **Rust** — [link-foundation/rust-ai-driven-development-pipeline-template](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template) _(detected: Rust)_

Other detected languages without a dedicated template: Shell.

</details>
