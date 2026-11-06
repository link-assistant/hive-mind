# 地理位置隐私

Claude、Codex、Agent、OpenCode、Gemini 和 Qwen 默认关闭位置共享。
此设置适用于 `solve`、`hive` 工作进程、`review`、任务拆分以及可选的
agent-commander 执行适配器。

```bash
solve https://github.com/owner/repo/issues/123
solve https://github.com/owner/repo/issues/123 --share-geolocation
hive https://github.com/owner/repo --share-geolocation
review https://github.com/owner/repo/pull/456 --share-geolocation
task https://github.com/owner/repo/issues/123 --split --split-count 2 --share-geolocation
```

默认运行会收到系统指令，避免探测、推断或披露用户或主机的位置。
指令涵盖 IP 定位服务、GPS 和浏览器位置权限、时区或地区探测，以及搜索或
模型请求中的位置提示，并要求将此偏好传递给子代理和浏览器/MCP 工具。
任务中明确提供的地点仍可作为任务内容使用；提及某个城市并不授权探测用户所在城市。

子工具使用 `TZ=UTC`，以消除自动生成的本地时区上下文。
Codex 还会在每次调用时收到配置覆盖，将四个可选搜索位置字段替换为空字符串。
这样可以清除继承的国家、地区、城市和时区提示，同时保留搜索可用性、域名过滤器和搜索上下文大小。
Codex 仍会序列化带有空位置字符串的 `user_location` 对象，其中不含用户或主机的位置。
仅使用空 TOML 表无法清除继承值，因为 Codex 会合并表。

`--share-geolocation` 在本次运行中解除这些位置限制。系统指令随后允许在任务需要时
使用位置，并要求采用所需的最低精度。工具会继承操作者的时区和原生位置配置。
Hive 参数转发和 solve 会话恢复会保留此选择。
`--no-share-geolocation` 明确选择默认的隐私模式。
全局工具配置和主机时区均不会被修改。

这些默认设置减少客户端的位置披露，但不是操作系统权限边界或匿名服务。
模型和搜索提供商仍能看到网络连接的 IP 地址，并可据此或根据任务内容推断位置。
提示词无法强制约束任意外部插件、恶意指令或独立启动的程序。
现有的网络、浏览器权限和提供商隐私控制仍然适用。
启用位置共享不会授予浏览器权限，也不会配置 GPS。

工具审计、备选方案、来源和可复现的请求捕获实验见
[案例研究](case-studies/issue-4023/README.md)。
