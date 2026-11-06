# 定时任务模块开发推进文档

来源：`~/agents/demo/scheduled-workbench-design.html`（12 屏工作台设计图）。
范围：本仓库已有的 `schedule` 后端能力，以及 `packages/app/src/scheduled` 前端页面。

---

## 1. 现状

### 后端已具备（`packages/core/src/schedule.ts`）

- 触发方式：`in`（延时一次）、`at`（定时一次）、`every`（固定间隔）、`cron`（表达式）。
- 时区：`tz`，缺省用配置时区，再退回服务器本地时区。
- 条件门：`if`（每次到点先检查）与 `until`（轮询直到通过），支持 shell 与 Code Mode 两种。
- 结束条件：`ends.after` / `ends.at` / `ends.times`。
- 状态：`active` / `paused` / `done`。
- 结果：`fired` / `late` / `checked` / `expired` / `skipped` / `disabled` / `failed`。
- 计数与摘要：`runCount`、`nextDueAt`、`lastFiredAt`、`lastOutcome`、`lastOutput`。
- 执行方式：唤醒绑定的 Session，把 `prompt` 投递给它，因此每次运行天然是一条可继续追问的会话。

### 对外 API（`packages/protocol/src/groups/schedule.ts`）

`create` / `list` / `get` / `pause` / `resume` / `delete`，全部在 `/api/experimental/schedule` 下。
前置条件：会话所在位置必须打开 `experimental.schedules`，否则返回 403。

### 前端现状（`packages/app/src/scheduled/`）

2026-11-06 起为真实主从页：`route.tsx`（列表 / 筛选 / 搜索 / 详情 / 操作）、`new-dialog.tsx`（新建）、`describe.ts`（频率与结果文案）、`machine.ts`（列表状态机）、`scheduled.css`。路由 `/scheduled` 与侧边栏入口已就位。

### 差距（2026-11-06 起点）

| 设计图能力 | 本轮前 | 本轮后 |
| --- | --- | --- |
| 例行列表（名称 / 频率 / 下次 / 最近结果） | 无 | 已实现 |
| 详情（下次运行、运行次数、最近输出） | 无 | 已实现 |
| 新建 | 无 | 已实现（名称 / 频率 / 提示词 / 目录） |
| 新建预演 | 无 | P1 |
| 暂停 / 恢复 / 删除 | 后端有，前端无 | 已实现 |
| 立即运行 | 无 API | P1 |
| 编辑指令 | 无 update API | P1 |
| 运行历史列表 | 只有最后一次结果 | P1 |
| 工作台 / 收件箱联动 | 页面占位 | P2 |
| 全局跨会话列表 | `list` 强制按 sessionID 查询 | 已支持省略 sessionID |

---

## 2. 功能点与功能列表

编号用于后续提交和验收对照。P0 本轮实现，P1/P2 排期。

| 编号 | 功能 | 解决什么问题 | 优先级 |
| --- | --- | --- | --- |
| F1 | 全局列出所有定时任务 | 用户要知道“我一共排了哪些事”，而不是逐个会话去找 | P0 |
| F2 | 列表项展示名称、频率、下次运行、最近结果 | 扫一眼就能判断哪个在正常工作、哪个掉链子 | P0 |
| F3 | 状态筛选（全部 / 运行中 / 已暂停 / 失败） | 任务多时先看异常，不被正常项淹没 | P0 |
| F4 | 搜索名称与提示词 | 任务多时定位具体一条 | P0 |
| F5 | 详情面板展示运行事实 | “下次什么时候跑、上次结果如何、要不要改” | P0 |
| F6 | 暂停 / 恢复 | 临时停掉但保留配置，不必删除重建 | P0 |
| F7 | 删除（带确认） | 去掉不再需要的任务，且防误删 | P0 |
| F8 | 打开所属会话 | 从任务跳到它产生的对话，继续追问 | P0 |
| F9 | 新建任务（名称、频率、提示词、工作目录） | 不写代码也能排一件周期性的事 | P0 |
| F10 | 配置未开启时给出明确引导 | `experimental.schedules` 关闭时，新建与操作被拒而不是静默失败，toast 告诉用户怎么开 | P0 |
| F11 | 运行结果摘要 | 详情里看到 `lastOutput`，不必先开会话 | P0 |
| F12 | 立即运行一次 | 保存前先验证提示词是否产出预期结果 | P1 |
| F13 | 编辑任务（名称、频率、提示词） | 需求变化时不用删了重建 | P1 |
| F14 | 新建时只读预演 | 保存前看到样例产出，降低第一次失败率 | P1 |
| F15 | 运行历史列表（最近 N 次） | “跳过”“重试”必须可见，否则用户以为任务在偷偷漏跑 | P1 |
| F16 | 失败重试与跳过原因 | 区分“没跑”和“跑失败” | P1 |
| F17 | 工作台「今天」聚合 | 首页直接看到今天的产出的与待处理 | P2 |
| F18 | 收件箱只收需决策项 | 避免通知噪音 | P2 |
| F19 | 命令面板统一检索任务 | 任务与会话同级，不再藏在功能页 | P2 |
| F20 | 窄屏只读 | 手机上看结果、处理异常，创建与编辑回桌面 | P2 |

