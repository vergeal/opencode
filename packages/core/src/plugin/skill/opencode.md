# OpenCode 使用指南

把本指南作为处理 OpenCode 自身相关工作的起点。它涵盖配置和定制 OpenCode、用插件扩展它，以及用 OpenCode SDK、客户端和 API 构建集成所需的核心概念。

完整文档见 <https://opencode.ai/v2/docs/>。本概览只是核心概念的索引。在回答下面某个主题的问题之前，先抓取该小节给出的 URL，并以完整页面作为真相来源。问题需要更多细节时，跟随该页面上的链接。需要发现相关文档页面时，先抓取 <https://opencode.ai/v2/docs/>。

机器可读的文档索引见 <https://opencode.ai/v2/llms.txt>。

## 版本策略

始终按 OpenCode V2 回答，除非用户明确询问 V1、旧版 OpenCode，或从 V1 迁移。

V2 只以 <https://opencode.ai/v2/docs/> 文档作为真相来源。不要使用记录 V1 的 <https://opencode.ai/docs/>；当 V2 文档或链接页面已覆盖某个 V2 文档问题时，不要用通用网络搜索来解决。<https://opencode.ai/config.json> 提供的 schema 同时接受 V2 字段和已废弃的 V1 字段。绝不要推荐它标记为已废弃的字段。如果 V2 文档缺失或自相矛盾，说明不确定或请求澄清，而不是退回到 V1。

只有当用户明确询问 V1，或需要作为迁移输入时，才可以查阅 V1 文档和语法。输出和建议仍必须使用 V2，除非用户特别要求 V1 结果。

## [CLI](https://opencode.ai/v2/docs/cli)

