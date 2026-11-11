# 收件箱设计方案

状态：设计稿（未实现）
来源：`/Users/ekko/agents/demo/harness-nav-design.html`
范围：`packages/app`、`packages/schema`、`packages/protocol`、`packages/core`

---

## 1. 现状与差距

### 1.1 已经有的

| 能力 | 位置 | 现状 |
| --- | --- | --- |
| 收件箱路由 | `packages/app/src/shell/routes/routes.tsx:71` | `/inbox` 已挂载 |
| 收件箱页面 | `packages/app/src/inbox/route.tsx` | 有页头、四档筛选、左右分栏，**列表永远是空状态** |
| 文案 | `packages/app/src/runtime/i18n/en.ts:1451` | `inbox.*` 基础文案齐全 |
| 组件故事 | `shell/titlebar/inbox-list.stories.tsx`、`inbox-card.stories.tsx` | 有视觉稿，无数据 |
| 定时任务结果 | `Schedule.Info` | 已有 `lastFiredAt` / `lastOutcome` / `lastOutput` / `runCount` |
| 权限请求 | `permission.asked` / `permission.replied` | 有事件、有 `session.permission.reply` |
| 会话提问（form） | `session.form.list/reply/cancel`、`form.created/replied/cancelled` | 端点与事件齐全 |
| 知识库状态 | `knowledge.list` | 有 `status` / `indexedAt` / `documentCount` |
| 会话失败 | `Session.Info.outcome` | 有 `failed`，`session.updated` 会推送 |

### 1.2 缺的

| 缺口 | 后果 |
| --- | --- |
| 没有统一的收件箱条目模型 | 三个来源三种形状，列表无法混排 |
| 没有聚合层 | 客户端要分别拉 session / schedule / knowledge / permission |
| 没有已读/已处理状态 | 「已完成」筛选没有数据依据 |
| `schedule` 没有事件 | 定时任务跑完，收件箱不知道 |
| `knowledge` 没有事件 | 索引完成，收件箱不知道 |
| 侧栏导航仍是可拖拽的五行 | 设计图要的是「动作 → 目的地 → 内容」三段式 |

### 1.3 两个「收件箱」的关系

| 概念 | 位置 | 语义 |
| --- | --- | --- |
| **会话收件箱（数据源）** | `shell/titlebar/inbox-model.ts` | 按会话状态计算：待批准 / 待提问 / 运行中 / 失败 / 完成 |
| **收件箱页面（统一视图）** | `app/src/inbox/route.tsx` | 把会话、定时任务、知识库的事项汇总成一个列表 |

两者不是二选一。`createSessionInbox` 已经算好了「哪个会话需要人」，收件箱页面**复用它作为会话来源**，再叠加定时任务和知识库。

不再把会话提问和会话失败排除在收件箱之外：凡是需要人处理的事，都进收件箱。侧栏的会话状态点保留，作为快速入口；收件箱是完整的待办视图。

---

## 2. 设计目标

对应设计图的三条：

1. **侧栏三段式**：新建会话（唯一主操作）→ 四个目的地（一行图标开关）→ 会话列表。
2. **收件箱汇聚**：会话提问与失败、定时任务产出与失败、权限请求、知识库结果都在这里，可按「全部 / 待处理 / 失败 / 已完成」筛选。
3. **详情即决策**：选中条目后右侧展示事实、来源、过期时间和可执行动作，不跳页。

---

## 3. 统一条目模型

### 3.1 形状

```ts
type InboxKind = "approval" | "question" | "output" | "failure" | "result"

type InboxItem = {
  key: string                 // `${server}\0${kind}\0${refID}`，稳定去重键
  kind: InboxKind
  status: "pending" | "done" | "failed"
  title: string               // 已本地化的标题，由来源映射
  summary: string             // 一句话事实
  source: {
    type: "schedule" | "knowledge" | "session"
    id: string                // scheduleID / libraryID / sessionID
    name?: string             // 定时任务名、库名
  }
  projectID?: string
  createdAt: number
  expiresAt?: number          // 权限请求的过期时间
  action: InboxAction
}
```

### 3.2 动作

```ts
type InboxAction =
  | { type: "permission"; sessionID: string; requestID: string; decision: "once" | "always" | "reject" }
  | { type: "open-schedule"; scheduleID: string }
  | { type: "open-session"; sessionID: string }
  | { type: "open-knowledge"; libraryID: string }
```

