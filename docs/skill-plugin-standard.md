# 技能与插件加载规范

本文件定义 OpenCode 如何发现并加载技能（Skill）与插件（Plugin），以及在本仓库内编写它们时必须遵守的约定。

- 适用范围：`packages/core`（加载器）、`packages/schema`（数据结构）、`packages/plugin`（入口解析）、`.opencode/**` 与用户全局配置目录下的技能、插件。
- 唯一事实来源是代码，本文件描述的是代码当前的加载契约。行为变更时必须同步修改本文。
- 术语：**配置目录**指项目里向上查找到的 `.opencode/`，或全局的 `~/.config/opencode/`（macOS 受管环境还可能是系统目录）。

---

## 一、技能（Skill）

### 1.1 发现源

| 来源         | 位置                                                            | 加载者                          |
| ------------ | --------------------------------------------------------------- | ------------------------------- |
| 项目配置目录 | `<project>/.opencode/skill/`、`<project>/.opencode/skills/`     | `opencode.config.skill`         |
| 全局配置目录 | `~/.config/opencode/skill/`、`~/.config/opencode/skills/`       | `opencode.config.skill`         |
| 配置字段     | `opencode.json(c)` 的 `skills`，每项是路径或 `https?://` URL    | `opencode.config.skill`         |
| Claude 兼容  | `<project>/.claude/skills/`、`~/.claude/skills/`                | `opencode.config.compatibility` |
| Agents 兼容  | `<project>/.agents/skills/`、`~/.agents/skills/`                | `opencode.config.compatibility` |
| 内置         | 虚拟路径 `skill://opencode/SKILL.md`、`skill://report/SKILL.md` | `opencode.skill`                |

- `skill/` 与 `skills/` 两个目录名都会被扫描，二者等价。
- `skills` 配置项支持两种写法：数组 `["路径或 URL", ...]`，或对象 `{ "paths": [...], "urls": [...] }`。
- `skills` 配置项支持 `~/` 展开；相对路径相对当前工作目录；`http(s)` 链接会被拉取后当作目录源。
- 所有来源解析成 `Skill.Info` 后按 `id` 合并，后加载的同名技能覆盖先加载的。

### 1.2 目录形态

推荐形态是一技能一目录：

```
.opencode/
  skills/
    review-checklist/
      SKILL.md
      references/
        style.md
```

被识别为技能的三种形态：

1. `<root>/skills/<id>/SKILL.md` —— 推荐。
2. `<root>/skills/SKILL.md` —— 根目录技能，`id` 取扫描根的目录名。
3. `<root>/skills/<id>.md` —— 扫描根这一层的单文件技能，`id` 取文件名（去掉 `.md`）。

扫描规则（`SkillScan.scan`）：

- 逐层向下，最多 6 层。
- 某个目录里一旦存在 `SKILL.md`，只收它，并且不再深入该目录。
- 扫描根这一层额外收集所有 `.md` 文件（上面的形态 3）。
- 跳过 `.` 开头的文件与目录、`FSUtil.ignoreGlobs` 命中的路径，以及依赖目录等忽略目录。
- 符号链接会先解析到真实文件或目录再判断。

`id` 规则（`SkillFile.parse`）：

- 扫描根这一层的 `<name>.md`（且文件名不是 `SKILL.md`）→ `id` = 文件名。
- 其余情况 → `id` = `SKILL.md` 所在目录名。

因此**目录名就是技能 id**，必须稳定、唯一。

### 1.3 SKILL.md 格式

```md
---
name: 代码评审清单
description: 当用户要求评审改动、或提交前自查时使用。
metadata:
  opencode/autoinvoke: true
---

# 代码评审清单

正文……
```

frontmatter 使用 YAML（经 `gray-matter` 解析，兼容未加引号的值里含冒号的老写法）。支持的字段：

| 字段                           | 必填 | 类型    | 说明                                                             |
| ------------------------------ | ---- | ------- | ---------------------------------------------------------------- |
| `name`                         | 否   | string  | 显示名。省略时等于 `id`。可以包含中文。                          |
| `description`                  | 否   | string  | 何时使用该技能。**省略则该技能不会出现在模型的可用技能列表里**。 |
| `metadata.opencode/autoinvoke` | 否   | boolean | 是否允许模型自动调用。优先级最高。                               |
| `disable-model-invocation`     | 否   | boolean | 与上一条同义，兼容其他 agent 的写法。                            |

