# 分支保护策略 (languages: [en](BRANCH_PROTECTION_POLICY.md) • zh • [hi](BRANCH_PROTECTION_POLICY.hi.md) • [ru](BRANCH_PROTECTION_POLICY.ru.md))

## 概述

本文档概述了 hive-mind 仓库 `main` 分支的分支保护规则和必需的状态检查。这些规则确保代码质量、防止引入破坏性变更，并维护稳定的主分支。

## 为什么需要分支保护？

分支保护规则可以防止：

- 合并测试失败的 pull request
- 合并不符合格式标准的代码
- 引入未经 CI 验证的变更
- 意外地向主分支强制推送
- 合并跳过关键检查的 pull request

**参见：** [案例研究：Issue #958](./case-studies/issue-958/ANALYSIS.md)，了解缺少适当分支保护可能发生的真实案例。

## 必需的状态检查

所有向 `main` 提交的 pull request 在合并前必须通过以下检查：

### 关键检查（必须通过）

1. **Check for Changesets**（`changeset-check`）
   - 确保每个 PR 包含用于版本管理的 changeset
   - 仅在 PR 上运行，不在主分支推送时运行
   - 自动发布 PR 会跳过此检查

2. **test-compilation**
   - 验证所有 `.mjs` 文件的 JavaScript 语法
   - 确保代码编译时没有语法错误
   - 快速失败检查（约 7-8 秒）

3. **lint**
   - 对所有适用文件运行 Prettier 格式检查
   - 运行 ESLint 代码质量检查
   - 验证代码风格一致性
   - 运行时间约 20-26 秒

4. **check-file-line-limits**
   - 确保没有 `.mjs` 文件超过 1500 行
   - 鼓励代码模块化和可维护性
   - 快速检查（约 7 秒）

5. **test-suites**
   - 运行综合测试套件
   - 验证核心功能
   - 运行时间约 3-4 分钟

6. **test-execution**
   - 测试实际命令执行场景
   - 验证真实使用模式
   - 运行时间约 2 分钟

7. **validate-docs**
   - 确保文档文件有效
   - 检查断链或格式错误的内容
   - 运行时间约 8-12 秒

8. **memory-check-linux**
   - 测试内存泄漏和过度使用
   - 确保性能标准
   - 运行时间约 30 秒

### 可选检查（可以跳过）

这些检查根据更改的文件有条件地运行：

- **docker-pr-check**：仅在与 Docker 相关的文件更改时运行
- **helm-pr-check**：如果 Helm chart 有变更则进行验证
- **Release jobs**：仅在版本升级提交时运行

## 配置步骤

### 针对仓库管理员

在 GitHub 中配置这些规则：

1. 导航到 **Settings** → **Branches**
2. 点击 **Add rule** 或编辑 `main` 的现有规则
3. 配置以下内容：

#### 基本设置

- ✅ **Require a pull request before merging**（合并前需要 pull request）
  - Required approvals（必需审批数）：0（或更严格策略为 1）
  - ✅ 推送新提交时撤销过时的 pull request 审批
  - ⬜ Require review from Code Owners（可选）
- ✅ **Require status checks to pass before merging**（合并前需要状态检查通过）
  - ✅ **Require branches to be up to date before merging**（合并前需要分支是最新的）
  - 选择以下状态检查：
    - `Check for Changesets`
    - `test-compilation`
    - `lint`
    - `check-file-line-limits`
    - `test-suites`
    - `test-execution`
    - `validate-docs`
    - `memory-check-linux`
- ✅ **Require conversation resolution before merging**（推荐）
- ✅ **Do not allow bypassing the above settings**（推荐）

#### 附加保护

- ⬜ **Require deployments to succeed before merging**（不适用）
- ⬜ **Lock branch**（不推荐——会阻止所有推送）
- ⬜ **Require linear history**（可选——强制 rebase 或 squash）

## 了解检查状态

GitHub 将以下状态视为可合并：

- ✅ **Success**（成功）：检查通过
- ⚠️ **Skipped**（跳过）：检查被有条件地跳过
- ➖ **Neutral**（中性）：检查完成但结果为中性

⚠️ **重要：** "跳过"被视为通过！这就是为什么我们必须明确列出所需检查的原因。

## 没有分支保护会发生什么？

没有这些规则，可能会发生以下情况：

1. **静默失败**：PR 可能在跳过检查的情况下合并，引入问题
2. **主分支失败**：通过 PR 检查的代码可能在 main 上失败
3. **质量下降**：格式、lint 或测试问题悄悄溜过
4. **发布阻塞**：主分支 CI 失败可能阻止发布

**真实案例：** PR #955 在 `lint` 检查被跳过的情况下合并了，因为它只修改了 `.md` 文件。工作流会有条件地跳过非代码变更的 `lint` 检查。合并后，主分支 CI 失败，因为这些文件存在格式问题。

## 工作流条件逻辑

CI 工作流使用变更检测来优化 CI 时间：

```yaml
detect-changes:
  outputs:
    mjs-changed: # true if .mjs files changed
    package-changed: # true if package.json changed
    docs-changed: # true if .md files changed
    workflow-changed: # true if workflow files changed
    docker-changed: # true if Docker files changed
    any-code-changed: # true if any code files changed
```

任务使用这些输出有条件地运行：

```yaml
lint:
  if: |
    always() &&
    (github.event_name == 'push' || needs.changeset-check.result == 'success') &&
    (needs.detect-changes.outputs.mjs-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true')
```

**问题：** 在 PR 上，`lint` 仅在 `.mjs` 或工作流文件更改时运行。但在主分支推送时，无论如何都会运行。这种不一致性造成了案例研究 #958 中记录的问题。

**分支保护解决方案：** 通过要求 `lint` 处于"success"状态（而不是"skipped"），我们确保它在需要时始终运行。

## 故障排除

### 检查显示为"Expected"但从未运行

**原因：** 分支保护中的检查名称与工作流中的任务名称不匹配。

**解决方案：**

1. 转到最近的 PR
2. 点击"Show all checks"
3. 复制 GitHub 显示的确切检查名称
4. 在分支保护设置中使用该确切名称

### 检查在合法更改时持续失败

**原因：** 检查可能过于严格或存在 bug。

**解决方案：**

1. 审查检查的目的
2. 修改代码以满足检查要求，或
3. 如果检查错误地失败，更新检查逻辑

### 因为检查卡在"Pending"状态而无法合并

**原因：** GitHub Actions runner 问题或工作流语法错误。

**解决方案：**

1. 在 Actions 标签中查看工作流运行情况
2. 在工作流 YAML 中查找错误
3. 重新运行失败的检查
4. 如果持续存在，可能需要临时禁用该特定检查

## 维护

### 添加新的必需检查

添加新的应始终通过的 CI 检查时：

1. 将检查添加到工作流
2. 在 PR 上进行测试
3. 确认正常工作后，将其添加到分支保护必需检查中
4. 更新本文档

### 移除必需检查

仅在以下情况下移除必需检查：

1. 检查已过时或被另一个检查替代
2. 检查持续出现误报失败
3. 团队共识认为其不重要

在本文件中记录原因。

## 参考资料

- [GitHub 文档：关于受保护分支](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub 文档：管理分支保护规则](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)
- [GitHub 文档：排查必需状态检查问题](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)
- [案例研究：Issue #958 - 未格式化文件合并到主分支](./case-studies/issue-958/ANALYSIS.md)

## 有疑问？

如果您对分支保护有疑问或需要特定场景的帮助，请：

1. 查看 `docs/case-studies/` 中的案例研究
2. 查看工作流文件：`.github/workflows/release.yml`
3. 使用 `question` 标签开启一个 issue

---

**最后更新：** 2025-12-21
**维护者：** 仓库维护团队