### 3.3 来源映射

| 来源 | 条件 | kind | status |
| --- | --- | --- | --- |
| `permission.asked` 未回复 | 存在待回复请求 | `approval` | `pending` |
| `permission.replied` | 已回复 | `approval` | `done` |
| `form.created` 未回复 | 存在待回复表单 | `question` | `pending` |
| `form.replied` / `form.cancelled` | 已回复或取消 | `question` | `done` |
| `session.outcome === "failed"` | 会话失败 | `failure` | `failed` |
| `schedule.lastOutcome === "failed"` | 最近一次失败 | `failure` | `failed` |
| `schedule.lastOutcome === "expired"` | 过期 | `failure` | `failed` |
| `schedule.lastOutcome === "fired"` 且有 `lastOutput` | 有产出待采纳 | `output` | `pending` |
| `knowledge.status === "failed"` | 索引失败 | `failure` | `failed` |
| `knowledge.status === "ready"` | 索引完成 | `result` | `done` |

### 3.4 明确不进收件箱

只收「需要人做事或拍板」的事项。下面这些不进，避免条目泛滥：

| 情况 | 为什么不进 | 去哪里看 |
| --- | --- | --- |
| 会话正常完成 | 没有待办动作 | 侧栏会话状态点 |
| 会话运行中 | 不是待办 | 侧栏 / Home |
| 定时任务 `fired` 但无产出 | 纯心跳，没有可处理内容 | 定时任务页的运行次数 |
| 定时任务 `checked` / `skipped` / `disabled` | 条件未触发或已跳过 | 定时任务页 |
| 知识库 `indexing` / `empty` | 进行中或没有文档 | 知识库页 |
| 单次工具调用失败 | 已经由会话自身的重试/报错处理 | 会话时间线 |
| 前端运行时错误 | 不属于业务待办 | 控制台 / 诊断 |
| 子会话或后台任务结果 | 结果已回到父会话 | 父会话时间线 |
| 应用更新、账号或凭证异常 | 系统级提示 | 设置 / 更新入口 |

标题与摘要走 i18n 模板，不在数据层拼句子：

```
inbox.item.approval.title   = "Approval needed: {action}"
inbox.item.question.title   = "{name} needs an answer"
inbox.item.output.title     = "{name} produced an output"
inbox.item.failure.title    = "{name} failed"
inbox.item.knowledge.title  = "Knowledge base reindexed"
```

---

## 4. 需要联动的模块

| 模块 | 联动方式 | 改哪里 |
| --- | --- | --- |
| 权限系统 | 读 `permission.request.list`，订阅 `permission.asked/replied`，写 `session.permission.reply` | 复用，不改 core |
| 会话提问（form） | 读 `session.form.list`，订阅 `form.created/replied/cancelled`，写 `session.form.reply` | 复用，不改 core |
| 会话失败 | 读 `Session.Info.outcome`，订阅 `session.updated` | 复用，不改 core |
| 定时任务 | 读 `schedule.list` 的 `lastOutcome/lastOutput`，P0 轮询，P1 加事件 | `packages/core/src/schedule`、`protocol/groups/schedule.ts` |
| 知识库 | 读 `knowledge.list` 的 `status`，P0 轮询，P1 加事件 | `packages/core/src/knowledge`（如有）、`protocol/groups/knowledge.ts` |
| 会话 | 读 `Session.Info.outcome`，订阅 `session.updated` | 复用 |
| 侧栏导航 | 四目的地改一行图标开关，去掉 dnd | `shell/titlebar/sidebar-nav.tsx` |
| 标题栏布局 | 调整顺序：新建会话 → 目的地 → 会话列表 | `shell/titlebar/titlebar.tsx` |
| 命令与快捷键 | 注册 `destination.home/inbox/knowledge/scheduled`，⌘1–⌘4 | `shell/commands` |
| i18n | 新增收件箱条目文案与 aria | `runtime/i18n/en.ts`、`zh.ts` |
| 窄屏 | 底部 tab bar | `shell/mobile-*`、`shell/titlebar` |

---

## 5. 公共接口

### 5.1 P0：复用现有接口，不新增协议