关于终端界面、命令行调用、`run`、`mini`、终端 provider 或其他 CLI 行为的问题，抓取 [CLI 指南](https://opencode.ai/v2/docs/cli) 以及该小节链接的相关页面。

CLI 和 TUI 的偏好设置与 OpenCode 的服务器和项目配置是分开的。它们位于全局 `~/.config/opencode/cli.json`，或在设置了 `XDG_CONFIG_HOME` 时位于 `$XDG_CONFIG_HOME/opencode/cli.json`。没有项目本地的 CLI 配置。设置 `OPENCODE_CLI_CONFIG_CONTENT` 可以把内联 JSON 合并到全局设置之上。大多数偏好也可以在 TUI 中按 `Ctrl+P` 并选择 **Open settings** 来更改。

### [设置](https://opencode.ai/v2/docs/cli/config)

编辑 `cli.json` 之前，先抓取完整的 [CLI 设置参考](https://opencode.ai/v2/docs/cli/config)。它记录了所有仅限终端的设置、可接受的值和示例，包括主题、输入、会话、标签页、diff、提醒、Mini、快捷键、终端插件和调试。不要把这些设置放进 `opencode.json(c)`。

### [快捷键](https://opencode.ai/v2/docs/cli/keybinds)

在 `cli.json` 的 `keybinds` 下配置快捷键。leader 键是 `keybinds.leader` 条目；leader 的时序在 `leader.timeout` 下单独配置。绑定可以使用字符串、字符串数组，或在需要 `preventDefault` 等事件行为时使用对象。用 `"none"` 或 `false` 禁用某个绑定。

绝不要猜测命令 ID、默认绑定或可接受的按键语法。在回答或编辑绑定之前，抓取完整的 [快捷键参考](https://opencode.ai/v2/docs/cli/keybinds)，其中列出了当前的 ID 和默认值。

## [OpenCode 配置](https://opencode.ai/v2/docs/config)

OpenCode 的服务器和项目配置使用 JSON 或 JSONC。包含已发布的 schema，以便用户的编辑器能校验字段并提供自动补全：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
}
```

全局配置位于 `~/.config/opencode/opencode.json(c)`，对该用户的每个项目生效。项目配置可以放在任何目录，文件名为 `opencode.json(c)` 或 `.opencode/opencode.json(c)`，包括 monorepo 中嵌套的包。

在常规的项目发现过程中，OpenCode 会搜索当前 Location 目录及其所有祖先目录直到文件系统根目录，包括检测到的项目或仓库根目录之上的目录。它按从最远祖先到当前目录的顺序合并直接的 `opencode.json(c)` 文件，然后对 `.opencode/opencode.json(c)` 文件做同样的事。这意味着每个被发现的 `.opencode` 配置都会覆盖每个被发现的直接配置。全局文件系统配置的优先级低于这些被发现的文档。

常见的配置字段包括 `model`、`default_agent`、`permissions`、`agents`、`commands`、`plugins`、`providers`、`mcp`、`skills`、`instructions`、`references`、`formatter` 和 `lsp`。

这个配置与 `cli.json` 不同。终端偏好（尤其是主题和快捷键）请使用 [CLI 设置参考](https://opencode.ai/v2/docs/cli/config)。

配置改动无需重启即可生效。OpenCode 会监视配置文件，并在保存后重新加载 agent、命令、技能、MCP 服务器和插件。TUI 对 `cli.json` 也是如此。要强制完整重载，使用 `/reload`。不要告诉用户编辑配置后重启 OpenCode。

不要猜测字段名或结构。抓取 V2 配置指南及其链接的主题指南作为真相来源，并在编辑现有文件时保留无关设置。在配置示例中保留已发布的 `$schema` URL，但不要为了确定 V2 配置结构而去抓取它。

查看 [完整配置指南](https://opencode.ai/v2/docs/config)，了解所有字段、示例、配置位置以及各功能专属指南的链接。

## [MCP 服务器](https://opencode.ai/v2/docs/mcp-servers)

在 `mcp.servers` 下配置 MCP 服务器。优先使用 CLI，因为它会保留无关配置。当用户要求为自己设置服务而不局限于当前项目时，使用 `--global`；当他们明确想要项目本地配置时，则省略它。

```sh
opencode mcp add <name> --global --url <remote-url>
opencode mcp list
```

远程服务器默认使用 OAuth。如果 `mcp list` 报告某个服务器需要认证，告诉用户运行 `/mcps`、选择该服务器并登录。不要通过 shell 工具运行 `opencode mcp auth`：它会启动一个交互流程，其授权链接可能被隐藏在后台进程输出中。改用面向用户的 MCP 界面。

在连接状态确认已连接之前，把该服务器报告为已配置但等待登录。

OAuth 凭据存储在 OpenCode 配置之外。当服务器支持 OAuth 时，不要索取或存储 API key。只有当 OAuth 不可用或用户明确需要时，才使用基于头部的凭据，并使用 `{env:MCP_API_KEY}` 这样的环境变量替换，而不是把密钥写入配置。

## [从 V1 迁移到 V2](https://opencode.ai/v2/docs/migrate-v1)

对于任何把 OpenCode 配置、agent、命令、技能、插件、集成或其他行为从 V1 迁移到 V2 的请求，在行动之前阅读完整的[迁移指南](https://opencode.ai/v2/docs/migrate-v1)。在仓库中，其源码是 `services/www/src/docs/content/migrate-v1.mdx`。

V1 配置文件和 `.opencode/` 定义有意保持兼容。唯一有意的破坏性变更是服务器 API 和插件 API。原生 V2 配置使用更符合人体工学的结构，但转换是可选的。当用户请求转换时，检查完整配置，保留行为与无关设置，只应用指南中相关的迁移。对于插件迁移，同时抓取并遵循迁移指南和完整的[插件指南](https://opencode.ai/v2/docs/build/plugins)。如果非 API 的 V1 功能在 V2 中失败，使用 `report` 技能把它作为兼容性缺陷提交。

## [插件](https://opencode.ai/v2/docs/build/plugins)

关于创建、配置、加载、发布或迁移插件的问题，在回答之前抓取完整的[插件指南](https://opencode.ai/v2/docs/build/plugins)。当用户想构建插件时参考本指南。它涵盖 hook、transform、工具、插件上下文能力以及包入口。插件也可以扩展 TUI；对于这些，抓取 [CLI 插件指南](https://opencode.ai/v2/docs/build/plugins/cli)。对于与其他插件或客户端共享的自定义方法和事件，抓取 [RPC 指南](https://opencode.ai/v2/docs/build/plugins/rpc)。

## [服务](https://opencode.ai/v2/docs/troubleshooting#check-the-background-service)

OpenCode 使用客户端-服务器架构。TUI 等界面连接到一个后台 OpenCode 服务，该服务拥有会话、配置、插件、权限和工具执行。

OpenCode 通常会自动发现或启动共享的后台服务。只有它卡住或不健康时才重启，不要为了应用配置改动而重启：

```sh
opencode service restart
```

重启后检查其状态：

```sh
opencode service status
```

## [API](https://opencode.ai/v2/docs/api)

OpenCode 从服务器暴露一个 HTTP API。该 API 由运行中的服务器在 `/openapi.json` 提供的 OpenAPI 文档描述。

本地请求使用 OpenCode 内置的 `api` 命令。它使用与 TUI 相同的发现和认证流程，在没有兼容的健康服务时可能启动后台服务。它接受 HTTP 方法和路径，或一个 OpenAPI 操作 ID。

用 HTTP 方法和路径调用端点：

```sh
opencode api get /api/info
```

用 `--data` 或 `-d` 传递请求体，用 `--header` 或 `-H` 传递额外的头部：

```sh
opencode api post /api/example --data '{"key":"value"}'
opencode api get /api/example --header 'X-Example:value'
```

请求体默认使用 `Content-Type: application/json`。当 OpenCode 连接到显式服务器而不是其托管的后台服务时，使用相同的已配置服务器和认证上下文，而不是另外构造一个未认证的请求。

查看[完整 API 参考](https://opencode.ai/v2/docs/api)，了解可用的端点、参数、请求体和响应 schema。原始的 [OpenAPI 规范](https://opencode.ai/v2/openapi.json)也可用于代码生成和其他工具。

## [客户端](https://opencode.ai/v2/docs/build/client)

关于通过网络把应用连接到 OpenCode 的问题，在回答之前抓取完整的[客户端指南](https://opencode.ai/v2/docs/build/client)。

`@opencode/client` 是 OpenCode HTTP API 的生成式 TypeScript 客户端。它的方法和类型来自与 API 参考相同的契约。默认入口暴露基于 Promise 的资源客户端和用于流式端点的异步可迭代对象。`@opencode/client/effect` 入口暴露带类型的 Effect、Stream 和解码后的 OpenCode schema 值。它的 `Service` API 可以从 Node 应用发现、启动、停止本地后台服务并与之认证。

## [SDK](https://opencode.ai/v2/docs/build/sdk)

关于把 OpenCode 直接嵌入应用的问题，在回答之前抓取完整的 [SDK 指南](https://opencode.ai/v2/docs/build/sdk)。SDK 在应用中托管 OpenCode，而不打开 HTTP 监听器。

Effect 应用请使用 [Effect SDK 指南](https://opencode.ai/v2/docs/build/sdk/effect)。Cloudflare Durable Objects 请使用 [Cloudflare SDK 指南](https://opencode.ai/v2/docs/build/sdk/cloudflare)。

## [故障排查](https://opencode.ai/v2/docs/troubleshooting)

OpenCode 运行一个客户端和一个后台服务器。先确定问题属于客户端、共享服务器还是某个项目。

- 用 `opencode service status` 检查服务，并用 `opencode api get /api/info` 验证 API。
- 与 `opencode --standalone` 对比，后者用私有服务器运行 TUI，可用来隔离共享服务的问题。
- 检查 `~/.local/share/opencode/log/opencode.log`。用 `role=cli` 过滤客户端启动，用 `role=server` 过滤会话、provider、插件、权限和工具。
- 正常日志不足时，用 `OPENCODE_LOG_LEVEL=DEBUG` 运行一次复现。
- 诊断问题时不要删除或编辑数据库、服务注册或服务配置。用外部工具检查持久数据之前先备份。
- 在分享诊断信息之前，涂掉 API key、授权头、提示词、文件内容和其他敏感数据。

查看[完整故障排查指南](https://opencode.ai/v2/docs/troubleshooting)，了解服务生命周期命令、API 检查、日志位置、显式服务器连接、问题报告细节以及本地开发路径。
