# ChatGPT 客户端对话页面显示逻辑

> 分析对象：macOS ChatGPT `26.1023.51421`
>
> 分析范围：本机 `/Applications/ChatGPT.app/Contents/Resources/app.asar` 中的 webview renderer 代码
>
> 说明：这是基于当前打包代码的行为分析，不是 OpenAI 的公开 UI API。内部组件名、字段和实现可能随版本变化。

## 1. 核心结论

ChatGPT 当前对话页不是把每个 thinking、命令和工具调用直接按原顺序铺成聊天消息，而是先把它们归一成一个 **agent activity 工作过程**：

```text
用户消息
└── Agent Activity 组
    ├── 时间状态标题：Working → Working for … → Preparing response → Worked for …
    ├── activity 摘要 / 当前动作
    └── 可展开的 activity 列表
        ├── Thinking / Thought for a while
        ├── Read files
        ├── Ran commands
        ├── Edited files
        ├── Searched the web
        └── MCP / connector / subagent 等
最终 assistant 回复
```

其中：

- `Working for …` 是整轮工作过程组的标题，不是 Thinking 或某个工具自己的标题。
- Thinking 属于工作过程组内部的 activity item。
- 最终回复位于工作过程组之外，是用户长期保留的主要内容。
- 完成后，工作过程可以收成 `Worked for …` 的 disclosure，用户仍能重新展开查看。

## 2. 页面层级

```text
Conversation
├── User Message
│
├── Agent Activity Group
│   ├── Header
│   │   ├── temporal status
│   │   │   ├── Working
│   │   │   ├── Working for {duration}
│   │   │   ├── Preparing response
│   │   │   ├── Worked for {duration}
│   │   │   ├── You stopped after {duration}
│   │   │   └── Task canceled
│   │   └── disclosure chevron
│   │
│   └── Body
│       ├── Thinking item
│       ├── activity summary / collapsed latest item
│       └── expanded activity item list
│
└── Final Assistant Message
```

活动组和最终回复是两个同级区域。Thinking、命令和文件操作不会出现在最终回复之后。

## 3. 单轮的显示状态

| 阶段 | 主要显示 | 行为 |
|---|---|---|
| 请求已提交，刚开始工作 | `Working` | 尚未达到显示耗时的阈值 |
| 工作持续中 | `Working for 1m 5s` | 计时持续更新 |
| 工具工作结束，最终回复尚未开始 | `Preparing response` | 表示正在组织回答 |
| 用户停止 | `You stopped after 1m 5s` | 保留已执行的活动，同时明确是用户中断 |
| 被取消 | `Task canceled` | 取消状态优先于普通完成标题 |
| 达到用量限制后暂停 | `Paused` | 与普通 working/completed 分开 |
| 本轮完成 | `Worked for 1m 5s` | 活动组可以收为可重新展开的历史 |
| 历史状态不可确定 | `Activity` | 用于保存过的活动，无法可靠恢复 running/elapsed 时 |
| 状态同步中 | loading skeleton | 避免先显示错误的最终状态 |

标题状态的核心判断是：

```text
canceled
  → Task canceled

streaming && workflow.complete
  → Preparing response

streaming && workflow.not_complete
  → workflow.summary.title ?? "Working"

!streaming && duration
  → Worked for {duration}

!streaming && no duration
  → Worked for a while
```

## 4. Agent Activity 组的展开与折叠

活动组本身是一个 disclosure：

- Header 是整体的展开/收起开关。
- 展开后显示当前 turn 内的 activity item。
- 收起后 Thinking、命令、读文件等条目一起隐藏，不会留下孤立的 Thinking。
- Header 使用 `aria-expanded`，chevron 随展开状态旋转。
- 鼠标 hover 或键盘 focus 时显示 disclosure chevron。
- 工作过程中默认展开，用户仍可主动收起。
- 正在流式工作时，如果用户收起完整列表，部分实现会保留最新一条 activity 作为单行预览，让用户知道当前仍在做什么。
- 完成后，同一区域可以通过 `Worked for …` 收为一行；点击后重新展开整个过程。

## 5. Thinking 的显示规则

Thinking 是 workflow 中的一个 task，不是独立时间线消息。

### 5.1 标题

ChatGPT 对 reasoning task 使用两种标题：

| task 状态 | 标题 |
|---|---|
| 运行中 | `Thinking` |
| 已完成 | `Thought for a while` |

因此，一个思考步骤完成后不会立刻消失，而是变成已完成的活动项。只有整个 activity 组收起时，它才一起隐藏。

### 5.2 内容

Thinking task 可以带 Markdown 内容。渲染逻辑区分：

- 流式思考：使用流式 Markdown 渲染。
- 已完成思考：使用普通 Markdown 渲染。
- 内容为空：只显示 task 标题。
- 内容较短且是第一个 thought：可以使用更适合短文本的逐步显示方式，避免长 Markdown 初始化开销。

Thinking 内容属于 activity body，不进入最终回复正文。

## 6. activity item 类型

当前 renderer 能识别的核心 task 类型包括：

| 类型 | 运行中标题 | 完成标题 |
|---|---|---|
| thought | Thinking | Thought for a while |
| file scan | Scanning document | Scanned document |
| image | Analyzing image | Analyzed image |
| web search | Searching the web / Searching: {query} | Searched the web |
| custom tool / connector | 工具自己提供的活动标题 | 工具完成标题 |
| commands | Running command(s) | Ran command(s) |
| subagent | 运行中的 subagent 活动 | 完成结果或子会话入口 |

不同工具还可以提供自己的图标、详情、来源和文件链接。

## 7. 命令的单条与汇总层级

命令同时存在两个展示层级。

### 7.1 单个 task 层级

单个 shell 命令可以有：

