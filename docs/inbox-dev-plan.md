# 收件箱开发方案（P0 施工单）

状态：待开发
设计依据：`docs/inbox-design.md`
开发会话：`ses_e64812c14ffdCHzXmm40sQaCH7`
工作分支：`lts/ocdev`
工作目录：`/Users/ekko/Projects/opencode`

---

## 0. 一句话目标

把 `/inbox` 从空壳变成可用收件箱：会话提问、权限请求、三类失败、定时任务产出、知识库完成，共五类事项，能看、能筛、能处理。

**P0 不改后端。**

---

## 1. 现状

| 文件 | 现状 |
| --- | --- |
| `packages/app/src/inbox/route.tsx` | 有页头、四档筛选、左右分栏；列表永远走空状态 |
| `packages/app/src/shell/titlebar/inbox-model.ts` | 会话状态收件箱，已能算 `approval` / `input` / `working` / `failed` / `done` |
| `packages/app/src/shell/titlebar/sidebar-nav.tsx` | 四个目的地 + 新建会话，仍是可拖拽整行 |
| `packages/app/src/shell/routes/routes.tsx` | `/inbox` 已挂载 |
| i18n | `inbox.*` 基础文案已有 |

---

## 2. 范围：只做五类

| kind | 触发 | 动作 | 数据来源 |
| --- | --- | --- | --- |
| `question` | 会话 `form.created` 未回复 | 回答 | `session.form.list/reply/cancel` |
| `approval` | `permission.asked` 未回复 | 批准 / 拒绝 | `session.permission.list/reply` |
| `failure` | 会话 `outcome === "failed"`、定时任务 `lastOutcome` 为 `failed`/`expired`、知识库 `status === "failed"` | 查看 / 重试 | `Session.Info`、`Schedule.Info`、`knowledge.list` |
| `output` | 定时任务 `lastOutcome === "fired"` 且有 `lastOutput` | 查看 / 采纳 | `Schedule.Info` |
| `result` | 知识库 `status === "ready"` | 知晓 / 归档 | `knowledge.list` |

### 明确不做

- 会话正常完成、运行中
- 定时任务空跑、条件未触发、跳过
- 知识库索引中、空库
- 单次工具调用失败
- 前端运行时错误
- 子会话或后台任务结果
- 应用更新、账号或凭证异常

---

## 3. 任务分解

### T1：统一条目模型与聚合层

**新建** `packages/app/src/inbox/model.ts`

```ts
type InboxKind = "question" | "approval" | "failure" | "output" | "result"
type InboxStatus = "pending" | "done" | "failed"

type InboxItem = {
  key: string
  kind: InboxKind
  status: InboxStatus
  title: string
  summary: string
  source: { type: "session" | "schedule" | "knowledge"; id: string; name?: string }
  projectID?: string
  createdAt: number
  expiresAt?: number
  action: InboxAction
}
```

要求：

- 会话来源复用 `createSessionInbox` 的 `approval` / `input` / `failed` 判定，不重写。
- 定时任务、知识库来源各自映射，纯函数，输入输出都可测。
- 按 `createdAt` 倒序。
- 状态机遵循 `packages/app/AGENTS.md`：`loading / ready / refreshing / error`，不用多个布尔。

**验收**：纯函数测试覆盖五类映射和排除项。

### T2：数据接入与事件

**改** `packages/app/src/inbox/model.ts`

- 权限：`session.permission.list` + `permission.asked/replied`
- 表单：`session.form.list` + `form.created/replied/cancelled`
- 会话失败：`Session.Info.outcome` + `session.updated`
- 定时任务：`schedule.list`，30s 轮询
- 知识库：`knowledge.list`，30s 轮询；有 `indexing` 时 3s
- 多 server：每个连接独立拉取，`key` 带 server 前缀
- 实验开关关闭或接口不可用时，该来源为空，不报错

**验收**：关闭 `experimental.schedules` 或没有知识库时，其余来源正常显示。

### T3：列表与筛选

**改** `packages/app/src/inbox/route.tsx`

- 四档筛选：全部 / 待处理 / 失败 / 已完成
- 计数从条目派生，不维护第二份状态
- 列表行：kind 图标、标题、摘要、来源名、时间、状态点
- 空、加载、错误、无选中、有选中
- 切换筛选或轮询时保留上一次数据，页头小 `Loader`
- 滚动用原生 `overflow-y-auto` + `data-scrollable`，不引入 `ScrollView`

