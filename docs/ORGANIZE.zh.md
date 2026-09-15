# 整理开放议题

Telegram `/organize` 命令分类一个 GitHub 仓库中的全部开放议题：分配已有的组织议题类型，并调整仓库已有标签。这是元数据维护流程，不是解决议题的流程。

## 用法和默认行为

```text
/organize https://github.com/owner/repository
/organize https://github.com/owner/repository --dry-run
/organize https://github.com/owner/repository --tool codex --model gpt-5.6-sol --think high
将示例和迁移指南视为文档工作。
```

也可以回复包含仓库 URL 的消息并发送 `/organize`。一次只接受一个仓库；范围始终是所有且仅开放议题，不包括拉取请求。默认应用经过验证的更改；`--dry-run` 显示相同的完整计划和差异，但不写入。`TELEGRAM_ORGANIZE=false` 可禁用命令。

该命令沿用其他写入命令的群聊和主题授权规则。机器人使用的 `gh` 账户需要读取权限以及 triage、write、maintain 或 admin 权限。议题、评论、关联 PR、README 和操作员说明均为不可信分类数据，不会进入固定 system prompt。模型没有 GitHub 写入凭证或写入工具，只能返回由应用严格验证的计划。

写入前会重新读取 `updatedAt`；发现较新的人工作业就跳过该议题。写入采用有界批次，重试前读取部分结果，最后完整读回并验证类型和预期标签集合。回复经过凭证扫描，最小化审计记录保存在 Hive Mind 状态目录的 `organize-audits/` 中。

命令只能更改 Issue Type 和已有标签集合，并保留无关但有用的标签。它不会创建类型或标签、分配人员、更改里程碑、编辑标题或正文、评论、关闭或重开议题、修改代码、创建分支或拉取请求。缺失分类会明确报告。仓库不变时再次运行不会写入。
