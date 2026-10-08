# 合并后自动修复 CI/CD

将 `--auto-fix-ci-cd` 与 `--auto-merge` 一起使用，可在 pull request 合并后继续解决 CI/CD 问题：

```bash
solve https://github.com/owner/repo/issues/123 --auto-merge --auto-fix-ci-cd
```

Telegram `/solve` 和 `hive` 也支持这些选项。此功能默认关闭；没有 `--auto-merge` 时，参数校验会拒绝 `--auto-fix-ci-cd`。

GitHub 确认合并后，solver 检查 pull request 实际目标分支上每个活动 workflow 的最新运行，以及当前分支提交上的运行，包括由标签触发的发布任务。失败、取消、超时和未知结果均视为错误。正在运行的 workflow 和缺失的运行记录会继续等待。

发布意图从活动 workflow 文件、包清单和引用的本地脚本中识别。脚本只被读取，不会被执行。所有检测到的输出都必须得到验证：

| 输出           | 所需证据                                                                             |
| -------------- | ------------------------------------------------------------------------------------ |
| GitHub release | 在合并后发布，标签提交包含合并的改动；草稿不算。                                     |
| npm            | 公共 npm registry 包含当前清单版本，且发布时间在合并之后。排除私有包。               |
| PyPI           | 当前静态 project/Poetry 版本在合并后上传了发行文件。                                 |
| crates.io      | 当前静态 crate 版本在合并后发布。排除 `publish = false` 或 `publish = []` 的 crate。 |
| GitHub Pages   | 合并后成功的 `github-pages` 环境部署，或基于分支的 Pages 构建，且提交包含该改动。    |

原始合并后可能还有版本更新提交。验证器从当前目标分支提交读取包元数据，并检查 release 和部署提交的 Git 祖先关系。每次修复后，会读取该修复 pull request 的合并提交；发布机器人推进分支本身不能证明修复已合并。旧 release 或 registry 版本不能让新合并通过检查。

CI 全绿但没有任何 release 或部署仍然是错误。跳过发布步骤也不够。若 registry、动态版本或发布配置无法验证，solver 会报告缺少的证据。直接 registry 验证支持公共 npm、PyPI 和 crates.io。识别到的 NuGet、Maven/Gradle、RubyGems、Dart 和 Composer 发布器仍需额外的验证支持；私有 registry 和外部可复用 workflow 也需额外支持。文件清单被截断或文件无法读取仍视为错误。

监控器在合并后留出一分钟等待延迟出现的 workflow，最多等待 CI 一小时，并在 workflow 完成后留出五分钟等待输出可见。`--verbose` 显示轮询与证据诊断。

验证失败时，solver 使用现有 `/fix --ci-cd` 模板创建 Bug issue，包含目标提交、workflow 失败和缺少的输出证据。随后使用 `--development-log --deep-analysis --auto-merge` 解决该 issue，保留 `--tool`、`--model`、`--think` 等 worker 选项。每次修复在原始目标分支上使用新的 checkout 和工具会话。父进程在修复完成后重新检查 CI/CD；子 solver 不会递归启动另一条修复链。

修复消耗父 solve 共享的 `--auto-restart-max-iterations` 预算（默认 5）。设置为 `0` 可无限修复。预算耗尽、子进程失败、目标分支未变化或中断均使命令失败，修复 issue/PR 会保留供检查。

GitHub API 参考：[releases](https://docs.github.com/en/rest/releases/releases)、[部署状态](https://docs.github.com/en/rest/deployments/statuses)、[Pages 构建](https://docs.github.com/en/rest/pages/pages)和[提交比较](https://docs.github.com/en/rest/commits/commits#compare-two-commits)。