| 用途 | 接口 |
| --- | --- |
| 待回复权限 | `GET /api/permission/request` 或 `GET /api/session/:id/permission` |
| 回复权限 | `POST /api/session/:sessionID/permission/:requestID/reply` |
| 待回复表单 | `GET /api/session/:sessionID/form` |
| 回复表单 | `POST /api/session/:sessionID/form/:formID/reply` |
| 取消表单 | `DELETE /api/session/:sessionID/form/:formID` |
| 定时任务列表 | `GET /api/experimental/schedule` |
| 知识库列表 | `GET /api/experimental/knowledge` |
| 会话列表 | `GET /api/session?limit=50` |
| 实时事件 | `permission.asked`、`permission.replied`、`session.updated` |

P0 的聚合在客户端完成：`app/src/inbox/model.ts` 把四个来源映射成 `InboxItem[]`。

已读状态 P0 存客户端：

```
Persist.global("inbox.seen") → { seen: Record<string, number> }
```

### 5.2 P1：新增实验性聚合端点

当条目多、客户端轮询压力大或需要多客户端同步时，再加：

```
GET   /api/experimental/inbox            → { data: InboxItem[] }
PATCH /api/experimental/inbox/:itemID    → 标记已读/已处理
```

服务端聚合的收益：

- 一次请求替代四次。
- 已读状态跨客户端同步。
- 「已完成」有服务端依据，不依赖本地缓存。

### 5.3 P1：补两个缺失的事件

| 事件 | 触发 | payload |
| --- | --- | --- |
| `schedule.updated` | 创建、暂停、恢复、删除、跑完 | `{ scheduleID }` |
| `knowledge.updated` | 索引开始、完成、失败 | `{ libraryID, status }` |

这两个事件是实时性的关键。没有它们，收件箱只能轮询。

### 5.4 命名约束

- 新端点放 `/api/experimental/inbox`，标识符 `experimental.inbox.*`。
- 不加 `session.inbox.*` 名字，那个已经是会话输入队列。
- 改公开 `HttpApi` 后，在 `packages/client` 跑 `bun run generate`。

---

## 6. UI 结构

### 6.1 页面骨架

沿用 `app/src/inbox/route.tsx` 的左右分栏：

| 区域 | 内容 |
| --- | --- |
| 页头 | 标题「收件箱」+ 描述 |
| 工具栏 | 四档筛选 + 搜索框 |
| 左栏 332px | 条目列表，按 `createdAt` 倒序 |
| 右栏 | 详情：标题、状态、类型、来源、时间、过期时间、请求内容、动作按钮、最近记录 |

### 6.2 四档筛选

| 筛选 | 条件 |
| --- | --- |
| 全部 | 所有条目 |
| 待处理 | `status === "pending"` |
| 失败 | `status === "failed"` |
| 已完成 | `status === "done"` |

计数从派生值算，不在组件里维护第二份状态。

### 6.3 详情动作

| kind | 主操作 | 次操作 |
| --- | --- | --- |
| `approval` | 批准本次 | 拒绝 |
| `question` | 回答 | 稍后处理 |
| `output` | 采纳 | 忽略 |
| `failure` | 重试 / 打开任务 | 忽略 |
| `result` | 查看结果 | 标记已读 |

### 6.4 状态覆盖

空、加载、错误、无选中、有选中、权限已过期、条目被他人处理。

### 6.5 刷新不清空

切换筛选或重新轮询时保留上一次数据，只在页头显示小 `Loader`。这是设计图明确要求的。

---

## 7. 侧栏导航重构

对应设计图的「落地顺序」：

### 7.1 改结构，不动视觉

`shell/titlebar/sidebar-nav.tsx` 改名为 `destination-toggle.tsx`：

- 移除 `dnd-kit`、`arrayMove`、`Persist.global("sidebar.nav")`。
- 改成四等分 `aria-pressed` 图标开关。
- 保留 `pressed` / `onSelect` 两个入参，调用方不改。
- hover 浮出名称与 ⌘1–⌘4。
- 未读是 6px 点，且文字里有「待处理」。

### 7.2 调整顺序

`shell/titlebar/titlebar.tsx`：

```
新建会话（32px 按钮 + ⌘T）
目的地行（28px，四等分）
会话列表
```

新建会话从整行改成按钮，不再和导航等宽等高。

### 7.3 快捷键与命令

在 `shell/commands` 注册：

