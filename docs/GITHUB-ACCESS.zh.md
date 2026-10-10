# 授予 Hive Mind 仓库访问权限 (languages: [en](GITHUB-ACCESS.md) • zh • [hi](GITHUB-ACCESS.hi.md) • [ru](GITHUB-ACCESS.ru.md))

Hive Mind 通过一个普通的 GitHub 账户工作。要处理私有仓库，或在不属于它的仓库中推送分支、创建拉取请求，该账户需要**写入权限**。缺少权限时，Hive Mind 会回复"仓库 '…' 无法访问"（对于账户看不到的私有仓库，GitHub 返回 404），或者提示无法推送。两种消息都会写明需要邀请的账户，并链接到下面的步骤。

示例使用账户 `konard`。请替换为消息中给出的账户：机器人会在回复中写明，在主机上可以用 `gh api user --jq .login` 查看。

## 个人仓库

![邀请 konard 成为个人仓库的协作者](./assets/github-access/personal-konard-zh.svg)

GIF 版本: [personal-konard-zh.gif](./assets/github-access/personal-konard-zh.gif)

1. 打开 `https://github.com/OWNER/REPO/settings/access`（**Settings → Collaborators**）。
2. 点击 **Add people**，搜索该账户并点击 **Add … to REPO**。个人仓库的协作者始终可以推送，因此无需选择角色。
3. 再次运行命令。Hive Mind 会自动接受邀请（`--auto-accept-invite` 默认开启）。否则，请登录该账户并在 `https://github.com/OWNER/REPO/invitations` 接受邀请，或向机器人发送 `/accept_invites`。

GitHub Docs：[邀请协作者加入个人仓库](https://docs.github.com/zh/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository#inviting-a-collaborator-to-a-personal-repository) · [协作者访问权限](https://docs.github.com/zh/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository#collaborator-access-for-a-repository-owned-by-a-personal-account)

## 组织仓库

![以 Write 角色邀请 konard 加入组织仓库](./assets/github-access/organization-konard-zh.svg)

GIF 版本（英文说明）: [organization-konard-en.gif](./assets/github-access/organization-konard-en.gif)

1. 打开 `https://github.com/OWNER/REPO/settings/access`（**Settings → Collaborators and teams**）。
2. 点击 **Add people**，搜索该账户，选择 **Write** 角色并点击 **Add … to REPO**。
3. 按上文所述再次运行命令。

如果该账户已有 **Read** 权限，Hive Mind 能看到仓库但无法推送。请在 **Manage access** 中找到该账户，并将其角色改为 **Write**。

GitHub Docs：[邀请团队或个人](https://docs.github.com/zh/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-teams-and-people-with-access-to-your-repository#inviting-a-team-or-person) · [更改团队或个人的权限](https://docs.github.com/zh/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-teams-and-people-with-access-to-your-repository#changing-permissions-for-a-team-or-person) · [各角色的权限](https://docs.github.com/zh/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization#permissions-for-each-role)

## 为你自己的账户生成动画

上面的动画是为 `konard` 录制的。Hive Mind 主机会为它所使用的账户渲染同样的动画，每种账户、所有者类型和语言的组合只渲染一次，之后复用该文件。Telegram 机器人会随"无法访问"的回复一起发送它。文件保存在 `~/.hive-mind/guides/github-access/`，若设置了 `HIVE_MIND_GUIDES_DIR`，则保存在 `$HIVE_MIND_GUIDES_DIR/github-access/`。渲染使用 [browser-commander](https://github.com/link-foundation/browser-commander) 以及 Hive Mind 镜像自带的 Playwright Chromium。

手动渲染：

```bash
node src/github-access-animation.lib.mjs --login my-bot --locale zh                        # 缓存在 guides 文件夹中
node src/github-access-animation.lib.mjs --login my-bot --locale zh --owner-type Organization --output org-zh.gif
node src/github-access-animation.lib.mjs --login my-bot --locale zh --output personal-zh.svg   # 输出动画 SVG 而不是 GIF
```

动画是 GitHub 深色设置页面的复刻（相同的布局、Primer 配色和 Octicons 图标），由 HTML 绘制而不是截图，因此不会包含任何人的真实仓库。SVG 和 GIF 来自同一场景：SVG 用 CSS 播放它，GIF 是以每秒 10 帧捕获的同一场景。如果主机缺少该语言文字的字体，说明文字会回退为英文。

## 在真实的 GitHub 页面上录制

`scripts/record-github-access-guide.mjs` 在真实的 `github.com` 设置页面上播放同样的光标、高亮和说明文字，并将结果保存为 GIF。它需要一个以仓库管理员身份登录的浏览器会话：Chromium 配置目录（`--user-data-dir`）或 Playwright 存储状态（`--storage-state`）。使用 `--headed` 时可以在窗口中登录或确认密码；当屏幕上出现 **Add people** 时开始录制。

```bash
node scripts/record-github-access-guide.mjs --repo OWNER/REPO --login konard --user-data-dir ~/.config/hm-recorder --headed --output personal-konard-en.gif
node scripts/record-github-access-guide.mjs --repo ORG/REPO --login konard --owner-type Organization --locale zh --user-data-dir ~/.config/hm-recorder
node scripts/record-github-access-guide.mjs --mock --login konard --output mock.gif        # 具有相同控件的本地页面，不访问 GitHub
```

脚本会点击 **Add people**，输入账户并选中它，组织仓库还会选择 **Write** 角色。除非指定 `--send-invite`，它会停在 **Add … to REPO** 而不点击，因此录制不会意外邀请任何人。使用 `--send-invite` 时请用测试仓库和测试账户。如果 GitHub 更改了某个标签，脚本会停止，并给出步骤名称和尝试过的选择器（`scripts/record-github-access-guide.lib.mjs` 中的 `getRecorderSteps`）。

## Hive Mind 可能提到的其他 GitHub 设置

当修复方法是一项 GitHub 设置时，其他消息也会链接 GitHub Docs：

- [允许维护者编辑](https://docs.github.com/zh/pull-requests/how-tos/work-with-forks/allowing-changes-to-a-pull-request-branch-created-from-a-fork#enabling-repository-maintainer-permissions-on-existing-pull-requests)：用于来自复刻的拉取请求
- [管理复刻策略](https://docs.github.com/zh/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-the-forking-policy-for-your-repository)：无法创建复刻时
- [令牌作用域](https://docs.github.com/zh/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps#available-scopes)：`gh` 缺少作用域时（`gh auth refresh -s SCOPE`）
- [速率限制](https://docs.github.com/zh/rest/using-the-rest-api/rate-limits-for-the-rest-api)：GitHub 限制请求时
- [受保护的分支](https://docs.github.com/zh/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) 和 [规则集](https://docs.github.com/zh/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)：推送或合并被拒绝时

如果 GitHub Docs 提供读者所用的语言（en、es、ja、pt、zh、ru、fr、ko、de），链接会以该语言打开，否则以英文打开。
