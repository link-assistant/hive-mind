# AI 驱动开发的 CI/CD 最佳实践 (languages: [en](CI-CD-BEST-PRACTICES.md) • zh • [hi](CI-CD-BEST-PRACTICES.hi.md) • [ru](CI-CD-BEST-PRACTICES.ru.md))

本文档描述了能够显著提高 AI 驱动开发工作流质量和可靠性的 CI/CD 最佳实践。经过正确配置后，Hive Mind AI 求解器将被强制与 CI/CD 检查进行迭代，直到所有测试通过，从而确保代码质量达到最高标准。

## 为什么 CI/CD 对 AI 开发如此重要

Hive Mind 的 AI issue 求解器被指示关注每个 pull request 中的 CI/CD 检查。这创建了一个强大的反馈循环：

1. **AI 创建解决方案** - 求解器根据 issue 需求生成代码
2. **CI/CD 验证解决方案** - 自动化检查验证代码质量
3. **AI 迭代直到通过** - 求解器修复问题直到所有检查通过
4. **质量得到保证** - 没有代码可以在未通过所有关卡的情况下合并

无论团队由人类、AI 或两者共同组成，这种方法都能确保一致的质量。

## 推荐的 CI/CD 模板

我们为多种语言提供开箱即用的模板，预先配置了所有最佳实践：

