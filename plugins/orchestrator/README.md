# changhong.orchestrator

把一批任务变成一台自动推进的状态机：记台账、按依赖派发、收回结构化结果、跑机械核对。插件**不做判断**——拆任务、裁决冲突、失败归因、合入都留给 PM（agent）。

需求与行为以 `../../.opencode/plan/orchestrator-plugin-spec.md`（v2.1）为准；实现决策见 `DESIGN.md`。

## 装什么

插件注册一个 `orchestrator` 命名空间，四个工具：

| 工具 | 作用 |
| --- | --- |
| `orchestrator.plan` | 提交任务图，校验 ID、依赖环与路径冲突，不派发 |
| `orchestrator.status` | 正常任务只给计数，异常逐条列出 |
| `orchestrator.approve` | 放行并按并发上限立即派发 |
| `orchestrator.resolve` | `retry` / `merged` / `unblock` / `abandon` / `accept` |

还有一个技能 `skills/orchestrator/SKILL.md`，写的是 PM 的作业流程。

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `idleGraceMs` | `60000` | 执行结束后等结果文件的宽限期（`session.idle` 兜底与巡检用） |
| `succeededDelayMs` | `2000` | 执行成功后读结果文件前的短延迟；文件此时已落盘，只吸收事件顺序抖动 |
| `timeoutMs` | `7200000` | 进行中任务超过这个时长记「超时」，只报不杀 |
| `verifyTimeoutMs` | `600000` | 单条验收命令的超时 |
| `notifySessionID` | `""` | 配置后只在「验收失败 / 范围越界 / 会话失联」时投递一条摘要 |

## 数据

全部在 `<data>` 下，`data` 目录由宿主提供：

- `ledger.json`：台账（原子写，读坏即报错，不重建）
- `plans/<planID>.json`：提交时的输入存档，用于幂等比较
- `results/<planID>/<taskID>.json`：执行者写的结果文件
- `worktrees/<repo>-<taskID>/`：任务 worktree 与分支

## 开发

```sh
cd plugins/orchestrator
bun test
bun run typecheck
bun run build   # dist/
bun run pack    # ~/.ocplugins-local/changhong.orchestrator/<version>/
```