布尔值接受 `true/false`、`yes/no`、`on/off`、`1/0`（不区分大小写、允许前后空格）。

可见性规则（`SkillInstructions.load`）：

- 有 `description` 且 `autoinvoke !== false` → 写入系统提示词的 `<available_skills>`，模型可以主动调用。
- 没有 `description`，或 `autoinvoke === false` → **不**出现在提示词里，只能被显式引用（例如用户点名）并在权限允许时使用。
- 权限层也可以通过 `skill` 权限规则 `deny` 掉某个 id。

### 1.4 附件文件与相对路径

- 技能被加载时，`SKILL.md` 所在目录内除 `SKILL.md` 之外的文件会被采样（最多 10 个）列给模型。
- 正文里的相对路径以技能目录为基准，不要写死绝对路径。
- 大段参考资料放 `references/`，脚本放 `scripts/`，按需引用。

### 1.5 刷新

- 加载器监视技能目录；编辑器保存后的连续事件会防抖 100ms 再整源重扫。
- 配置文件变化（`config.updated`）会重新计算来源并重扫。
- 重扫后经 `Skill` 服务发布 `skill.updated`，可用技能列表随之更新。

### 1.6 编写约定

- 一个技能一个目录，目录名用短横线小写英文；`name` 用面向用户的语言书写。
- `description` 写成「何时使用」，不要复述正文。
- 正文是完整的 Markdown，标题从 `#` 开始，不依赖外层上下文。
- 需要模型自动使用的技能必须有 `description` 且不要设 `autoinvoke: false`。

---

## 二、插件（Plugin）

### 2.1 发现源

| 来源         | 位置                                                                 |
| ------------ | -------------------------------------------------------------------- |
| 项目配置目录 | `<project>/.opencode/plugin/`、`<project>/.opencode/plugins/`        |
| 全局配置目录 | `~/.config/opencode/plugin/`、`~/.config/opencode/plugins/`          |
| 配置字段     | `opencode.json(c)` 的 `plugins: (string \| { package, options? })[]` |

- `plugin/` 与 `plugins/` 两个目录名都会被扫描，二者等价。
- 顺序：先自动发现目录内的条目，再应用 `plugins` 配置；因此配置可以用 `-name` 移除自动发现到的插件。

### 2.2 目录形态

目录里的每个条目只要满足以下之一就会被当作插件：

1. `.ts` 或 `.js` 文件（单文件插件）。
2. 一个目录（按 2.3 解析入口）。
3. 指向上述文件或目录的符号链接。

### 2.3 入口解析（`Host.resolve`）

**有 `package.json` 且同时有 `name` 与 `exports`**：按包的 `exports` 子路径解析。

| 角色        | 子路径                 |
| ----------- | ---------------------- |
| 服务端      | `./server`，回退到 `.` |
| TUI         | `./tui`                |
| RPC         | `./rpc`                |
| GUI（桌面） | `./gui-experimental`   |

**没有 `exports`（或没有 `package.json`）**：按目录根的约定文件名解析。

| 角色        | 约定文件                                        |
| ----------- | ----------------------------------------------- |
| 服务端      | `server.*` 或 `index.*`                         |
| TUI         | `tui.*`                                         |
| RPC         | `rpc.*`                                         |
| GUI（桌面） | `gui-experimental.cjs` 或 `gui-experimental.js` |

约束：

- 目录形态必须至少解析出一个入口（`server` 或 `gui`），否则被忽略。
- 入口文件必须解析到插件目录内部；越界会被忽略。
- GUI 入口必须是 CommonJS（`.cjs`/`.js`），应用按 CJS 文本求值；TypeScript 源文件和 ESM 不能作为 GUI 入口。
- 服务端入口通过 `Plugin.define({ id, effect })` 注册，`id` 全局唯一；只有 GUI 部分时，插件 id 取 `package.json` 的 `name`，没有则取目录名。

### 2.4 配置写法

