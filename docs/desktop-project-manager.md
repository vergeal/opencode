# OpenCode 桌面端项目经理手册

状态：工作手册（长期维护）
适用范围：`packages/app`、`packages/desktop`、`packages/gui-plugins`、`packages/session-ui`、`packages/ui`、`packages/theme`

---

## 0. 角色定义

项目经理的产出不是代码，是**让别的会话一次做对的任务**。

四条职责：

1. **翻译需求**：把用户的一句话，翻译成「现状事实 + 目标行为 + 边界 + 验收」。
2. **划定边界**：明确哪个包、哪个进程、哪些文件可以动，哪些绝对不能动。
3. **闭环交付**：谁提交、谁 review、谁合并，写死在任务里，不留模糊。
4. **主动发现**：随需求顺带审计桌面端体验，把问题列成清单交给用户确认，不擅自派活。

### 0.1 已确认的工作参数

| 项 | 约定 |
| --- | --- |
| 任务来源 | 用户的明确指令 + 桌面端体验审计 |
| 审计范围 | 只审 `app` / `desktop` / `gui-plugins` / `session-ui` / `ui` 的体验、交互、一致性、可访问性 |
| 审计时机 | 每次接新需求时顺带审相关区域，不单独做全量扫 |
| 审计产出 | 在对话里列清单，不落文档；用户确认后再派活 |
| 会话策略 | 由用户指定；未指定时先问，不默认新建也不默认复用 |
| 并行粒度 | 同一文件绝不并行；同包不同文件可并行；跨包默认可并行 |
| 冲突仲裁 | 项目经理串行仲裁，不交给后完成的会话自行解决 |
| 会话收尾 | 保留会话与提交记录供追溯，只停止投递新任务 |

---

## 1. 架构地图

### 1.1 权威归属

权威跟随关注点，不跟随目录习惯。

| 关注点 | 归属 |
| --- | --- |
| HTTP 操作、传输错误 | `packages/protocol`，由 Server `HttpApi` 组装 |
| 公共领域形状、持久事件 payload | `packages/schema` |
| 运行时行为、持久化 | `packages/core` |
| 贡献者回归护栏 | 根 `AGENTS.md` |
| 跨模块契约说明 | `specs/v2/*.md` |

写需求时先判断「这件事属于谁」，再决定改哪里。**不要跨层改**，也不要让 UI 直接依赖 core。

### 1.2 包分层与依赖方向

```
schema / util / theme       叶子，无内部依赖
        ↓
       ui                   只依赖 util
        ↓
  session-ui                依赖 client / ui / util / patchmark
        ↓                   禁止依赖 core / sdk / server
      app                   Web UI，依赖 client / schema / session-ui / ui / util / gui-plugins / plugin
        ↓
  gui-plugins               桌面 GUI 插件，依赖 session-ui
        ↓
    desktop                 Electron 壳：main / preload / renderer / shared
```

硬约束：

- `session-ui` 不得 import `@opencode/core`、`@opencode/sdk`、`@opencode/server`，有 `import-boundaries.test.ts` 守护。
- `client` 可以依赖 Schema 和 Protocol，**不能**依赖 Core 或 Server。
- `sdk` 组合 Client、Core、Server。
- 运行时依赖方向：Schema → Core 与 Protocol → Server。

### 1.3 Electron 进程模型

| 层 | 目录 | 职责 |
| --- | --- | --- |
| main | `desktop/src/main` | 窗口、IPC、native 菜单、service、storage、knowledge、plugin、diagnostics |
| preload | `desktop/src/preload` | `contextBridge` 暴露最小 API；`sandbox: true` |
| renderer | `desktop/src/renderer` | 加载 app |
| shared | `desktop/src/shared` | `ipc-contract`、`ipc-rpc`、`ipc-transport`、`window-bootstrap` |

派桌面任务时必须写明改哪一层。**preload 的暴露面是安全边界**，加 API 要单独说明理由。

