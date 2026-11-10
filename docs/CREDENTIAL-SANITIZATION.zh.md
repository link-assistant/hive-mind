# 凭证清理

Hive Mind 将生成的终端输出、日志、错误报告、开发日志制品和 GitHub 修改视为可能包含凭证的内容。

此控制措施用于减少凭证通过 Hive Mind 自身输出路径意外泄露的风险。它不能保证自主代理或联网主机的安全：代理仍可能访问数据并通过这些接收点之外的渠道通信。请在隔离环境中使用短期、最小权限凭证，并轮换任何可能已经泄露的凭证。

## 约定

所有维护的接收点都使用 `src/token-sanitization.lib.mjs` 中的清理器。

- 长度超过 12 个字符的值仅保留开头和结尾各三个字符：`abc…xyz`。
- 长度不超过 12 个字符的值替换为 `[REDACTED]`。
- 尽可能保留无关文本和结构上下文。
- 每次出现的凭证都会被清理，包括一行中的多个值。
- 终端 stdout/stderr 使用记录缓冲区，因此跨子进程数据块拆分的凭证不会在完成扫描前输出。
- 凭证的编码副本与明文一样会被清理，且掩码约定在编码之后仍然成立。参见[编码凭证](#编码凭证)。
- GitHub 评论、PR/issue 正文和标题、release、日志上传、gist、开发日志仓库副本和 Sentry 载荷都会在精确的出站边界接受扫描。
- 发布采用故障关闭策略。如果同步核心、Secretlint 或残留扫描失败，外部修改将被阻止并返回 `ERR_CREDENTIAL_SANITIZATION`。
- 临时发布文件和本地审计源仅允许所有者读取（`0600`）；临时上传目录权限为 `0700`。
- `--development-log` 不修改原始本地审计源，只暂存经过清理的副本。

同步核心运行在 [`@link-foundation/sensitive-data-sanitizer`](https://github.com/link-foundation/sensitive-data-sanitizer)（`src/sensitive-data-sanitizer.lib.mjs`）之上，保护终端和本地日志路径。发布边界随后依次运行核心、已知活动 Token 匹配、Secretlint 和残留复扫。危险的本地输出兼容开关无法绕过发布边界。

- 只掩码凭证（`credentialsOnly`）。电子邮件地址、账户和用户 ID 以及 GitHub 登录名保持可读（[#3724](https://github.com/link-assistant/hive-mind/issues/3724)，规则 14）。
- 凭证周围的格式上下文保持可读，只掩码凭证本身：`Authorization` 头的方案词（`Authorization: token ghp…b4N`、`Authorization: CustomScheme f3a…3e5`）、URL 用户名、Cookie 名称、PEM 标记和 Webhook 端点（[#3739](https://github.com/link-assistant/hive-mind/issues/3739)）。
- `Authorization: token $(gh auth token)` 这类 Shell 表达式会保留：它们引用凭证，但不包含凭证。
- 设置 `HIVE_MIND_SANITIZER_DEBUG=1` 可在 stderr 中跟踪清理决策：规则 ID、输入长度、轮次和计数，从不输出匹配的文本。

## 覆盖形式

库规则（供应商格式、Gitleaks 规则集、上下文键）覆盖：

- GitHub、GitLab、OpenAI、Anthropic、AWS、Google/GCP、Azure、Slack、Discord、Telegram、Stripe、Twilio、SendGrid、npm、PyPI、Docker 和常见 CI 凭证格式；
- OAuth 访问/刷新 Token、JWT/JWS Token、Webhook URL、HTTP Authorization 标头以及 Cookie/Set-Cookie 值；
- JSON、YAML、TOML、INI、XML、环境变量/shell 赋值、CLI 参数、敏感查询参数、连接字符串密码和 PEM 私钥；
- 由库收集的本地凭证精确值：凭证环境变量（`knownSecretsFromEnv`）、gh `hosts.yml` 中的每个 Token（`knownSecretsFromGitHubConfig`）以及 `gh auth token`（`knownSecretsFromGitHubAuth`）。`KNOWN_LOCAL_TOKEN_ENV_VARS` 列出始终读取的变量。

外部边界的检测有意采取保守策略。误报可能会遮盖类似凭证的值；扫描器失败时将阻止发布，而不会发送原始字节。

库 0.21.1 负责凭证规则、环境变量选择、格式上下文以及 npm 包名和 Token 计数豁免。适配器延迟加载 `/credentials`。#131–#141 的旧变通方案已删除；剩余七项问题已报告为上游 #148–#154，并在[案例研究](./case-studies/issue-3739/README.md)中逐项记录：掩码文本、折行载荷、构造语法、Markdown、Authorization 方案、编码掩码和私钥类型。Secretlint 和 `containsKnownToken` 仍独立验证发布内容。

## 编码凭证

规则扫描器只匹配交给它的字节，因此仅以编码形式进入日志的凭证会同时对所有基于表层文本的规则不可见。这并非假想的绕过手段：普通工具在毫无隐藏意图的情况下也会不断进行编码，而 issue [#2156](https://github.com/link-assistant/hive-mind/issues/2156) 正是由此导致的泄露——镜像仓库的 Token 端点把收到的凭证以 base64 编码原样放回 JSON 响应体中，该响应被写入日志、被发布，随后由 GitHub 的扫描器撤销。完整分析见[案例研究](./case-studies/issue-2156/README.md)。

库会先解码再匹配（`preserveEncoding`）。针对 [#149](https://github.com/link-foundation/sensitive-data-sanitizer/issues/149)，保留有界的折行 base64 预处理：库检查解码后的凭证，保留原始折行和无凭证图片，只豁免已检查的 256 KiB 以内块中的原生编码发现。更大的未检查块仍采用故障关闭策略。短已知秘密的 hex 已由库原生支持。独立解码器仍用于 Secretlint 和已知 Token 验证：

- 长度受限的 base64、base64url、hex、百分号编码、字节转义和 HTML 实体序列会被解码，明文规则在解码后的文本上运行。
- base64 按三种字节对齐方式读取，因此嵌在大块数据中间的凭证同样能被找到。折行的数据块按连续的纯 base64 行分组扫描，因为常见工具都会折行输出（MIME 为 76 列，PEM 为 64 列），折行后的数据块中不存在可供匹配的单行序列。
- 掩码后的内容会被重新编码，并在替换前验证往返转换。只有解码结果恰好等于预期发布内容的序列才会被替换回去，否则整个序列变为 `[REDACTED]`。这正是 `abc…xyz` 约定能够穿透编码的原因：`{"token":"gho_…"}` 仍是有效的 base64，解码后为 `{"token":"gho…999"}`，因此周围结构和凭证首尾字符依然可读。
- 流式清理器会保留结尾处的纯 base64 行分组，直到出现一行不可能属于该数据块为止。逐行放行会把字节错位的片段交给清理器。数据块*开始*所在的那一行同样会保留一条记录：该行并非纯 base64，因而不属于该分组，一旦单独放行，跨越首个折行处的凭证就会不落在任何一部分中。这不会延迟普通输出，因为判据不是该行末尾 base64 序列的长度，而是它能否解码为文本——URL、提交 SHA 或内容摘要都不能。
- Secretlint 同样在解码后的内容上运行，每个序列单独扫描，并使用 Hive Mind 自己的解码器（`findDecodableRuns`），因此不依赖库的解码。检测器之间的冗余之所以有价值，在于它们的规则词汇不同——Secretlint 认识库规则中没有的格式——但这种冗余只有放在解码器之后才有作用。在事件日志上实测，Secretlint 推荐预设在全部 16.9 MB 中未报告任何发现；参见[库对比](./case-studies/issue-2156/data/library-survey-output.txt)。
- 针对用户提供内容的豁免作用于表层文本，并有意止步于解码器。豁免以需要原样保留的字面片段表示，而编码序列并不包含这些片段，因此调用方的豁免列表无法在该层打开缺口。对编码块过度遮盖的代价是少了一行日志细节；反过来的代价则是一份凭证。

编码内容中的检测结果会在详细清理摘要中单独报告，并附上触发的规则标识符，因此此类事件可以直接从日志中溯源。

## 添加或修改格式

1. 在供应商当前的官方安全或身份验证文档中验证格式。切勿将真实凭证粘贴到 issue、测试、日志或提交中。
2. 仅向 `tests/test-credential-sanitization-2111.mjs` 添加合成示例。根据需要覆盖独立值、结构化赋值、单行多值和跨数据块拆分形式。
3. 先向 [`@link-foundation/sensitive-data-sanitizer`](https://github.com/link-foundation/sensitive-data-sanitizer/issues) 报告缺失的格式。在上游修复之前，在 `src/sensitive-data-sanitizer.lib.mjs` 中添加带 `UPSTREAM` 链接的补充检测器或豁免，并在 `tests/issue-3739-sensitive-data-sanitizer-migration.test.mjs` 中添加一行测试。
4. 运行重点安全测试和默认测试套件：

   ```bash
   node tests/test-credential-sanitization-2111.mjs
   node tests/issue-3739-sensitive-data-sanitizer-migration.test.mjs
   node tests/test-encoded-credential-leak-2156.mjs
   node tests/test-encoded-secretlint-layer-2156.mjs
   node tests/test-require-sanitized-output-rule.mjs
   npm test
   npm run lint
   ```

5. 对于新的出站接收点，请使用 `sanitizeForPublication`、`writeSanitizedPublicationFile` 或已在内部调用它们的辅助函数。添加静态规则测试，证明未清理的等价实现会被拒绝。
6. 在拉取请求中记录来源、测试用例和误报取舍。

至少每季度以及每当提供商宣布身份验证变更时审核一次供应商清单。有用的主要参考资料包括 [GitHub 身份验证概述](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github)、[GitLab Token 指南](https://docs.gitlab.com/security/tokens/)、[AWS IAM 标识符](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html)、[Slack Token 类型](https://api.slack.com/concepts/token-types)、[Stripe API 密钥](https://docs.stripe.com/keys)、[Twilio API 密钥](https://www.twilio.com/docs/iam/api-keys)、[npm 访问 Token](https://docs.npmjs.com/about-access-tokens/)和 [PyPI 机密报告格式](https://docs.pypi.org/api/secrets/)。

## 事件响应

清理并不等于撤销。如果真实凭证进入了终端捕获、仓库、GitHub 对象、上传、遥测事件或其他外部系统：

1. 立即撤销或轮换凭证；
2. 限制对受影响制品的访问；
3. 在平台支持的情况下，从当前内容和保留历史中删除泄露值；
4. 检查提供商审计日志中是否存在滥用；
5. 在恢复发布前，为遗漏的格式或接收点添加合成回归测试。