| 命令 | 键位 |
| --- | --- |
| `destination.home` | ⌘1 |
| `destination.inbox` | ⌘2 |
| `destination.knowledge` | ⌘3 |
| `destination.scheduled` | ⌘4 |
| `tab.new` | ⌘T（已有） |

### 7.4 i18n 与可访问名

- 新增 tooltip 文案。
- 收件箱播报「收件箱，{{count}} 项待处理」，用 `language.plural`。
- 每个目的地按钮有 `aria-label`。
- `en` 与 `zh` 同步。

### 7.5 窄屏

767px 以下：

- 新建会话退成右上角 `+`。
- 四个目的地进底部 tab bar，52px，含安全区。
- 当前项只加文字色，不用填充块。
- 未读仍是 6px 点。
- 详情不并排，点列表进下一层。

---

## 8. 状态与交互

| 项 | 规则 |
| --- | --- |
| 选中 | 中性 `layer-02` 填充，强调色只给焦点环和主操作 |
| 悬停 | 更浅，与选中可同时出现而不混淆 |
| 键盘 | ⌘1–⌘4 切目的地，↑↓ 移动列表，Enter 打开详情 |
| 焦点 | 目的地行内 roving tabindex |
| 过期 | 权限请求按 `expiresAt` 显示剩余时间，过期后动作禁用 |
| 并发处理 | 条目被其他客户端处理时，列表通过事件移除，详情显示「已处理」 |

---

## 9. 分阶段

### P0（2–3 天）：收件箱能看见、能处理

- `app/src/inbox/model.ts`：会话（提问 / 失败 / 权限）+ 定时任务 + 知识库聚合为 `InboxItem[]`
- 会话提问与失败接入：复用 `createSessionInbox` 的 `approval` / `input` / `failed` 状态
- 列表渲染 + 四档筛选 + 计数
- 详情面板 + 批准/拒绝
- 本地已读状态
- schedule / knowledge 轮询（30s，索引中 3s）
- 侧栏 `destination-toggle` 改造
- 快捷键与 i18n

### P1（3–4 天）：实时与多端一致

- `experimental.inbox.list` / `experimental.inbox.update`
- `schedule.updated`、`knowledge.updated` 事件
- 服务端已读状态
- 条目去重与过期清理

### P2（2–3 天）：窄屏与可观测

- 底部 tab bar
- 收件箱搜索
- 「最近记录」时间线
- e2e：四个目的地可达、批准一次写入、刷新保留数据

---

## 10. 验收

1. 定时任务失败后，收件箱在 30s 内出现一条 `failure`，标题带任务名。
2. 权限请求出现后，收件箱立刻出现 `approval`（靠事件），点「批准本次」后条目转为已完成。
3. 会话需要提问时，收件箱出现 `question`（靠 `form.created`），回答后转为已完成，会话继续运行。
4. 会话运行失败时，收件箱出现 `failure`，点开进入对应会话。
5. 知识库索引完成后，收件箱出现 `result`，文档数与索引时间正确。
6. 四档筛选的计数与列表一致，切换筛选时列表不闪空。
7. 刷新页面后已读状态保留，未处理项仍在。
8. 侧栏四个目的地可用 ⌘1–⌘4 切换，未读点与「待处理」文字同时出现。
9. 767px 以下底部 tab bar 可达四个目的地。
10. 深色下选中、悬停、焦点三态可区分。

---

## 11. 风险与取舍

| 风险 | 处理 |
| --- | --- |
| 轮询过密 | P0 用 30s，索引中 3s；P1 换事件 |
| 条目爆炸 | 只收五类待办；空跑、正常完成、单次工具失败不进；列表只保留最近 50 条 |
| 已读状态丢失 | P0 本地持久化；P1 服务端 |
| 与会话收件箱重复 | 侧栏只做入口；收件箱复用 `createSessionInbox` 的状态计算作为数据源，不重写判定 |
| 权限请求跨会话 | 从 `request.sessionID` 反查 schedule，展示来源 |
| 误批准 | 默认「批准本次」，`always` 需要显式选择 |
| 窄屏信息过载 | 只做「看结果 + 处理异常」，不做并排详情 |

---

## 12. 一句话总则

**收件箱只回答一个问题：现在哪件事需要我拍板。** 数据可派生就不落库，能事件就不轮询，已读状态先本地后服务端。