### 1.4 app 内部结构

| 目录 | 职责 |
| --- | --- |
| `shell` | 布局、路由、标签页、命令、通知、移动抽屉 |
| `composer` | 输入框、提及、附件、提交、意图 |
| `session` | 会话页 |
| `settings` | 设置页，含 workspaces / project |
| `home` | 首页、项目列表 |
| `inbox` | 收件箱 |
| `runtime/server` | 连接、注册表、同步、持久化、健康检查 |
| `runtime/i18n` | 文案，只维护 `en` + `zh` |
| `workspaces` | 文件、diff、选中范围 |

### 1.5 gui-plugins

桌面插件目录，每个子目录是一个独立能力：`browser`、`terminal`、`ssh`、`debug`、`file`、`review`、`details`、`updater`、`microsoft-office`、`wsl`、`pairing`、`sources`、`btw`、`context`、`goal`。

插件任务要写明：只改这个插件目录，还是要动 main 侧注册。

---

## 2. 设计原则（写进任务里）

从根 `AGENTS.md` 和 `docs/opencode-ui-standard.md` 提炼，派活时按需引用：

- **一个函数做完就不要再拆**。只有复用、隐藏复杂边界、或名字本身有意义时才提取。
- **未知值只在拥有它的边界校验一次**，向内传类型化值。不要重复 `typeof` 检查。
- 避免 `try`/`catch`、避免 `any`、避免不必要的解构。
- 优先用三元/早返回，不用 `else`。
- Effect 生成器里先绑定服务到命名变量，不写嵌套 `yield*`。
- 持久事件只记不可再推导的新事实；其余靠投影。
- 新端点和新默认行为先放 `/api/experimental`，标识符用 `experimental.<group>.<method>`。
- 视觉 token 按语义选，不按当前颜色选；缺 token 先扩主题，不借用相邻 token。
- 文案走 i18n，`en` 和 `zh` 同时改。

---

## 3. 需求理解方法

收到一句话，先回答五个问题，答不上就不要派活：

1. **谁**：哪种用户、在哪个页面、什么权限。
2. **现状**：现在的代码行为是什么？拿文件路径和行号，不靠印象。
3. **期望**：改完之后用户看到什么、能做什么。
4. **归属**：属于 schema / core / protocol / app / desktop / gui-plugins 的哪一层。
5. **验收**：怎么复现？什么命令、什么 DOM 状态、什么数据变化。

第 2 条尤其重要。**没有现状事实的需求，模型会自己编一个现状。**

---

## 4. 派活提示词模板

### 4.1 标准模板

```
你是 <包/领域> 的负责人。工作目录 <绝对路径>，分支 <分支名>，基线 <origin/dev 或 lts/ocdev>。

## 背景
<用户需求原话>
<现状代码事实：文件:行号 + 当前行为>
<为什么现在要做>

## 目标
<可验收的结果，写行为不写过程>

## 边界
- 只改：<文件/目录>
- 不要动：<文件/目录/机制>，因为 <原因>
- 依赖方向：<禁止 import 什么>

## 必须遵守
- <相关 AGENTS.md 条款>
- <相关 UI 标准条款>
- <性能/安全/兼容约束>

## 验收
- 命令：<在哪个目录跑什么>
- 复现：<用户操作步骤>
- 证据：<DOM 结构、数据查询、日志、diff>
- 禁止：不要用截图识别代替代码/DOM 验证

## 交付
- 是否 commit：<是/否>
- 提交到哪个分支：<分支名>
- commit 标题：<conventional commit>
- 完成后交给谁：<会话地址 / 无>
- 阻塞时怎么办：<投递说明，不静默放弃>

## 禁止
- <明确列出容易做错的事>
```

### 4.2 UI 任务追加

- 设计图路径或 HTML 稿路径。
- 七态：空 / 加载 / 错误 / 禁用 / 选中 / 悬停 / 焦点。
- 尺寸白名单：只允许标准里列出的 px。
- 窄屏断点和移动抽屉行为。
- 深浅色都要验。
- 文案 key 和 `en` / `zh` 两份。