---

## 3. 设计图到本模块的映射

| 设计图 | 本模块的处理 |
| --- | --- |
| 01 例行管理 | 直接实现为 `/scheduled` 主从页（F1–F8、F11） |
| 02 新建 + 预演 | P0 实现新建表单（F9）；预演拆到 P1（F12、F14） |
| 03 运行详情 | 不另造结果页。详情只放运行事实 + “打开会话”，产出留在会话里 |
| 04 今天 | P2，依赖 F15 的产出分类 |
| 05 收件箱 | P2，依赖失败/待采纳的状态来源 |
| 06 对话 | 已有 |
| 07 输入框四态 | 已有大部分，不在本模块 |
| 08 新建会话 | 已有 |
| 09 知识库 | 无关 |
| 10 设置 | P1 增加“定时任务”开关说明 |
| 11 命令面板 | P2 |
| 12 窄屏 | P2 |

---

## 4. 实现方案

### 4.1 数据与 API

**P0 改动：让 `list` 支持全局查询。**

- `packages/protocol/src/groups/schedule.ts`：`list` 的 `sessionID` 改为可选。
- `packages/server/src/handlers/schedule.ts`：传 `sessionID` 时保持现有的 `allowed` 校验；不传时直接 `schedules.list()` 返回全部。
- `packages/core` 的 `Schedule.list` 已支持无参调用，无需改。
- 改完从 `packages/client` 跑 `bun run generate`，不要手改生成文件。

**P1 需要的 API（本轮不实现）：**

| 能力 | 建议 |
| --- | --- |
| 立即运行 | `POST /api/experimental/schedule/:id/run`，受权限与并发保护 |
| 编辑 | `PATCH /api/experimental/schedule/:id`，复用 `Request` 的校验 |
| 运行历史 | 新增 `schedule_run` 表或读取会话消息；优先读会话消息，避免重复存储 |

### 4.2 前端数据流

```
ScheduledScreen
  → serverSdk.api.experimental.schedule.list({})      // 全局，不传 sessionID
  → 按「运行中优先、nextDueAt 升序」排序
  → 操作：pause / resume / delete，成功后就地更新
```

- 新建：`session.create({ location: { directory }, title })` → `schedule.create({ sessionID, name, when, prompt })`。
- 失败不静默：新建或操作返回 403 时 toast 提示「开启 experimental.schedules」，其他错误显示原因。
- 全局列表本身不校验开关，所以关闭配置时页面仍可打开并显示已有任务；真正被拒绝的是新建与操作。
- 不引入新的全局缓存层；页面级状态 + 事件回写即可。

### 4.3 页面结构

沿用 `PagePanel` / `PageHeader` / `PageToolbar`，主从两栏：

- 左栏 320px：搜索 + 筛选 chip + 任务列表，独立滚动。
- 右栏：详情，独立滚动；未选中时给一句选择提示。
- 760px 以下改为上下堆叠，列表在上、详情在下。
- 状态用文字 + 状态点，选中用中性灰，accent 只给主操作。

### 4.4 状态机

列表生命周期放在 `packages/app/src/scheduled/machine.ts`，单一判别联合，不用并行布尔：

```ts
type TaskState =
  | { status: "loading" }
  | { status: "ready"; tasks: ScheduleInfo[] }
  | { status: "error"; message: string }

type TaskEvent =
  | { type: "load.started" }
  | { type: "load.succeeded"; tasks: ScheduleInfo[] }
  | { type: "load.failed"; message: string }
  | { type: "task.upserted"; task: ScheduleInfo }
  | { type: "task.removed"; id: string }

transition(state, event): TaskState
```

- 纯函数，无 I/O；`task.*` 事件在 loading / error 状态原样返回，避免把任务写进尚不存在的列表。
- 组件只做驱动：请求前后 dispatch，成功结果回写；删除后再清空选中。
- 操作中的任务 id 用一个 in-flight 字段，按钮在请求期间禁用，失败弹 toast。
- 列表只在 `ready` 渲染；`loading` 显示 `Loader`，`error` 显示错误块与重试，不会把加载失败误显示成「还没有任务」。

---

## 5. 本轮交付（P0）

- [x] 文档
- [x] 后端 `list` 支持全局查询并重新生成 client
- [x] `/scheduled` 主从页：列表、筛选、搜索、详情
- [x] 暂停、恢复、删除（确认）
- [x] 打开所属会话
- [x] 新建任务（名称、频率、提示词、工作目录）
- [x] 未开启配置时的 toast 引导（新建与操作失败路径）
- [x] 中英文案
- [x] 列表生命周期状态机（`scheduled/machine.ts`）

## 6. 验收

- 关闭 `experimental.schedules`：页面仍可打开并列出已有任务；新建或暂停时报 403 并 toast 提示如何开启。
- 开启后：创建一条 `every 1 hour` 的任务，列表出现，详情字段正确。
- 暂停后状态变 `paused`，恢复后回到 `active`。
- 删除需二次确认，删除后列表移除。
- 打开会话跳到对应 session。
- 加载失败时列表不显示「还没有任务」，而是右侧给出错误与重试。
- 窄容器下列表与详情上下堆叠，不出现横向溢出。