```jsonc
{
  "plugins": [
    // 已发布包，按包名解析
    "@scope/some-plugin",
    // 带选项
    { "package": "@scope/other-plugin", "options": { "mode": "strict" } },
    // 本地目录，相对当前配置文件
    "./scripts/local-plugin",
    // 绝对路径
    "file:///Users/me/plugins/my-plugin",
    // 移除自动发现到的同名插件
    "-@scope/some-plugin",
  ],
}
```

- 本地路径：`./`、`../` 相对配置文件所在目录；绝对路径与 `file://` 按原样解析；`~/` 会被展开。
- 绝对路径必须指向**目录**；指向文件会记录警告并忽略。
- 包名形式从模块解析结果加载，不做目录内越界检查。

### 2.5 编写约定

- 一个插件一个包/目录，`package.json` 至少声明 `name`；需要多入口时用 `exports` 声明 `./server` 等子路径。
- 服务端入口只做注册与声明，不在模块顶层执行 I/O。
- 插件 id 与包名保持稳定，便于配置里的 `-name` 与权限规则引用。

### 2.6 插件是能力组合包

**定义：插件 = 工具链 + 技能的组合包。** 插件不是「一个入口文件」或「一段可执行代码」，而是向 opencode 大脑登记能力的一份清单。模型是唯一调度者：插件之间不直接互调，各自把自己的工具、命令、MCP 服务器和技能注册上来，由模型在会话里组合使用。

#### 能力类型

| 能力       | 注册方式                            | 说明                                     |
| ---------- | ----------------------------------- | ---------------------------------------- |
| 工具       | `ctx.tool.transform`                | 模型可调用的动作，例如 `webwright.click`。  |
| 命令       | `ctx.command.transform`             | 斜杠命令。                               |
| MCP 服务器 | `ctx.mcp.transform` / `ctx.mcp.add` | 外部进程（含 Python server）或远程服务。 |
| 技能       | `ctx.skill.transform`               | 教模型何时、如何使用这些工具的说明。     |
| RPC        | `ctx.rpc.register`                  | 插件对外暴露的接口。                     |
| GUI        | 包的 `./gui-experimental` 入口      | 桌面端窗口内运行的界面部分。             |
| TUI        | 包的 `./tui` 入口                   | 终端界面部分。                           |

运行形态（`Plugin.Features`：`server` / `tui` / `rpc` / `gui`）回答的是「这个包怎么跑」，不是「这个包有什么」。能力清单回答后者，两者不要混用。

#### 内部插件

内置插件指 `packages/plugin-*` 下由 `packages/core/src/plugin/internal.ts` 的 `pre` / `post` 数组直接加载的插件，不走用户配置，也不出现在 npm 目录里。

内部插件默认**不**出现在探索页。要让用户看见它、并能查看它带了哪些能力，在 `Plugin.define` 里声明 `display`：

```ts
import { Plugin } from "@opencode/plugin/effect"

export default Plugin.define({
  id: "opencode.example",
  display: {
    name: "面向用户的名称",
    description: "面向用户的说明，不写包名与内部术语。",
    category: "automation",
    skills: [{ id: "example", name: "……", description: "……" }],
    tools: ["example.*"],
  },
  effect: (ctx) =>
    Effect.gen(function* () {
      // 注册工具与技能
    }),
})
```

产品能力不要为此新增内置插件：浏览器能力现在就是一个 `.ocplugin`（第三章），`display` 由包内 `ocplugin.json` 派生，安装与否都与 Core 解耦。

规则：

- `display.name` / `display.description` 是用户看到的文案，必须是面向用户的语言，不要写包名和内部术语。
- `display.skills` 必须与插件实际通过 `skill.transform` 注册的技能一致；`display.tools` 写工具名前缀或完整名。
- 只有**产品级**内部插件才声明 `display`。负责系统装配的内置插件（模型、权限、MCP 配置等）保持不声明，避免探索页被内部实现淹没。
- 没有 `display` 的插件在探索页的「已安装」里不出现，但仍然参与插件加载。
- 外部 npm 插件同样可以声明 `display`；它和内部插件走同一条 `Plugin.Info.display` 通道。

`Plugin.Info` 因此长这样：

```ts
{
  id?: string
  source: { type: "builtin" } | { type: "package", target, version? } | { type: "local", path } | { type: "sdk" }
  features: { server?, tui?, rpc?, gui? }
  state: { status: "active" } | { status: "failed", error, ref? }
  display?: { name, description, category?, skills?, tools? }
}
```

