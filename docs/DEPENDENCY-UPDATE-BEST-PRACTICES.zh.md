# AI 驱动开发的依赖更新最佳实践 (languages: [en](DEPENDENCY-UPDATE-BEST-PRACTICES.md) • zh • [hi](DEPENDENCY-UPDATE-BEST-PRACTICES.hi.md) • [ru](DEPENDENCY-UPDATE-BEST-PRACTICES.ru.md))

本文档描述如何把一个仓库中所有语言的全部依赖升级到最新版本，以及如何让它们持续保持最新。`fix <repository-url> --update-all-dependencies` 生成的每个 issue，以及 `solve`、`hive` 和 Telegram 机器人注入的 `--update-all-dependencies` 提示词，引用的都是本文档，因此下面的实践正是 AI 求解器被要求遵循的实践。

## 为什么依赖更新对 AI 开发很重要

陈旧的依赖树带来的代价远不止人人都在谈论的安全公告：

1. **模型基于过时的 API 工作。** AI 求解器按照它所发现的已安装版本来写代码。四年不动的版本锁定意味着四年的变通方案，而当前版本早已让它们变得多余。
2. **手写代码不断堆积。** 成熟仓库里几乎每一个「小工具函数」的存在，都是因为依赖在*当时*没有这个功能。而现在通常已经有了。
3. **安全公告在沉默中累积。** `dependency-review-action` 只检查 pull request *改动过*的依赖。一个针对一年前锁定的包发布的公告，对它而言永远不可见（参见[审计你真正发布的依赖树](#9-审计你真正发布的依赖树)）。
4. **落后会变得无法修复。** 落后六个大版本并不等于落后一个大版本的六倍工作量；迁移指南默认你是从上一个版本升级过来的。

一次性、有意识地把所有依赖都更新掉，比一直不更新直到被迫更新要便宜得多。

## 「所有依赖」的含义

「所有」是字面意义。凡是构建过程从仓库之外获取的东西，都是依赖：

| 类别               | 示例                                                                          |
| ------------------ | ----------------------------------------------------------------------------- |
| 运行时依赖         | `dependencies`、`[dependencies]`、`require`、`install_requires`               |
| 开发依赖           | 测试运行器、linter、格式化工具、类型检查器、构建插件                          |
| 锁文件中的传递依赖 | `package-lock.json`、`Cargo.lock`、`uv.lock`、`composer.lock`、`Gemfile.lock` |
| 基础镜像           | 每个 `Dockerfile`、`docker-compose.yml`、`devcontainer.json` 中的每个 `FROM`  |
| CI/CD action       | `.github/workflows/*.yml` 和组合式 `action.yml` 中的每个 `uses:`              |
| 工具链与语言版本   | `engines`、`rust-version`、`go` 指令、`TargetFramework`、`.nvmrc`             |
| 基础设施模块       | Terraform 模块与 provider、Helm chart 依赖、git 子模块                        |
| pre-commit 钩子    | `.pre-commit-config.yaml` 中的 revision                                       |

只要仓库里某处写下了版本号，它就在本次工作的范围内。

## 各生态系统的更新命令

大多数包管理器的默认命令刻意停留在清单文件中**已有的**约束范围内，因此永远不会跨越大版本。右侧一列才是真正重写约束的命令。每条命令都对照该工具自身的文档做过核实，引用出处收录在 [`docs/case-studies/issue-2184/data/ecosystem-update-commands.json`](./case-studies/issue-2184/data/ecosystem-update-commands.json)。

| 生态系统              | 停留在约束范围内                 | 升级到最新版本并跨越大版本                                                        |
| --------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| JavaScript/TypeScript | `npm update`                     | `npx npm-check-updates -u && npm install`                                         |
| Python                | `pip install -U`                 | `uv lock --upgrade` • `pip-compile --upgrade` • `poetry update`                   |
| Rust                  | `cargo update`                   | `cargo upgrade --incompatible && cargo update`（cargo-edit）                      |
| Go                    | —                                | `go get -u ./... && go mod tidy`                                                  |
| C#/.NET               | `dotnet list package --outdated` | `dotnet outdated -u`（dotnet-outdated）                                           |
| Java/Kotlin/Scala     | `./gradlew dependencyUpdates`    | `mvn versions:use-latest-releases versions:update-properties`                     |
| PHP                   | `composer update`                | 先 `composer require vendor/pkg:^X`，再 `composer update --with-all-dependencies` |
| Ruby                  | `bundle update`                  | 提高 Gemfile 约束后执行 `bundle update --all`                                     |
| Elixir/Erlang         | `mix deps.update --all`          | 修改 `mix.exs`，再执行 `mix deps.update --all`                                    |
| Dart/Flutter          | `dart pub upgrade`               | `dart pub upgrade --major-versions`                                               |
| Swift                 | `swift package update`           | 修改 `Package.swift` 中的版本要求，再执行 `swift package update`                  |
| Haskell               | `cabal outdated`                 | `cabal update` • `stack upgrade --resolver latest`                                |
| GitHub Actions        | —                                | 把每个 `uses:` 升到最新发布版本（tag 或固定的 digest）                            |
| Docker                | —                                | 升级每个 `FROM` 的 tag 并重新固定 digest                                          |
| 基础设施              | —                                | `terraform init -upgrade` • `helm dependency update` • `pre-commit autoupdate`    |

这张表里藏着三个陷阱：

- **`npm update` 从不跨越大版本。** 它只在 `package.json` 的 `^`/`~` 范围内解析。只有 `npm-check-updates -u` 会重写范围本身；`--target latest` 是它的默认行为。
- **`cargo update --breaking` 仅限 nightly**（`-Z unstable-options`）。在稳定版上跨越大版本要用 `cargo-edit` 的 `cargo upgrade --incompatible`。
- **Maven 把版本写在 `<properties>` 里。** 只跑 `versions:use-latest-releases` 会把所有由属性锁定的版本留在原地——请在同一次调用中一并执行 `versions:update-properties`。

## 关键原则

### 1. 动手之前先列出表格

对每个生态系统，列出每个依赖当前锁定的版本和今天已发布的版本，**版本号要从注册表解析得到，而不是凭记忆写出**。模型的训练数据有截止日期，注册表没有。可以使用 `npm view <pkg> version`、`cargo search`、`pip index versions`、`gh release list` 或对应生态系统的等价命令。

这张表让结果变得可评审：读者一眼就能看出什么变了、什么没变、什么被跳过了。

### 2. 任何被保留的旧版本都需要写明理由

停留在旧版本的依赖是一个决定，而决定要被记录下来——上游 bug 及其链接、已放弃的平台、付费层级、尚未跟进的 peer 依赖。沉默和疏忽无法区分，下一个人会花一个小时重新把它弄明白。

### 3. 有意识地跨越大版本

对每一次大版本升级：阅读 changelog 和迁移指南，把代码适配到新 API，并删除旧版本所需要的兼容垫片。

**为了让大版本「通过」而放宽约束或跳过测试，不算更新。** 需要警惕的两个反模式：

```diff
- "some-lib": "^3.0.0"
+ "some-lib": "*"          # 不是更新：用范围掩盖问题
```

```diff
- it('serialises nested nodes', () => { ... })
+ it.skip('serialises nested nodes', () => { ... })   # 不是更新：删掉了信号
```

### 4. 用上新特性，删掉手写的替代实现

这是回报最高、也最常被跳过的原则。当新版本提供了仓库中手工实现的东西时，请删除本地实现，改用上游特性。具体来说：

- 库现在已导出的本地 `deepMerge`/`retry`/`debounce` 工具函数，
- 新运行时基线已提供的平台 API 的 polyfill，
- 框架现已覆盖的自定义 CLI 解析器，
- 客户端库已原生具备的自制缓存。

**更新之后，重复的代码和逻辑应当比更新之前更少。** 如果 diff 里只有版本号在变，说明更新没有做完。

### 5. 让约束诚实

- **提高下界**：不要让下界比实际安装的版本落后好几年。锁文件里是 `4.2`，而下界写着 `>=1.0`，意味着 CI 和全新安装测试的根本不是同一棵依赖树。
- **去掉排除当前版本的上界。** 在 `4` 是最新版时写下的 `<5`，是一个谁也没有真正决定过的限制。
- **重新生成并提交所有锁文件。** 清单已更新而锁文件陈旧的仓库，其 CI 结果与使用者的安装结果并不一致。

### 6. 整个仓库中一个依赖只有一个版本

如果同一个依赖被锁定在多个地方——同一协议的多个语言实现、一个 `Dockerfile`、一个 workflow、一段文档示例——请把所有锁定统一到同一个版本。把一个库锁定在四个不同版本的仓库，有四种不同的行为，而只测试了其中一种。

### 7. 更新的不只是包，还有工具链

语言版本本身就是依赖：

- `engines.node` / `.nvmrc` / `actions/setup-node@v5` 的 `node-version`
- `Cargo.toml` 中的 `rust-version` 和 `edition`
- `go.mod` 中的 `go` 指令
- `*.csproj` 中的 `TargetFramework` 以及 `global.json`
- `maven.compiler.source`/`target`、Gradle wrapper 版本
- `pyproject.toml` 中的 `requires-python`

测试 SDK 或断言库的大版本通常与工具链一起变动，因此请在同一次更新中一并处理。

### 8. CI 全绿，且不引入新的弃用警告

更新之后，运行**每一个**生态系统的完整构建、测试和 lint 流程——不只是你最后改动的那一个——并让 CI 变绿。然后处理本次更新引入的弃用警告。今天留下的警告，就是下次更新时挡路的破坏性变更。

### 9. 审计你真正发布的依赖树

更新之后，检查最终依赖树的安全公告：

```bash
npm audit --package-lock-only --audit-level=high   # JavaScript/TypeScript
cargo audit                                        # Rust
pip-audit                                          # Python
bundle audit                                       # Ruby
dotnet list package --vulnerable                   # C#/.NET
govulncheck ./...                                  # Go
```

`--package-lock-only` 很重要：它审计的是**已提交的**锁文件，因此结果就是使用者会得到的结果，无法靠只发生在这台 runner 上的版本解析把它变绿。请把等价的任务放到定时计划中运行，因为只有定时运行才能发现在代码停止变动之后才发布的公告。相关的 workflow 任务写法参见 [CI/CD 最佳实践](./CI-CD-BEST-PRACTICES.zh.md)。

### 10. 把阻塞问题反馈给上游

当更新被某个依赖的 bug 阻塞时，请到该项目的 GitHub 上提 issue，附带可复现示例、这里采用的变通方案，以及以代码形式给出的修复建议——然后在工作中链接这份反馈，而不是悄悄把版本退回去。带链接的版本锁定是一个被跟踪的决定；没有链接的版本锁定是永久的。

## 如何自动保持最新

更新一次就停下来，一年后会得到同样的积压。请配置一个自动更新工具，让下一次版本落后以 pull request 的形式出现，而不是变成又一个 issue。

### Dependabot

Dependabot 接受 33 个 `package-ecosystem` 取值，覆盖上表中除 Haskell 之外的全部生态系统。**每个生态系统、每个目录**都需要一条 `updates:` 条目——一个包含三个 `package.json` 的 monorepo 需要三条 `npm` 条目。

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      all-dependencies:
        patterns: ['*']
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: docker
    directory: /
    schedule:
      interval: weekly
```

其中两项设置起了大部分作用：

- **`groups`** 把原本几十个单依赖 pull request 合并成一个，从而把 CI 成本和评审成本都控制在可接受范围内。
- **`open-pull-requests-limit`**（默认 5）在达到上限后会静默停止开新的 pull request——如果 Dependabot 看起来不动了，通常就是这个原因。

请注意，Dependabot 本身不会完成原则 3 和原则 4 描述的工作：它只升级版本号，仅此而已。它能防止小的版本落后不断累积，但不会迁移 API，也不会删除兼容垫片。

### Renovate

[Renovate](https://github.com/renovatebot/renovate) 支持更广泛的包管理器，并且可以自托管。它的 `rangeStrategy: bump` 和分组预设与上面的配置作用相同；请只选择其中一个工具并把它配置好，而不要同时运行两个。

## 自动化的依赖更新

以上这些都不必手动完成。`fix` 命令把整个流程自动化，就像 `fix --ci-cd` 对流水线所做的那样：

```bash
fix https://github.com/owner/repo --update-all-dependencies
```

该命令会：

1. **检测仓库使用的语言**，通过 GitHub Linguist API（`GET /repos/{owner}/{repo}/languages`），按每种语言的字节数排序。
2. **列出默认分支的文件树**（`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1`），找出所有已提交的清单文件和锁文件，并跳过 `node_modules/`、`vendor/`、`.venv/`、`target/` 等 vendored 目录。
3. **把两种信号映射到包生态系统。** 任何一种信号单独使用都是错的：Linguist 会漏掉没有自身源代码的生态系统（GitHub Actions、Docker、Terraform），而清单文件会漏掉清单不常见或根本没有清单的语言。
4. **创建一个维护 issue**，其中列出每个检测到的生态系统、找到的清单文件、需要重新生成的锁文件、该生态系统中能跨越大版本的命令、Dependabot 配置提示，以及依据上述原则构建的标准提示词。该 issue 以 **Task** 类型创建，并带上 `dependencies` 标签。
5. **把 issue 交给 `/solve --development-log --deep-analysis --auto-merge --update-all-dependencies`**，由它迭代直到更新被合并。凡是 `fix` 自己不消费的选项（例如 `--tool`、`--model`、`--think`）都会转发给 `/solve`。

使用 `--dry-run` 可以预览 issue 而不实际创建，使用 `--no-solve` 可以只创建 issue 而不启动 `/solve`：

```bash
fix owner/repo --update-all-dependencies --dry-run
fix owner/repo --update-all-dependencies --no-solve
```

### 为什么 issue 是 Task 类型，以及省略了什么

`/solve --deep-analysis` **只对 Bug 类型的 issue** 输出根因分析和调试输出方面的指导，而依赖升级并没有需要查找的根因。把 issue 创建为 `Task` 会选中该提示词的非 bug 变体——调研、需求覆盖、方案规划——这才是这里真正有用的部分。issue 类型按组织配置，标签按仓库配置，因此如果目标仓库两者都不接受，issue 仍会被创建，只是不带这些属性。

`--deep-analysis` 同时也提供了[原则 10](#10-把阻塞问题反馈给上游) 中向上游反馈的指导，因此 `fix` 会从 issue 正文中省略该段落，避免重复下发。其余段落均无条件包含。

## `--update-all-dependencies` 选项

同一段提示词在每个运行求解器的命令中都可以作为选项使用，默认关闭：

```bash
solve https://github.com/owner/repo/issues/123 --update-all-dependencies
hive https://github.com/owner/repo --update-all-dependencies
```

在 Telegram 机器人中，`/solve`、`/hive`、`/fix` 和 `/task` 都以相同形式接受该标志。

启用后，会在求解器的系统提示词中追加一个依赖更新章节，因此 issue 所要求的工作会**连同**把全部依赖升级到最新一起完成，而不是叠加在一棵陈旧的依赖树之上。它默认关闭，是因为把一次未被请求的依赖迁移塞进一个无关的 bug 修复里，会让 pull request 无法评审——当更新本身就是你想要的一部分时再打开它，或者当更新就是全部目的时直接使用 `fix --update-all-dependencies`。

支持 `--tool claude`、`--tool codex`、`--tool opencode`、`--tool agent`、`--tool qwen` 和 `--tool gemini`。

## 参考资料

- [CI/CD 最佳实践](./CI-CD-BEST-PRACTICES.zh.md)
- [配置参考](./CONFIGURATION.zh.md)
- [案例研究：issue #2184](./case-studies/issue-2184/README.md)
- [Dependabot 选项参考](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)
- [npm-check-updates](https://github.com/raineorshine/npm-check-updates)
- [cargo-edit](https://github.com/killercup/cargo-edit)
- [versions-maven-plugin](https://www.mojohaus.org/versions/versions-maven-plugin/index.html)