| 语言                  | 模板仓库                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript/TypeScript | [js-ai-driven-development-pipeline-template](https://github.com/link-foundation/js-ai-driven-development-pipeline-template)         |
| Rust                  | [rust-ai-driven-development-pipeline-template](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template)     |
| Python                | [python-ai-driven-development-pipeline-template](https://github.com/link-foundation/python-ai-driven-development-pipeline-template) |
| Go                    | [go-ai-driven-development-pipeline-template](https://github.com/link-foundation/go-ai-driven-development-pipeline-template)         |
| C#                    | [csharp-ai-driven-development-pipeline-template](https://github.com/link-foundation/csharp-ai-driven-development-pipeline-template) |
| Java                  | [java-ai-driven-development-pipeline-template](https://github.com/link-foundation/java-ai-driven-development-pipeline-template)     |
| PHP                   | [php-ai-driven-development-pipeline-template](https://github.com/link-foundation/php-ai-driven-development-pipeline-template)       |

> **提示：** 您不必手动挑选模板。运行 `fix <repository-url> --ci-cd`（参见[自动 CI/CD 修复](#自动-cicd-修复)），Hive Mind 会检测仓库使用的语言并为您选择匹配的模板。

## 关键 CI/CD 原则

### 1. 仅对相关文件变更运行检查

**仅在相关文件发生变更时触发检查。** 这可以大幅降低 CI 成本和运行时间。

在工作流开始时使用 `detect-changes` 任务来确定哪些文件类别发生了变更：

```yaml
jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      code-changed: ${{ steps.changes.outputs.code }}
      docs-changed: ${{ steps.changes.outputs.docs }}
      docker-changed: ${{ steps.changes.outputs.docker }}
      workflow-changed: ${{ steps.changes.outputs.workflow }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - name: Detect changes
        id: changes
        run: node scripts/detect-code-changes.mjs
```

然后根据相关输出设置每个任务的条件：

```yaml
test-suites:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.code-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true'
  # ...

validate-docs:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.docs-changed == 'true'
  # ...

docker-pr-check:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.docker-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true'
  # ...
```

**"代码变更"检测中应排除的内容：**

- Markdown 文件（`*.md`）— 仅文档变更不需要 changeset 文件
- `.changeset/` 文件夹 — changeset 元数据不是代码
- `data/` 和 `experiments/` 文件夹 — 非生产内容
- `.gitkeep` 文件 — 无功能影响的占位符文件

**变更时始终触发检查的内容：**

- 源代码文件（`.mjs`、`.ts`、`.py`、`.rs`、`.go` 等）
- `package.json` / 依赖清单
- CI/CD 工作流文件（`.github/workflows/*.yml`）
- `Dockerfile` 和相关基础设施文件

### 2. 文件大小限制

**每个代码文件强制执行最多 1000-1500 行的限制。**

此约束对 AI 和人类开发者都有好处：

- AI 模型可以在上下文窗口内读取和理解整个文件
- 人类可以在不产生认知过载的情况下浏览和理解文件
- 强制模块化、组织良好的代码架构

CI 中的示例强制执行（bash）：

```bash
find src/ -name "*.mjs" -type f | while read -r file; do
  line_count=$(wc -l < "$file")
  if [ "$line_count" -gt 1500 ]; then
    echo "ERROR: $file has $line_count lines (limit: 1500)"
    echo "::error file=$file::File has $line_count lines (limit: 1500)"
    exit 1
  fi
done
```

**将文件大小 ESLint 规则与 CI 检查同步**，在 CI 之前在本地捕获违规：

```js
// eslint.config.mjs
{
  rules: {
    'max-lines': ['error', { max: 1500 }]
  }
}
```

### 3. 自动化代码格式化

一致的格式消除了风格争论并减少了 diff 噪音：

| 语言                  | 工具                          |
| --------------------- | ----------------------------- |
| JavaScript/TypeScript | ESLint + Prettier             |
| Rust                  | rustfmt                       |
| Python                | Ruff                          |
| Go                    | gofmt                         |
| C#                    | dotnet format                 |
| Java                  | Spotless (Google Java Format) |
| PHP                   | PHP CS Fixer                  |

所有模板都包含在每次提交前自动运行格式化工具的 pre-commit 钩子。

### 4. 静态分析与代码检查

在代码到达审查之前捕获 bug 并强制执行模式：

| 语言                  | 工具                         |
| --------------------- | ---------------------------- |
| JavaScript/TypeScript | ESLint（严格规则）           |
| Rust                  | Clippy（pedantic + nursery） |
| Python                | Ruff + mypy                  |
| Go                    | go vet + staticcheck         |
| C#                    | .NET 分析器（警告视为错误）  |
| Java                  | SpotBugs（最大力度）         |
| PHP                   | PHPStan（最高级别）          |

### 5. 快速失败任务排序

**在慢速检查之前运行快速检查**，以提供最快的反馈：

```
快速检查（每个约 7-30 秒）：     慢速检查（每个约 1-10 分钟）：
├── test-compilation            ├── test-suites（单元测试）
├── lint（格式 + ESLint）       ├── test-execution（集成测试）
└── check-file-line-limits      ├── docker-pr-check
                                └── helm-pr-check
```

将慢速检查置于快速检查之后：

```yaml
test-suites:
  needs: [test-compilation, lint, check-file-line-limits]
  if: |
    always() &&
    !cancelled() &&
    !contains(needs.*.result, 'failure') &&
    needs.test-compilation.result == 'success' &&
    needs.lint.result == 'success' &&
    needs.check-file-line-limits.result == 'success'
```

### 6. 基于 Changeset 的版本控制

所有模板使用 changeset 系统，该系统：

- **消除合并冲突** - 每个 PR 创建一个独立的 changeset 文件
- **自动化版本升级** - 合并时最高升级类型获胜
- **生成变更日志** - 发布说明自动编译
- **支持语义化版本** - patch/minor/major 升级是明确的

| 语言                  | 工具                     |
| --------------------- | ------------------------ |
| JavaScript/TypeScript | @changesets/cli          |
| Rust                  | changelog.d + 自定义脚本 |
| Python                | Scriv                    |
| PHP                   | changelog.d + 自定义脚本 |
| Go、C#、Java          | 自定义 changeset 工作流  |

**免除仅文档 PR 的 changeset 要求：**

```yaml
changeset-check:
  needs: [detect-changes]
  if: github.event_name == 'pull_request' && needs.detect-changes.outputs.any-code-changed == 'true'
```

仅文档变更（更新 `.md` 文件）不应需要版本升级。

### 7. 验证实际合并结果

**CI 必须测试实际将被合并的内容，而非过期的 PR 快照。**

当针对基础分支开启 PR 后，若基础分支收到新提交，GitHub 合并预览可能变得过期。在运行检查之前模拟新合并：

```yaml
- name: Simulate fresh merge with base branch (PR only)
  if: github.event_name == 'pull_request'
  env:
    BASE_REF: ${{ github.base_ref }}
  run: |
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git config user.name "github-actions[bot]"
    git fetch origin "$BASE_REF"
    BEHIND_COUNT=$(git rev-list --count HEAD..origin/$BASE_REF)
    if [ "$BEHIND_COUNT" -gt 0 ]; then
      git merge origin/$BASE_REF --no-edit || \
        (echo "::error::Merge conflict! PR must be rebased before merging." && exit 1)
    fi
```

这确保了 lint、文件大小和其他检查验证的是最终合并状态。

### 8. Pre-commit 钩子

本地质量关卡防止损坏的提交到达 CI：

1. 格式检查和自动修复
2. Lint 和静态分析
3. 类型检查（适用时）
4. 文件大小验证
5. 密钥检测

这种"左移"方法立即捕获问题，而不是等待 CI。

### 9. 发布自动化

自动化发布工作流确保：

- **无需手动版本管理** - 版本自动更新
- **OIDC 受信发布** - CI 中无需 API token（npm、PyPI、crates.io）
- **仅验证通过的发布** - 所有检查必须在发布前通过
- **双触发模式** - 自动（合并时）和手动（工作流调度）

**禁止在 PR 中手动更改版本** — 所有版本升级应由 CI 发布工作流管理：

```yaml
version-check:
  if: github.event_name == 'pull_request'
  steps:
    - name: Check for version changes in package.json
      run: node scripts/check-version.mjs
```

### 10. 并发控制

**防止多个工作流运行相互冲突：**

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  # Cancel older runs on main to always release the latest version
  cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}
```

在任务条件中使用 `!cancelled()` 而非 `always()`，以便取消操作正确地在任务图中传播。

### 11. 密钥检测

防止在 CI 中意外泄露凭据：

- 使用 `secretlint` 或 `truffleHog` 等工具包含密钥扫描步骤
- 检测到密钥时立即使 CI 失败
- 永远不要记录环境变量或 token 值

### 12. 文档验证

**像验证代码一样在 CI 中验证文档文件：**

- 检查文件大小限制（例如文档最多 2500 行）
- 验证关键文档中存在必需的章节
- 使用 `lychee` 等工具检查断链

```yaml
validate-docs:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.docs-changed == 'true'
  steps:
    - run: node tests/docs-validation.mjs
```

## 质量强制策略

这些模板实现了纵深防御方法：

```
开发者机器        →    CI/CD 流水线         →    发布
├── Pre-commit 钩子    ├── detect-changes      ├── 所有检查通过
├── 本地测试           ├── version-check       ├── 版本升级
└── IDE 集成           ├── changeset-check     ├── 变更日志更新
                       ├── test-compilation    └── 发布包
                       ├── lint (format+ESLint)
                       ├── check-file-line-limits
                       ├── test-suites
                       ├── test-execution
                       ├── validate-docs
                       └── docker-pr-check
```

每一层捕获不同的问题，确保没有有问题的代码进入生产环境。

## 入门指南

1. 从上面的表格中**选择与您的语言匹配的模板**
2. **将其用作 GitHub 模板**来创建您的新仓库
3. 如果发布需要，**配置密钥**（推荐使用 OIDC）
4. **开始开发**，所有最佳实践均已预先配置

AI 求解器将自动尊重所有已配置的检查并与之迭代，产生比没有 CI/CD 强制的仓库更高质量的输出。

## 自动 CI/CD 修复

对于现有仓库，您无需手动应用这些实践。`fix` 命令可自动完成整个流程：

```bash
fix https://github.com/owner/repo --ci-cd
```

此命令将：

1. **检测仓库使用的语言** — 使用 GitHub Linguist API（`GET /repos/{owner}/{repo}/languages`），按每种语言的字节数排序。
2. **从上面的表格中选择匹配的 CI/CD 模板** — 经过排序，使最常用语言的模板排在最前面。
3. **检查默认分支的最新提交** 并收集其 CI/CD 运行（当最新提交没有运行时，回退到默认分支上最近的运行）。
4. **创建一个修复 issue**，列出失败的运行、检测到的语言、推荐的模板以及指向本文档的链接。
5. **将该 issue 移交给 `/solve --auto-merge`**，它会持续迭代直到修复被合并。`fix` 自身不消费的每个选项（例如 `--tool`、`--model`、`--think`）都会转发给 `/solve`。

### 语言 → 模板映射

该命令将检测到的语言映射到模板，规则如下（JavaScript 和 TypeScript 共用一个模板）：

| 检测到的语言          | 模板                                                             |
| --------------------- | ---------------------------------------------------------------- |
| JavaScript/TypeScript | `link-foundation/js-ai-driven-development-pipeline-template`     |
| Rust                  | `link-foundation/rust-ai-driven-development-pipeline-template`   |
| Python                | `link-foundation/python-ai-driven-development-pipeline-template` |
| Go                    | `link-foundation/go-ai-driven-development-pipeline-template`     |
| C#                    | `link-foundation/csharp-ai-driven-development-pipeline-template` |
| Java                  | `link-foundation/java-ai-driven-development-pipeline-template`   |
| PHP                   | `link-foundation/php-ai-driven-development-pipeline-template`    |

没有专用模板的语言（例如 Shell 或 Dockerfile）会在 issue 中列出以供知悉，并推荐最接近的匹配模板。

使用 `--dry-run` 可在不创建 issue 的情况下预览，使用 `--no-solve` 可在不启动 `/solve` 的情况下创建 issue：

```bash
fix owner/repo --ci-cd --dry-run
fix owner/repo --ci-cd --no-solve
```

## 参考资料

- [代码架构原则](https://github.com/link-foundation/code-architecture-principles)
- [贡献指南](./CONTRIBUTING.md)
- [最佳实践](./BEST-PRACTICES.md)