#### 安装语义

用户点「安装」时，客户端只做一件事：把包名写进全局配置的 `plugins` 字段。之后服务端自动完成：

1. 配置写入触发 `config.updated`；
2. `ConfigPluginSource` 重扫插件来源；
3. npm 安装包；
4. 插件加载，执行入口里的 `tool.transform` / `skill.transform` / `mcp.transform`；
5. `plugin.updated` 与 `skill.updated` 推送，探索页刷新。

`.ocplugin` 是例外：它不写 `plugins`，而是解包到 `plugins/<id>/` 由目录自动发现生效，见 3.7。

技能注册必须绑定在插件的 activation scope 上（`ctx.skill.transform` 天然如此），插件卸载或重载时自动移除。插件加载失败时不得留下任何能力注册。

#### 多语言与外部形态的边界

| 形态         | 推荐接入方式                                                                        | 是否插件入口 |
| ------------ | ----------------------------------------------------------------------------------- | ------------ |
| JS/TS 插件   | `./server` 入口，注册工具/命令/MCP/技能                                             | 是           |
| Python 脚本  | 做成 MCP local server（`command: ["python", "..."]`），或作为包内资源由 JS 工具调用 | 否，需要包装 |
| Chrome 扩展  | 由插件通过本地 WebSocket / CDP 桥接触达扩展；扩展本身不是插件入口                   | 否，需要包装 |
| 内部插件协同 | 各自注册能力，由模型编排；不做插件间直接 import 或调用                              | 是           |

不要为 Python 或浏览器扩展新造一等插件运行时。它们的生命周期、权限和沙箱模型与现有插件不同，包装成工具或 MCP server 成本最低，也不会破坏现有架构。

#### 组合包红线

- 技能 id 全局唯一。多个插件注册同一个 id 时，后注册的覆盖先注册的，插件作者应给技能 id 加稳定前缀。
- 插件包里的 `skills/` 目录**当前不会被自动发现**，必须由入口调用 `skill.transform` 注册；`display.skills` 只是展示，不代表自动加载。
- 插件不得在模块顶层执行 I/O；所有注册与副作用放在 `effect` / `setup` 里。
- `display` 是展示契约，不是权限或加载契约。隐藏它不会禁用插件，声明它也不会额外加载任何东西。

#### 现有案例

- `packages/plugin-browser`：桌面浏览器插件，通过 CDP/proxy 控制浏览器，作为内置插件编译进 Core，注册 `browser.*` 工具与 `browser` 技能。
- `packages/plugins/webwright`（`opencode.webwright`）：独立的 `.ocplugin` 组合包，用 Playwright 驱动专用浏览器（默认系统 Chrome + 专属 profile），注册 `webwright.*` 工具与 `webwright` 技能；Playwright 驱动作为包内资源放在 `assets/playwright-core`，不随 Core 编译。

---

## 三、插件组合包（`.ocplugin`）

**Status: 规范已定义，实现进行中。** 本章是组合包格式与安装契约的权威定义；标注「待实现」的条目尚未落到代码。

### 3.1 定位

`.ocplugin` 是一个**单文件、离线可安装、自包含**的插件组合包：

- 一个文件就是完整插件：入口、技能、图标、资源全在里面，不依赖 npm 下载，不执行安装脚本。
- 解包后就是一个**标准插件目录**，第二节的入口解析、`display`、`skills` 注册规则全部照常适用。宿主因此不需要新的插件运行时。
- 与内部插件（`packages/plugin-*`，编译进 Core）的区别只有分发方式：`.ocplugin` 是可移动的独立产物，安装不改 `plugins` 配置，删除即卸载。

### 3.2 容器格式

| 项       | 规定                                                                    |
| -------- | ----------------------------------------------------------------------- |
| 容器     | tar                                                                     |
| 压缩     | gzip                                                                    |
| 扩展名   | `.ocplugin`                                                             |
| 打包/解包 | `Bun.Archive`（运行时原生，零额外依赖）                                  |
| 路径字符 | UTF-8，统一用 `/` 分隔，不得以 `/` 开头                                  |
| 禁止项   | 绝对路径、`..`、符号链接、设备与管道文件、`node_modules/`、安装脚本字段 |

