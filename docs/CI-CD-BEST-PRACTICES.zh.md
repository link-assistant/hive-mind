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
- **被规则拒绝不等于发布失败** - 当仓库规则集要求变更必须经由拉取请求时，发布任务应为其版本升级开一个 PR，而不是死在这次拒绝上。该路径与竞争失败时的 rebase 重试路径，是对两种打印同一个词的拒绝的两种不同恢复方式（参见原则 10）

**禁止在 PR 中手动更改版本** — 所有版本升级应由 CI 发布工作流管理：

```yaml
version-check:
  if: github.event_name == 'pull_request'
  steps:
    - name: Check for version changes in package.json
      run: node scripts/check-version.mjs
```

### 10. 并发控制

**将可取消的只读检查与不可取消的写入任务分开。** 当工作流同时包含这两类任务时，应在任务级别配置并发控制：

```yaml
jobs:
  lint:
    # 加入任务标识（以及适用的 matrix 值），使无关检查保持并行，
    # 同时让新运行仅替换对应的过时检查。
    concurrency:
      group: check-${{ github.workflow }}-${{ github.ref }}-lint
      cancel-in-progress: true
    # ...

  deploy:
    needs: [lint]
    if: ${{ !cancelled() && needs.lint.result == 'success' }}
    # 所有写入 main 或外部部署目标的任务都使用同一个仓库级分组，
    # 即使这些任务位于不同的工作流中。
    concurrency:
      group: main-writer-${{ github.repository }}-main
      cancel-in-progress: false
    # ...
```

- **只读任务：** 在拉取请求和 `main` 上都取消已被取代的检查，以减少 runner 负载。为每个任务使用不同后缀；加入相关 matrix 值，使不同的 matrix 项仍可并行运行。
- **依赖写入任务：** 使用 `needs` 并要求前置检查成功。前置任务被取消后，其写入任务不得启动。
- **活动写入任务：** 为所有发布、部署、打标签、生成内容推送及其他写入任务使用同一个仓库级分组，并设置 `cancel-in-progress: false`。已启动的写入任务会完成，下一个写入任务在队列中等待，即使它来自另一个工作流文件。
- **工作流范围：** 当工作流包含写入任务时，不要在工作流级别设置可取消的并发控制；否则也会中断已启动的写入任务。

默认情况下，一个并发分组最多保留一个运行中任务和一个待处理任务；新的待处理写入任务会替换旧的待处理任务。如果队列中的每次写入都必须执行，请在写入任务的并发配置中加入 `queue: max`（最多可等待 100 个任务）。`queue: max` 不能与 `cancel-in-progress: true` 同时使用；执行顺序依据任务开始等待的时间，而非工作流触发顺序，因此写入任务应保持幂等。

在任务条件中使用 `!cancelled()` 而非 `always()`，以便取消操作正确地在任务图中传播。单独使用 `always()` 可能导致下游工作在取消后仍继续运行。

**串行化只决定写入任务的顺序，并不会替它们执行 rebase。** 并发分组决定每个写入任务_何时_运行，而不是它检出了_什么_。`actions/checkout` 检出的是 `github.sha`——触发该次运行的提交——因此队列中的第二个写入任务在第一个任务落地的瞬间，就已经落后目标分支一个或多个提交，其推送会被拒绝：

```
 ! [rejected]        main -> main (non-fast-forward)
```

缺少这一条时，上面的建议只是把“两个写入任务相互冲突”变成“第二个写入任务必然失败”——这更好，因为它是确定且显眼的，但发布仍然是坏的。`link-foundation/browser-commander` 严格实现了该分组（三个工作流文件中的三个语言发布任务，时间上完全没有重叠），其三次发布中仍有两次止于这一行。每次运行看起来都像普通的不稳定 CI，于是损失在无人察觉中累积：crates.io 上的 Rust crate 已经到了 0.10.11，而 `main` 上的 `Cargo.toml` 仍写着 0.9.0；Python 包则根本没有发布过，因为任务死在了排在发布步骤之前的 changelog 推送上。

