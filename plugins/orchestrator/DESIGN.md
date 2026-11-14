# `changhong.orchestrator` 实现决策

对应 `orchestrator-plugin-spec.md` v2。这里只写 spec 没写死、实现时必须定的东西；行为以 spec 为准。

## 1. 模块（`src/` 9 个）

| 文件 | 一句话职责 |
|---|---|
| `ledger.ts` | 台账类型与 schema、状态迁移校验、原子落盘 |
| `plan.ts` | plan 输入校验、依赖环、路径规范化与冲突对 |
| `brief.ts` | 任务书 markdown |
| `dispatch.ts` | `git worktree add -b` → 建会话 → move → 投递 → 记账 |
| `collect.ts` | 读结果文件、跑机械核对、按结论迁移状态与写异常 |
| `watch.ts` | 订阅 `session.execution.*`、宽限计时、巡检、启动 reconcile |
| `tools.ts` | 四个工具注册、`status` 视图 |
| `git.ts` | `Bun.spawn` 封装 git 与 verify（超时 + 进程组杀） |
| `skill.ts` | 加载 `skills/orchestrator/SKILL.md` |

没有单独文件的东西：异常读写、通知、去重都放进 `collect.ts` 与 `ledger.ts`；路径前缀判定放 `plan.ts`。

插件用 promise 版 `Plugin.define`（同 dbro）。`server/main.ts` 只做 activate：加载技能、注册工具、启动 `watch`、返回 cleanup。

## 2. 台账

`<data>/ledger.json`，`version: 1`，读时 `Schema.decodeUnknown` 失败即报错，不重建。任务字段 = spec §2 + `planID`、`approvedAt`、`dispatchedAt`、`note`。`anomalies` 与任务平级，一条异常 = `{ taskID, kind, detail, since }`，同一 `taskID + kind` 只保留一条（`since` 不漂移）。任务重新派发时清掉它自己的异常。

写入：`store` 不存在，直接在 `ledger.ts` 里用「tmp 文件 + rename」，模块内一个 promise 队列串行化所有写，避免工具调用与事件回调并发丢写。

`planID` 幂等：`plans/<planID>.json` 存在时比较输入 JSON 的规范化结果，一致就原样返回旧输出，不一致直接报错。

## 3. 状态迁移

实现在 `ledger.ts` 的 `TRANSITIONS` 表，只有 `move(task, to)` 能写 `status`，非法边抛错。除 spec §2 的边，实现还需要两条（spec 漏了，见 §5）：
- `失败 → 已核`：`resolve accept`
- `失败 → 已合入`：不设，accept 一律先到 `已核`

## 4. 四工具的额外校验

只在 spec 没写的分支上加：
- `plan`：`task.id` 必须匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`（要拼进分支名与目录名）；`concurrency` 非 1–8 报错而不是裁剪；`planID` 已存在且输入不同 → 报错。
- `approve`：一次传多个任务时任何一个 ID 非法 → 整体报错并列出全部非法 ID；派发失败的进 `waiting`，不回滚其它任务。
- `resolve`：`decision` 与当前状态不匹配一律报错（含非法 decision、缺 `note` 的 accept），不做静默 no-op。
- `status`：台账为空返回全 0 与空 `anomalies`。

## 5. spec v2 仍缺的两处（实现按这里的说法，若不同意再改）

1. §2 迁移表没有 `失败 → 已核`，但 §4.4 的 `accept`「越过验收失败直接进入 `已核`」必须从 `失败` 起跳。实现补这条边。
2. §5.2 要求 `execution.failed` 记异常 `执行失败`，但 §4.2 的 `kind` 枚举没有这个值。实现把它加进 `kind` 枚举（前端多一个标签），不改其余 6 个。

## 6. 测试（7 个文件，跟模块走）

`ledger` / `plan` / `brief` / `git` / `dispatch` / `collect` / `tools` + `manifest`。
纯函数与状态机全组合必须覆盖；`git.test.ts` 用临时真仓库（`git init`）测 worktree、分支、diff、status 与 verify 超时；`dispatch` / `collect` / `tools` 用窄接口注入假实现，不 mock 全局。