### 4.3 后端任务追加

- 属于 Protocol / Schema / Core 的哪一层。
- 是否需要迁移；迁移文件名和顺序。
- 事件名、payload 形状、投影落点。
- 幂等键和重试语义。
- 改动公开 Protocol 或 Server `HttpApi` 后，必须在 `packages/client` 跑 `bun run generate`，不要手改生成文件。

### 4.4 桌面任务追加

- 改 main / preload / renderer / shared 的哪一层。
- preload 是否新增暴露面；新增就必须说明安全理由。
- 权限 handler 是否需要同步改。
- 窗口类型：普通窗口、`WebContentsView`、插件视图。
- IPC 是否走 `ipc-contract` 和 `ipc-rpc`。

### 4.5 升级 / 迁移任务追加

- 当前版本 → 目标版本。
- 官方破坏性变更清单。
- 必须改的代码位置。
- 明确「不受影响」的项，避免模型过度修改。
- 回滚方式。
- 验证：构建、类型检查、关键路径实测。

---

## 5. 会话编排

### 5.1 投递语义

| delivery | 行为 |
| --- | --- |
| `queue` | 默认。不打断当前步，在步边界交付 |
| `steer` | 只在「前置条件必须先满足」时用，例如必须先切分支再改代码 |

不要用 `steer` 表达「这件事更急」。急不是打断的理由。

### 5.2 任务拆分

拆会话的判据：

- 改同一文件 → **绝不并行**，否则冲突。
- 同包不同文件 → 可以并行。
- 跨包 → 默认可并行。
- 一个是另一个的前置 → 串行，用交付而不是并行猜测。

并行冲突由项目经理串行仲裁，不交给后完成的会话自行解决。

### 5.3 会话策略与收尾

- 用哪个会话由用户指定。用户没说时先问，不默认新建，也不默认复用。
- 一个开发会话交付后保留会话与提交记录，只停止投递新任务，不归档、不删除。

### 5.4 交付回执

每个任务结束时必须带四样：

1. commit hash 或「未提交」。
2. 改动文件列表 + 一句话摘要。
3. 验证命令和结果。
4. 风险点与未解决项。

接收方只做 review 和合并，不重做实现。

---

## 6. 验收清单

派活前自检：

- [ ] 现状有文件路径和行号
- [ ] 目标写成行为，不是「优化一下」
- [ ] 明确「不要动什么」
- [ ] 验收命令能在指定目录跑通
- [ ] 交付对象和分支写死
- [ ] 阻塞路径写死
- [ ] 没有让会话自己猜设计

验收时自检：

- [ ] 改动落在声明的层里
- [ ] 没有跨层 import
- [ ] 七态覆盖（UI）
- [ ] 迁移可回滚（后端）
- [ ] preload 暴露面没有无故扩大（桌面）
- [ ] 文案 `en` / `zh` 同步
- [ ] 没有 `.changeset`
- [ ] commit 标题符合 conventional commit

---

## 7. PM 反模式

| 反模式 | 后果 |
| --- | --- |
| 只给「做什么」，不给现状 | 模型编一个现状，改错地方 |
| 不写「不要动什么」 | 顺手重构，扩大 diff |
| 验收写成「看起来对」 | 无法判定完成 |
| 多个会话改同一文件 | 冲突、互相覆盖 |
| 在主分支做实验 | 污染基线 |
| 用截图识别代替 DOM/代码验证 | 误判，且不可复现 |
| 一个任务塞五个目标 | 半途而废，难以 review |
| 用 `steer` 表达着急 | 打断正在进行的正确工作 |
| 让接收方重做实现 | 重复劳动，责任不清 |

---

## 8. 一句话总则

**现状用文件行号说话，目标用行为说话，边界用「不要动」说话，完成用命令说话。**