**不要用 checkout 的 `ref: main` 来“修复”它。** 那样只是让拒绝消声，转而去构建、测试并发布一棵 CI 从未验证过的代码树，而日志里对此只字不提。拒绝才是诚实的结果；缺少的是恢复手段。

**为每个写入任务提供一个先分类拒绝、再 rebase 重试的推送。** 仓库规则集的拒绝（GH006、GH013——“Changes must be made through a pull request”）同样会打印 `[rejected]`，而再多次 rebase 也无法满足规则；它需要的是拉取请求路径（参见原则 9）。重试只会浪费队列名额，并报告错误的原因。

```js
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const result = await run('git', ['push', remote, branch]);
  if (result.code === 0) return { pushed: true, attempt };
  // 规则无法通过 rebase 满足：让同一个提交经由 PR 落地。
  if (isBlockedByRepositoryRule(result)) return landViaPullRequest({ branch, ...ctx });
  // 认证、网络、缺失的 remote：rebase 会掩盖真正的错误。
  if (!isNonFastForward(result) || attempt === maxAttempts) throw new CommandFailedError('git', ['push', remote, branch], result);
  await run('git', ['pull', '--rebase', remote, branch]);
}
```

- **在共享分支上永远不要 `--force`，也不要 `--force-with-lease`。** 两者都会把一次失败的竞争变成对前一个写入任务成果的静默删除。rebase 正是关键：较晚的提交必须落在较早的提交之上。
- **rebase 之后，重新计算此前推导出的一切。** 基于过时分支尖端选定的版本号、changelog 条目或标签，可能已被赢得队列的那个写入任务占用。请重新读取状态，而不是重放原有计划。
- **只有推送真正落地后才报告成功。** 在推送确认之前就设置 `version_committed=true` 的步骤，会让下游发布任务基于一个只存在于该 runner 上的提交继续工作。
- **限制重试次数，并在日志中写明原因。** 少量重试配合短暂延迟足以覆盖排队；而针对确实受保护的分支进行无限循环，只会把快速失败拖成漫长失败。

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

### 13. 容器镜像：每种架构使用原生运行器

**在各自的原生运行器上构建每种架构。** GitHub 为公共仓库提供免费的 arm64 Linux 运行器（`ubuntu-24.04-arm`）。在 x86 运行器上通过 QEMU 模拟 arm64 会慢得多，而且单个任务中的两个构建会串行而非并行执行。

```yaml
build-image:
  strategy:
    matrix:
      include:
        - platform: linux/amd64
          runner: ubuntu-latest
        - platform: linux/arm64
          runner: ubuntu-24.04-arm
  runs-on: ${{ matrix.runner }}
  steps:
    - uses: docker/build-push-action@v7
      with:
        platforms: ${{ matrix.platform }}
        cache-from: type=gha
        cache-to: type=gha,mode=max
        outputs: type=image,push-by-digest=true,name-canonical=true,push=true

merge-manifest:
  needs: [build-image]
  steps:
    - run: docker buildx imagetools create -t $IMAGE:$VERSION $DIGESTS
```

- **不要使用 `setup-qemu-action`。** 它表示正在模拟架构；请使用原生运行器。
- **为用户使用的每种架构发布镜像。** 单架构镜像会排除 Apple Silicon、Graviton 和 arm CI runners。
- **始终使用缓存。** 在每个构建步骤设置 `cache-from: type=gha` 和 `cache-to: type=gha,mode=max`。
- **绝不要让发布依赖镜像推送。** 先发布 GitHub Release 和语言注册表软件包，再附加已完成的镜像。
- **验证发布内容。** Manifest 应列出所有预期平台，default branch 上的每个 tag 都应有对应的 GitHub Release。