选择 tar+gzip 的理由：解包端不需要外部二进制或 WASM，macOS/Windows 默认都能用系统工具检查包内容；7z 压缩率略高但要求随包携带 7z 或引入 wasm，且解包安全策略会脱离宿主控制。确实需要更小体积时改用 brotli（Node 内置），仍不引入新依赖。

打包必须**可重复**：文件按路径排序，归档内 mtime 固定（例如 `0`），保证同样的输入产出逐字节相同的文件与 sha256。

- 读取/解包用 `Bun.Archive`。写入不要用 `Bun.Archive.write`：它会用写入时刻作为条目 mtime，破坏可重复性。`packages/plugins/webwright/script/pack.ts` 直接写 ustar 头（mtime 固定为 0）并 `Bun.gzipSync` 压缩，同样的 `dist/` 连续打包两次得到相同 sha256。

### 3.3 包内布局

```
ocplugin.json            # 唯一声明文件，见 3.4
package.json             # name = 插件 id，exports 指向下面各入口
server/index.js          # 服务端入口（必要：server 或 gui 至少一个）
tui/index.js             # 可选
rpc/index.js             # 可选
gui-experimental.cjs     # 可选，必须是 CommonJS
skills/<id>/SKILL.md     # 可选，一个技能一个目录，目录名即技能 id
assets/**                # 可选，插件自有资源（如浏览器扩展目录）
README.md                # 可选
```

- 入口文件必须是**构建产物**：ESM、已在打包阶段 bundle，不含 TypeScript 源码。
- `assets/` 不参与入口解析，插件在运行时用 `import.meta.url` 相对定位。无法安全 bundle 的运行时依赖整包放在这里，例如 `assets/playwright-core/`：Playwright 的 driver 按自身包目录解析文件，内联进 `server/index.js` 会破坏查找，因此它以完整包的形式随包分发，入口动态加载它。这类依赖**不是** `externals`——`externals` 只列宿主提供的模块。
- 包内**不得**出现 `node_modules/`；命中宿主模块的依赖走 `externals`，其余见上一条与 3.5。

### 3.4 `ocplugin.json`

```jsonc
{
  "apiVersion": 1,
  "id": "opencode.webwright",
  "version": "2.2.5",
  "requires": { "opencode": "^2.2.5" },
  "entry": { "server": "server/index.js" },
  "externals": ["effect", "@opencode/plugin", "@opencode/schema", "@opencode/util"],
  "display": {
    "name": "Webwright",
    "description": "让 AI 直接操作浏览器……",
    "category": "automation",
    "icon": "<svg viewBox=\"0 0 24 24\">…</svg>",
    "tools": ["webwright.*"]
  },
  "skills": [
    {
      "id": "webwright",
      "name": "Webwright",
      "description": "用 webwright.* 工具操作专用浏览器……",
      "path": "skills/webwright/SKILL.md"
    }
  ],
  "assets": ["assets/playwright-core"]
}
```

| 字段               | 必填 | 说明                                                                                         |
| ------------------ | ---- | -------------------------------------------------------------------------------------------- |
| `apiVersion`       | 是   | 组合包规范版本。未知版本拒绝安装，提示升级 OpenCode。                                        |
| `id`               | 是   | 插件 id，必须与入口 `Plugin.define({ id })` 完全一致。点分命名，作为安装目录名与 `-id` 键。   |
| `version`          | 是   | semver。同 id 安装新版本即覆盖升级。                                                         |
| `requires.opencode` | 否  | semver range；不满足时拒绝安装并给出所需版本。                                               |
| `entry`            | 是   | 入口相对路径，至少一个；文件必须存在且位于包内。                                             |
| `externals`        | 否   | 由宿主提供的模块，不得打进包内，见 3.5。                                                     |
| `display`          | 否   | 展示元数据，字段与 `Plugin.Display` 相同（`name`、`description`、`category`、`icon`、`skills`、`tools`）。 |
| `skills`           | 否   | 包内技能清单，`path` 必须指向包内 `SKILL.md`。                                                |
| `assets`           | 否   | 随包资源目录，仅供插件自身读取。                                                             |
| `files`            | 否   | `[{ "path": "...", "sha256": "..." }]` 完整性清单，不含 `ocplugin.json` 自身。               |