- `Running command`
- `Running command for {elapsed}`
- `Ran command`
- `Ran command in {elapsed}`
- `Stopped command`
- `Stopped command after {elapsed}`

命令被识别为 read、test、lint、background terminal 等情况时，会使用更具体的语义文案。

### 7.2 汇总层级

多个同类命令在 collapsed activity summary 中会合并：

```text
{count, plural,
  one {Ran a command}
  other {Ran commands}
}
```

同类 activity 的汇总片段还会组合成一句：

```text
Read files, ran commands, and edited files
```

汇总层不直接显示数量，数量只决定单复数。

## 8. 工具和 activity 的分组算法

renderer 在显示前会先归一 activity list，主要规则如下：

1. 去掉重复 task id。
2. 相邻且语义相同的 custom tool call 可以合并。
3. 同一 connector 的 read/write action 可以组成 connector group。
4. 如果一个 connector group 实际只有一个 task，则重新展开成单 task，避免无意义的套层。
5. 紧挨 connector group 前面的 thought 可以并入该 connector group。
6. 同一 action 类型的命令、读文件、编辑文件等在 collapsed summary 中按类型聚合。
7. 不同 activity 类型保留为独立 task。

目标是让用户看到“做了什么”，而不是 provider 原样返回了多少次 tool call。

## 9. 从工作过程切换到最终回复

最终 assistant 回复开始出现时：

1. Header 从 `Working for …` 切换到 `Preparing response`。
2. Activity body 仍属于工作过程，不属于最终答案。
3. Workflow 完成后，header 变为 `Worked for {duration}`。
4. 已完成 turn 的 activity 可以通过 collapsed-turn / Worked for disclosure 收成一行。
5. 最终回答显示在 activity 下方。

用户展开 `Worked for …` 后可以重新查看：

- Thinking / Thought for a while
- 命令
- 文件操作
- 网页搜索
- 工具和 connector
- 被自动审核拒绝的操作

因此 ChatGPT 的策略是：**最终答案保留正文，完整工作过程保留为可重新展开的历史。**

## 10. 历史 turn 的折叠

除了当前 turn 的 activity，历史 turn 还有一层 `collapsed-turn` disclosure。

它可以显示：

- `Worked for {duration}`
- `{count} previous messages`
- `N denied actions`

用户展开后，可以看到被折叠的历史活动和自动审核拒绝记录。这个组件主要解决长对话中历史 turn 占用空间的问题。

## 11. 中断、错误和限制

ChatGPT 把不同异常拆成不同层级，不会全部塞进 activity summary：

- 用户停止：`You stopped after …`
- workflow 被取消：`Task canceled`
- 用量限制：`Paused`
- 保存的 turn 无法恢复精确状态：`Activity`
- 普通错误、重试、授权请求和同步问题使用各自的状态组件

这样，activity 列表继续描述“工作过什么”，错误提示负责解释“为什么没有继续”。

## 12. 与当前 OpenCode 实现的对照

| 项目 | ChatGPT | 当前 OpenCode |
|---|---|---|
| 总体结构 | Worked/Working 是 activity group 标题 | 已改为每个用户 turn 一个 activity group，固定在提问下方 |
| Thinking 位置 | group 内部 task | 已移到 Working 活动列表内部 |
| Thinking 完成态 | Thought for a while，保留在组里 | 已显示 Thought for a while，并保留到整组收起 |
| Thinking 内容 | 组内 task 内容，可展开查看 | 默认折叠，点击展开 |
| 整体折叠 | 收起后 Thinking 和工具一起隐藏 | 已按同样层级处理 |
| 命令聚合 | 按 action 类型汇总为 Ran commands | 已聚合 Running/Ran commands |
| 读文件/编辑汇总 | 汇总到同一 activity summary | 收起后按类型聚合为 Read files, ran commands, edited files |
| 最终回复前状态 | Preparing response | 最终正文开始后切换为 Preparing response |
| turn 完成 | Worked for … 可展开 | 已收为可重新展开的 Worked for … |

## 13. 对当前 OpenCode 最值得借鉴的点

1. `Working for` 只作为 activity group 的标题，Thinking 和工具都必须在 group body 内。
2. 整体收起时，整个 group body 一起隐藏。
3. 已完成思考保留为已完成 task，而不是在 reasoning 结束时突然消失。
4. 工具按语义类型聚合，而不是每次调用各显示一行。
5. 工作完成到最终回答开始之间提供 `Preparing response`。
6. 如果产品决定保留历史过程，应使用 `Worked for …` disclosure，而不是永久铺开全部工具卡片。

## 14. 本机代码依据

本次分析涉及的主要 renderer chunk：

- `register-DNfAakVi-10e4220e31bc.js`
  - workflow 标题状态
  - task 标题
  - activity 分组与汇总逻辑
- `agent-activity-item-row-887b9e87f173.js`
  - activity header
  - disclosure
  - body 布局
- `worked-for-item-content-4cfb3118695d.js`
  - Working / Preparing response / Worked for / stopped / paused 状态
  - elapsed time
- `collapsed-turn-disclosure-9a9f8a714d1e.js`
  - 历史 turn 折叠
  - denied action count
- `subagent-activity-chip-group-2d4873e73217.js`
  - activity chip 与 subagent 展示
- `timeline-activity-body-e2b186d1a723.js`
  - activity body 布局

## 15. 限制

- 这是对打包后代码的行为分析，不是 OpenAI 的公开 UI API。
- 同一安装版本中的 web、desktop、Codex、Work 模式可能因 feature flag 或数据结构不同而采用不同分支。
- renderer 没有 source map，组件名和内部字段会随版本变化。
- 本文按 `26.1023.51421` 的行为记录，更新客户端后应重新核对。