参考实现：[`link-foundation/box`](https://github.com/link-foundation/box) 和 [`link-assistant/hive-mind`](https://github.com/link-assistant/hive-mind)。

### 14. 对 workflows 本身进行 lint

**Pipeline 也是代码，而默认没有任何东西对它做 lint。** Workflow files 会不断积累 shell 引号错误、过于宽泛的 `permissions`、unpinned actions 以及 template-injection 注入点，而 pipeline 中没有任何 job 在查找它们——因为每个 job 都忙着检查应用程序。

在单独的 workflow 中使用两个互补的工具，由 `.github/` 的改动触发：

- [`actionlint`](https://github.com/rhysd/actionlint) — 语法、表达式，以及（最关键的）每个 `run:` 块内部的 shell。
- [`zizmor`](https://docs.zizmor.sh/) — 安全审计：`excessive-permissions`、`unpinned-uses`、`template-injection`、`artipacked`。

```yaml
- uses: docker://rhysd/actionlint:1.7.12
  with:
    args: -color
```

- **以 Docker image 方式运行 actionlint，而不是裸二进制文件。** 该镜像自带 `shellcheck` 和 `pyflakes`。`PATH` 上没有 `shellcheck` 的二进制文件会静默跳过所有 shell 检查并 exit 0——因此本地跑绿了什么也说明不了。正是这一个细节决定了是找到十四个 shell bug 还是一个也找不到。
- 对 zizmor 而言，除非 workflow 运行的所有场景都启用了 code scanning，否则**优先使用 annotations 而非 SARIF**。SARIF 上传在 forks 上会静默失败；annotations 在两种情况下都会明确失败。
- **设置置信度下限，而不是严重性下限。** `--min-confidence medium` 按工具的确信程度过滤，而不是按发现的严重程度。对落在下限以下的内容审阅一次并记录决定，而不是日后才发现下限一直掩盖着一个真实的发现。
- **将 suppressions 限定到单个文件，并写明何时可以移除。** 一刀切的 `ignore` 与完全没有这道关卡毫无区别。

### 15. 审计依赖树

**Code scanning 不审计你的依赖，而 PR 范围内的 dependency review 也不审计你已经拥有的依赖。** 这两个 job 合起来看似完整覆盖，中间却留下一个缺口：CodeQL 分析你的源代码，而 `dependency-review-action` 只在 `pull_request` 上运行，并且只检查 PR *改动过*的依赖。针对某个已固定一年的软件包发布的 advisory，对两者永远不可见，因为没有任何 PR 会碰到那一行。

```yaml
- run: npm audit --package-lock-only --audit-level=high
```

- **按提交时的原样审计 lockfile**（`--package-lock-only`）。它报告的是使用者实际会得到的内容，也无法靠仅在本 runner 上发生的依赖解析把结果变绿。
- **把这个 job 放到 schedule 上**，而不只是放在 push 上。只有定时运行才能发现代码停止变动之后才发布的 advisory。
- **显式设置级别。** 默认值是 `low`，那会让所有人习惯于忽略这个 job；完全不加 flag 与刻意写上 `--audit-level=high` 是两种不同的失败。

### 16. 在构建之前先证明你能发布

**Pull request 存在的意义是测试代码；向默认分支的 push 存在的意义是产出发布。** 这是两件不同的事，缺失的凭据对它们意味着不同的东西。在 pull request 上它是一个警告——fork 拿不到 secrets，代码依然可以被测试。在默认分支上它就是答案：如果任何一个计划中的发布所需的凭据不可用，此后这次运行做的一切都无法产出发布，花在构建上的每一分钟都是浪费。

把 `preflight` job 放在最前面，让每个发布 job 都 `needs:` 它。

```yaml
release-preflight:
  runs-on: ubuntu-latest
  permissions:
    contents: read
    id-token: write # 这样探测就能在 `npm publish` 需要之前确认 OIDC 可用
  steps:
    - uses: actions/checkout@v7
    - env:
        PREFLIGHT_MODE: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && 'release' || 'report' }}
      run: node scripts/preflight-credentials.mjs --mode "$PREFLIGHT_MODE"

release:
  needs: [release-preflight]
  if: ${{ !cancelled() && needs.release-preflight.result == 'success' }}
```

- **用写入去探测，而不是用登录。** ghcr.io 的 token 端点对任何 scope 都返回 200，什么都不校验——随后的 push 才会以 403 失败。docker.io 对匿名的 push scope 请求返回 200，而 `access` 声明只有 pull。开一个 blob 上传会话（`POST /v2/<repo>/blobs/uploads/`）再用 `DELETE <Location>` 取消它：一次往返，什么都不留下，而且这是唯一一种不靠猜测的检查形式。
- **报告每一个失败，而不是第一个。** Preflight 的价值在于一份点名所有缺失凭据的报告。会中断 job 的登录步骤会把其余问题掩盖掉，所以让它 `continue-on-error: true`，由 preflight 脚本来判定。
- **检查可达性，而不只是可写性。** GHCR 的包在首次 push 后是私有的，并且一直私有到有人去点一下；为一个没人能拉取的包继续发布新版本，正是这个 job 要跳过的计算。GitHub 没有暴露查询包可见性的 API（packages REST API 只有 GET/DELETE/restore），所以这是一个手动步骤，流水线只能检测并把它说出来。
- **优先使用 trusted publishing。** 会过期的凭据就是一次等着日历日期到来的发布中断。npm（`id-token: write` + `--provenance`）和 Docker Hub（`DOCKERHUB_OIDC_CONNECTIONID`，不写 `password:`）都支持 OIDC。动手之前先检查 `ACTIONS_ID_TOKEN_REQUEST_URL`——只有在授予了 `id-token: write` 时 runner 才会注入它，这样配置只做了一半时，失败信息说的是权限，而不是 token 请求。
- **匿名地、单独地验证发布结果。** 永远不要让发布依赖于推送的成败（一个失败的镜像不该抹掉一个好的发布），但事后一定要在不带任何凭据的情况下检查：你发布的东西能不能被拉取。带认证的检查测量的是发布者的视角；读者既拿不到那次登录，也得不到善意的假设。
- **报告 `unknown`，而不是猜测。** 超时或返回 HTTP 429 的 registry 并没有说凭据坏了，而一次什么都没能验证的运行也不是通过。要说清楚发生的是哪一种："0 项已验证，3 项未知"是可以行动的，"没有失败"不是。

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
4. **创建一个修复 issue**，列出失败的运行、检测到的语言、推荐的模板以及指向本文档的链接。该 issue 以 **Bug** 类型创建（并附带 `bug` 标签），其标题和正文取自[标准修复模板](https://github.com/link-assistant/web-capture/issues/139)。
5. **将该 issue 移交给 `/solve --development-log --deep-analysis --auto-merge`**，它会持续迭代直到修复被合并。`fix` 自身不消费的每个选项（例如 `--tool`、`--model`、`--think`）都会转发给 `/solve`。

### 为什么该 issue 是 Bug 类型，以及它省略了什么

`--development-log` 会取代模板中已废弃的 case-study 文件夹指令，并将产物收集到 `./dev/log/issues/{issue-id}/pulls/{pull-id}`。无论使用 `--no-solve` 还是只启用部分选项，`/fix` 都不会生成已废弃的段落。`--deep-analysis` 会提供时间线、根本原因、调试输出和上游 issue 报告指引，因此 `fix` 会按条件省略相应段落，避免重复传递。

这种省略之所以不会丢失信息，是因为 `/solve` **仅对 Bug 类型的 issue** 输出根本原因相关的措辞 —— 这正是 `fix` 将 issue 创建为 Bug 的原因。issue 类型按组织配置，标签按仓库配置，因此如果目标仓库两者都不接受，issue 仍会在不带它们的情况下被创建。

任何选项组合都无法恢复已废弃的段落；`--development-log` 是唯一受支持的数据收集流程。其余条件性省略由 `--deep-analysis` 控制。

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