规则：

- **`display` 是展示的唯一事实源。** 入口应从 `ocplugin.json` 派生 `Plugin.define` 的 `display`，不要在代码里再写一份文案或图标，避免安装前后显示不一致。
- `display.icon` 是**内联 SVG 源码字符串**，约定 24×24 视口。禁止 `<script>`、`<foreignObject>`、事件属性（`on*`）、外部 `href`/`url(...)` 引用；品牌色可以用固定值。客户端把它转成 data URI 用 `<img>` 渲染，不注入 HTML、不执行脚本。
- `display.skills` 与 `skills` 必须一致；`display` 只是展示，真正的技能注册仍由入口调用 `ctx.skill.transform` 完成（见 2.6 红线）。
- 缺少 `display` 的组合包可以安装，但不出现在探索页，只按配置与目录规则加载。

### 3.5 依赖与宿主模块

插件在宿主进程内运行，必须与宿主共享**同一份** `effect` 与 `@opencode/*` 模块实例：

- `Context.Service`、`Schema` 品牌、Layer 依赖都靠模块单例识别。若插件把 `effect` 打进自己的 bundle，插件里的 `Service` 与宿主的不是同一个 tag，注册会静默失效。
- 因此这些模块必须列进 `externals`，构建时 `--external`，**不**打进包内。
- 包内也不放 `node_modules/`。安装器负责让 `externals` 可解析：在 `<插件目录>/node_modules/` 下生成**纯文件 shim**（不依赖符号链接权限），内容指向宿主实际入口：

  ```json
  // <插件目录>/node_modules/@opencode/plugin/package.json
  { "name": "@opencode/plugin", "exports": "./index.js" }
  ```

  ```js
  // <插件目录>/node_modules/@opencode/plugin/index.js
  export * from "file:///…/node_modules/@opencode/plugin/dist/index.js"
  ```

  宿主在自己的进程里能解析到这些模块，安装器因此可以复制它实际加载的那份入口 URL，保证版本一致。

- 除 `externals` 之外的所有依赖（工具库、协议实现等）必须在构建阶段打进 `server/index.js`；无法安全 bundle 的依赖整包放进 `assets/`（见 3.3），入口用动态加载读取。
- 安装器不执行 `npm install`、`postinstall` 或包内任意脚本。

### 3.6 构建与打包（作者侧）

建议在包内提供两个脚本：

1. `build`：`bun build <入口> --target=bun --format=esm --outfile dist/server/index.js`，`--external` 取 `ocplugin.json` 的 `externals` 与 `node:*`；原样拷贝 `skills/`、`assets/`、`README.md`、`package.json`、`ocplugin.json` 到 `dist/`。
2. `pack`：读取 `dist/`，按 3.2 生成可重复的 tar+gzip 到 `dist/plugins/<id>-<version>.ocplugin`；如声明 `files`，先算 sha256 再写入。

产物即分发单元，不再走 npm 发布，也不进 `packages/*/dist/npm`。

### 3.7 安装与卸载（宿主契约）

安装位置：配置目录下的 `plugins/`（全局即 `~/.config/opencode/plugins/<id>/`）。该目录已在自动发现范围内，因此：

- **安装 = 解包到插件目录**，不写 `plugins` 配置。
- **卸载 = 删除目录**；临时禁用可在配置里写 `-opencode.webwright`（见 2.1 顺序规则）。

安装步骤（原子、可回滚）：

1. 读取归档，校验 `apiVersion`、`id`、`version`、`requires.opencode`、`entry` 是否存在且位于包内。
2. 拒绝路径穿越、绝对路径、符号链接、超大文件；校验 `files` 中的 sha256（若声明）。
3. 解包到同级的临时目录 `.<id>.tmp-<random>`。
4. 按 3.5 生成 `externals` shim。
5. 用 `Host.resolve` 确认至少解析出一个入口；失败则删除临时目录并报错。
6. 原子替换目标目录（先 `rename` 旧目录到备份，再 `rename` 新目录到位，最后删除备份）。
7. 触发插件来源重扫（目录已存在即可被 `ConfigPluginSource` 发现），随后 `plugin.updated` / `skill.updated` 推送。

失败时不得留下半成品目录，也不得改动已有版本的可用状态。