**验收**：计数与列表一致；切换筛选不闪空；刷新保留滚动。

### T4：详情面板

**改** `packages/app/src/inbox/route.tsx` 或拆出 `detail.tsx`

| kind | 主操作 | 次操作 |
| --- | --- | --- |
| `approval` | 批准本次（`once`） | 拒绝 |
| `question` | 回答 | 稍后处理 |
| `failure` | 重试 / 打开来源 | 忽略 |
| `output` | 采纳 | 忽略 |
| `result` | 查看结果 | 标记已读 |

- 权限展示 `expiresAt` 剩余时间，过期后动作禁用。
- 条目被其他客户端处理时，列表通过事件移除，详情显示「已处理」。
- 批准默认 `once`，`always` 必须显式选择。

**验收**：批准一次写入后条目转已完成；过期请求不能再批准。

### T5：本地已读

- `Persist.global("inbox.seen")` 存 `{ seen: Record<string, number> }`
- 打开详情即标记已读
- 未读数用于侧栏点和筛选计数
- 刷新保留

**验收**：刷新后已读不复活，未处理仍在。

### T6：侧栏三段式

**改** `packages/app/src/shell/titlebar/sidebar-nav.tsx` → 改名 `destination-toggle.tsx`

- 移除 `dnd-kit`、`arrayMove`、`Persist.global("sidebar.nav")`
- 四等分 `aria-pressed` 图标开关，28px
- 保留 `pressed` / `onSelect` 入参
- hover 浮出名称与 ⌘1–⌘4
- 未读 6px 点 + 文字「待处理」，不只靠颜色

**改** `packages/app/src/shell/titlebar/titlebar.tsx`

顺序：新建会话（32px 按钮 + ⌘T）→ 目的地行 → 会话列表。

**验收**：会话列表上移约 100px；四个目的地可键盘操作。

### T7：快捷键与 i18n

- `shell/commands` 注册 `destination.home/inbox/knowledge/scheduled`，⌘1–⌘4
- `en.ts` 新增 `inbox.item.*`、tooltip、aria
- `zh.ts` 同步
- 计数用 `language.plural`，不拼句子

**验收**：⌘1–⌘4 可达；收件箱播报「收件箱，N 项待处理」。

### T8：窄屏（可与 T6 同批，也可单独）

- 767px 以下底部 tab bar，52px，含安全区
- 新建会话退成右上角 `+`
- 详情不并排，点列表进下一层
- 未读仍是 6px 点

**验收**：767px 以下四个目的地可达。

---

## 4. 必须遵守

- `packages/app/AGENTS.md` 全部条款，重点是：状态机、`createStore`、i18n、滚动、字体、测试。
- 不硬编码英文文案。
- 不新增 token 或强调色；颜色只用 `--v2-*`。
- 不新增依赖。
- 不改 `packages/desktop` 的 preload 暴露面。
- 不重启 app 或 server。
- 不在仓库根目录跑 `bun test`。
- P0 不改 `packages/core`、`packages/protocol`、`packages/schema`。
- 协议没改，不需要 `bun run generate`。

---

## 5. 验证

在 `packages/app` 目录：

```
bun typecheck
bun test src/inbox
```

在浏览器验证：

- 浏览器标签页 `http://localhost:4444`（按 `packages/app/AGENTS.md` 的本地开发方式）
- 不用截图识别，用 DOM 结构和数据断言

e2e（`packages/app/e2e`）：

- 五类事项各出现一次
- 批准一次写入后条目转已完成
- 回答 form 后条目转已完成
- 刷新保留已读
- 四个目的地可达

---

## 6. 交付

- 在 `lts/ocdev` 分支提交，不 push。
- 建议拆成三个 commit：
  1. `feat(app): add inbox item model and sources`
  2. `feat(app): render and handle inbox items`
  3. `feat(app): move sidebar destinations into one row`
- 完成后把 commit hash、改动摘要、验证结果、风险点向用户报告，等验收。
- 遇到阻塞先说明，不静默放弃。

---

## 7. 一句话总则

**先让五类事项出现在列表里，再让每一条都能被处理；侧栏改造最后做，避免一次 diff 太大。**