### 3.8 展示与发现

- **未安装**：探索页读 `ocplugin.json` 即可展示名称、描述、图标、技能清单与工具前缀，不需要加载代码，也不需要联网。官方内置目录以构建时收录的 manifest 为数据源。
- **已安装**：以 `plugin.list` 返回的 `display` 为准；两者不一致说明包内 manifest 与入口派生逻辑有漂移，应在插件侧修复。
- 图标缺失或非法时回退到通用插件图标，不阻塞安装与加载。

### 3.9 版本、兼容与安全

- `apiVersion` 与 `requires.opencode` 不满足：拒绝安装，并在错误里给出当前宿主版本。
- v1 只做 sha256 完整性校验，不签名；安装器仍需把包内容当作不可信输入。
- 安全边界以「不执行包内代码」为前提：校验与解包阶段不 import 任何包内模块，只做文件操作与 JSON 解析。
- 将来支持签名时，在 `ocplugin.json` 增加签名段，`apiVersion` 递增；旧宿主必须拒绝未知版本，而不是忽略。

---

## 五、校验与排错

- 列出已注册技能：服务端 `GET /skill`（协议组 `skill`，返回当前注册的技能）。
- 技能日志：
  - `skill source loaded`（debug）：某个来源解析出了哪些 id。
  - `skills rescanned`（info）：文件变化触发的重扫。
  - `skill file skipped`（debug）：`reason: "markdown"` 表示文件不是合法 Markdown，`reason: "frontmatter"` 会带出 YAML 解码问题。
- 插件日志：插件激活失败会记录在 `plugin` 服务；本地路径不是目录会打印 `configured plugin path must be a directory`。
- 修改技能或插件后通常会热更新；配置类改动以 `config.updated` 事件为准。

---

## 六、当前缺口

- 没有 CLI 子命令用于校验技能/插件目录或列出已加载插件，只能看服务端接口与日志。
- `.ocplugin` 的安装器（校验、解包、`externals` shim、原子替换）尚未实现，见 3.7；因此组合包目前只能由作者在本地手工解包。
- 插件包内的 `skills/` 目录不会被自动发现；组合包里的技能必须由入口代码注册，`display.skills` 只是展示。
- 安装前看不到 npm 插件的能力清单：包未安装时读不到它的 `skills/` 或 `display`，探索页的「发现」仍依赖客户端静态目录。`.ocplugin` 通过包内 `ocplugin.json` 解决了这一点（3.8），但要等安装器与探索页接线。
- `AGENTS.md` 的测试小节与 `docs/opencode-ui-standard.md` 仍引用已删除的 `.opencode/skills/*`，与本文描述的实际发现规则不一致。

## 七、事实来源

- `packages/core/src/config/plugin/skill.ts`：技能来源与热更新。
- `packages/core/src/config/plugin/skill-file.ts`：frontmatter 解析与 id 规则。
- `packages/core/src/config/plugin/skill-scan.ts`：目录扫描规则。
- `packages/core/src/config/plugin/compatibility.ts`：`.claude`/`.agents` 兼容目录。
- `packages/core/src/skill/instructions.ts`：可用技能列表与 `autoinvoke` 语义。
- `packages/core/src/config/plugin/source.ts`：插件发现与配置解析。
- `packages/core/src/plugin/source-directory.ts`：`plugin/`、`plugins/` 目录扫描。
- `packages/core/src/plugin/internal.ts`：内置插件列表。
- `packages/core/src/plugin/module.ts`：插件加载、入口解析后的能力与 `display` 透传。
- `packages/core/src/plugin.ts`：`Plugin.Info` 快照与激活 scope。
- `packages/plugin/src/host.ts`：插件入口解析与 id 规则。
- `packages/plugin/src/effect/plugin.ts`：Effect 插件 Context 与 `display` 声明。
- `packages/plugins/webwright/ocplugin.json`：组合包声明与内联图标，`packages/plugins/webwright/src/skill.ts` 演示从 manifest 与 `SKILL.md` 加载技能，`script/pack.ts` 演示可重复打包。
- `packages/schema/src/config.ts`：`skills`、`plugins` 字段定义。
- `packages/schema/src/plugin.ts`：`Plugin.Info` 与 `Plugin.Display` 契约。
