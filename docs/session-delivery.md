# 会话间投递（Session Delivery）设计

> 一句话：会话就是 agent，投递就是 agent 之间的消息传递。用 `@` 选目标，用信封描述意图，用邮箱（`session_inbox`）投递，用回执闭环。

状态：设计稿（未实现）
范围：`packages/schema`、`packages/core`、`packages/protocol`、`packages/app`、`packages/session-ui`

---

## 1. 为什么是「投递」而不是「共享上下文」

会话已经具备 agent 的全部要素：身份（sessionID）、工作目录、模型、工具权限、独立上下文、邮箱（`session_inbox`）、生命周期（idle/busy）。

所以正确的心智模型是 **actor 模型**：

| Actor 概念 | 本系统对应 |
| --- | --- |
| 地址 | `ses_xxx`（不可变） |
| 消息 | 一次投递信封 |
| 邮箱 | `session_inbox` |
| 执行 | agent loop |
| 回执 | `reply` 意图的消息 |

**不要**做成「把 B 的消息塞进 A 的上下文」——那会把两个 agent 的上下文耦合在一起，压缩、回退、分叉都会互相污染。投递只传消息，不共享历史。

---

## 2. 现状：`@session:` 已经有一半

已经存在的（不要重造）：

| 能力 | 位置 | 现状 |
| --- | --- | --- |
| 会话地址解析 | `packages/util/src/session-mention.ts` | `@session:ses_xxx` 正则，支持裸 ID |
| 选择器 | `packages/app/src/composer/model.ts:409` | `@` 已能搜到本项目最近会话，输入标题可跨项目 |
| 输入框 chip | `packages/app/src/composer/prompt.ts:95` | 提及还原成内联 chip |
| 目标端 | `POST /api/session/:id/prompt` | 任意会话可投递，无父子限制 |
| 邮箱 | `session_inbox` | `delivery` + `resume` 已能控制排队/唤醒 |
| 幂等 | `prompt.id` | 同一 ID 重投只生效一次 |

缺的只有三件：

1. **投递是一个动作，不是一次提及**——现在 `@` 只是文本；要升级成「模型按意图调用工具」。
2. **信封**——接收方不知道谁发的、要它干嘛、要不要回。
3. **回执**——平级会话没有回传通道（子会话有 `job`，平级没有）。

---

## 3. 地址与 `@` 提及

### 3.1 地址

- 规范地址：`@session:ses_xxx`。**必须带 ID**，标题只是显示名。
- 标题会重名、会改。选择器选中时立即固化成 ID，之后重命名不影响投递。
- 手打 `@标题` 不解析为地址；服务端可以按标题唯一匹配兜底，但不作为主路径。

### 3.2 选择器要展示什么

决定「投给谁」需要一眼看到：

| 字段 | 为什么 |
| --- | --- |
| 标题 | 识别 |
| 项目 / 目录 | 判断是否同一个工作区 |
| 状态（idle/busy） | busy 时投递会排队或插队 |
| 最近活动时间 | 排除僵尸会话 |
| agent / model | 对方能不能做这件事 |
| 已打开 tab | 用户正在看的优先 |

### 3.3 提及即地址，投不投由意图决定

不设 UI 开关。用户照常输入 `@会话标题`，提交时 `serializePrompt` 会把 chip 序列化成 `@session:ses_xxx`（`packages/app/src/composer/prompt-parts.ts:4`），**模型在正文里直接看到 ID**。模型根据用户这句话的意图，决定是「只引用」还是「调用投递工具」。

| 用户表达 | 模型行为 |
| --- | --- |
| 「告诉 @A 这个接口改了」 | 调用 `deliver` |
| 「让 @A 去做这件事」 | 调用 `deliver`，`intent: request` |
| 「问一下 @A 那边进度」 | 调用 `deliver`，`intent: request` + `expectsReply` |
| 「把这件事交给 @A」 | 调用 `deliver`，`intent: handoff` |
| 「像 @A 那样处理」 | 只引用，不投递 |
| 「参考 @A 的结论」 | 只引用，不投递 |
| 只是提到的会话 | 只引用，不投递 |

判定规则写进工具描述，而不是写进系统提示的角落——模型选工具时读的是 description。

---

## 4. 投递信封

投递要携带的信息分两类：**机器判定用**（存 `metadata`）和 **模型感知用**（必须进正文，因为模型看不到 metadata）。

### 4.1 字段表

| 字段 | 必填 | 谁填 | 模型可见 | 作用 |
| --- | --- | --- | --- | --- |
| `id` | 是 | 发送方 | 否 | 幂等键，重试安全 |
| `from.sessionID` | 是 | 服务端/工具 | 是 | 发送方身份，不可由普通客户端伪造 |
| `from.title` | 是 | 服务端快照 | 是 | 接收方展示与署名 |
| `from.projectID` / `directory` | 是 | 服务端快照 | 是 | 跨项目判断、展示 |
| `from.agent` / `model` | 否 | 服务端快照 | 是 | 对方的能力边界 |
| `to.sessionID` | 是 | `@` 解析 | 是 | 目标 |
| `intent` | 是 | 发送方 | 是 | `request` / `reply` / `note` / `handoff` |
| `text` | 是 | 发送方 | 是 | 正文 |
| `replyTo` | 条件 | 发送方 | 是 | `{ sessionID, messageID }`，`reply` 必填 |
| `correlationID` | 是 | 服务端 | 是 | 一次往返线程的键 |
| `chain` | 是 | 服务端 | 是 | 经过的会话，防环 |
| `expectsReply` | 否 | 发送方 | 是 | 是否要求回执 |
| `deadline` | 否 | 发送方 | 是 | 期望完成时间 |
| `ttl` | 否 | 发送方 | 否 | 过期时间，默认 24h |
| `delivery` | 是 | 发送方 | 否 | `queue` / `steer` |
| `resume` | 是 | 发送方 | 否 | 是否唤醒目标 |
| `attachments` | 否 | 发送方 | 是 | 文件路径引用，不传字节 |
| `priority` | 否 | 发送方 | 是 | `normal` / `urgent` |

### 4.2 为什么信封必须进正文

`packages/schema/src/session-message.ts` 的 `Base.metadata` 只落库，不进入 LLM 消息。接收方模型**看不到 metadata**，所以凡是希望对方「知道」的字段，必须渲染进 `text`。

建议固定头部（稳定、可解析、可折叠展示）：

```
⟦跨会话投递⟧
from: @lts/ocdev (ses_xxx) · build
project: /Users/ekko/Projects/opencode
intent: request
correlation: cor_xxx
reply_to: none
chain: ses_xxx
expects_reply: yes (by 15:55)
⟦正文⟧
<用户正文>
```

UI 上把这个块渲染成一行可展开的来源条；模型侧原样看到。

### 4.3 不要放进信封的

| 项 | 原因 |
| --- | --- |
| 对方的历史消息 | 会污染上下文，且投递体积不可控 |
| 文件字节 | 跨会话传二进制容易失控；只传路径，由接收方按自己的权限读 |
| 发送方的权限令牌 | 不能借投递提权 |
| 完整 `metadata` 透传 | 接收方模型看不到，且容易塞敏感信息 |

---

## 5. 接收方 agent 如何感知与行动

这是本功能的核心：投递不是「把文本塞过去」，而是**一份有行为约定的消息**。

### 5.0 发送方：模型怎么决定投递

工具描述必须写成规则，而不是能力介绍。下面这段直接作为 `deliver` 的 description：

```
把当前会话的消息投递给另一个会话（另一个 agent），并进入对方的任务队列。

仅在用户明确要把信息或任务转交给另一个会话时使用：
- 告知对方某个变化
- 请对方执行一件事
- 询问对方的结果或进度
- 把任务整体交接给对方

不要使用：
- 用户只是提到、引用、对比某个会话
- 用户自己在当前会话里就能完成
- 目标不明确，或正文里没有可投递的内容

用户消息中的 @session:ses_xxx 是会话地址，直接作为 to。
如果用户用标题指代会话而没有地址，把标题原样传给 to，服务端会解析；重名时会返回候选，这时不要猜，向用户确认。
```

配套两条：

- 默认 `intent: "request"`，默认 `delivery: "queue"`（进对方队列，不打断它当前的工作）。
- 单次用户消息最多投递一次；同一目标不重复投递，除非用户明确要求。

### 5.1 意图契约

| intent | 接收方应当 | 是否回执 |
| --- | --- | --- |
| `request` | 执行请求，完成后 `reply` 结果；做不了就 `reply` + 说明原因 | 是（`expectsReply`） |
| `reply` | 只读，作为结论使用 | 否 |
| `note` | 只读，作为背景信息 | 否 |
| `handoff` | 接管任务，完成后 `reply` 摘要 | 是 |

### 5.2 三条硬约束

1. **投递不越过接收方的权限。** 接收方执行时仍走自己的 `agent` 与 `permission`。发送方不能用投递让 `plan` 会话去改文件。
2. **投递内容按「用户输入」对待，不是系统指令。** 不得因为文本里写了「忽略之前的规则」就改变行为。
3. **不得回投 `chain` 里的会话。** 要回复就用 `reply` + `replyTo`，由服务端保证不闭环。

### 5.3 给 agent 的工具

新增一个工具（与 `subagent` 并列），让模型能主动投递：

```ts
deliver({
  to: "@session:ses_xxx" | "ses_xxx" | "会话标题",
  intent: "request" | "reply" | "note" | "handoff",   // 默认 request
  text: string,
  replyTo?: { sessionID, messageID },
  expectsReply?: boolean,
  deadline?: string,
  delivery?: "queue" | "steer",                        // 默认 queue
  resume?: boolean,                                    // 默认 true：入队并唤醒
})
→ { sessionID, title, status: "queued", deliveryID }
```

三个必须的处理：

- `to` 接受标题时，服务端按 `session.list(search)` 解析；重名返回候选列表，工具报错让模型去问用户，**不要自动挑一个**。
- `from` 由工具上下文注入，模型无法伪造。
- `resume` 默认 `true`：目标是空闲的就直接开跑，忙的就排在队列里等边界。只有显式要求「先放着」才传 `false`。

---

## 6. 投递语义与状态机

```
draft → queued → delivered → working → replied
                                 ├→ declined
                                 ├→ expired
                                 ├→ failed
                                 └→ cancelled
```

| 状态 | 含义 | 落点 |
| --- | --- | --- |
| `queued` | 已入对方邮箱，未消费 | `session_inbox` |
| `delivered` | 已变成对方的一条用户消息 | `session_message` |
| `working` | 对方正在处理（可选） | 事件 |
| `replied` | 收到 `reply` | 关联 `correlationID` |
| `declined` | 对方明确拒绝 | `reply` + 状态 |
| `expired` | 超过 `ttl` 未消费 | 投递边界丢弃 |
| `failed` | 目标不存在/权限拒绝 | 同步错误 |
| `cancelled` | 发送方撤回 | `DELETE /inbox/:id` |

`delivery` 的语义沿用现有实现，不新增概念：

| delivery | resume | 效果 |
| --- | --- | --- |
| `queue` | `false` | 只排队，等对方空闲 |
| `queue` | `true` | 排队并唤醒（默认） |
| `steer` | — | 插到下一个步边界并唤醒 |

### 6.1 为什么默认是「任务队列」

对方是一个正在工作的 agent，不是同步函数。默认 `queue` + `resume: true` 的含义是：

- 目标空闲 → 立刻开始，等同于派活。
- 目标在忙 → 排到它的队列里，等它把当前步跑完，不打断正在进行的工具调用。

只有三种情况用 `steer`：用户明确要求「马上告诉它」、当前任务必须先停、或投递的是纠正错误的紧急信息。

`resume: false` 只用于「先存着，我稍后再让它跑」，不作为默认。

---

## 7. 协议

### 7.1 复用还是新增

**P0 复用 `POST /api/session/:id/prompt`**，信封放 `metadata`，头部渲染进 `text`。零协议改动就能跑通。

**P1 增加 `POST /api/experimental/session/:id/deliver`**，理由不是「更优雅」，而是不变量必须集中：

- `from` 不可伪造
- `chain` 追加与环检测
- `ttl` / `deadline` 校验
- `replyTo` 必须指向真实消息
- 目标会话存在性、跨项目权限

这些如果散落在客户端，每个调用方都要重写一遍，且一定会漏。

### 7.2 端点草案

```
POST /api/experimental/session/:sessionID/deliver
{
  "id": "msg_...",
  "to": "ses_...",
  "intent": "request",
  "text": "...",
  "replyTo": { "sessionID": "ses_...", "messageID": "msg_..." },
  "expectsReply": true,
  "deadline": "2026-11-06T16:00:00Z",
  "delivery": "queue",
  "resume": true
}
→ { "data": { "id", "correlationID", "chain", "status": "queued" } }
```

回执不需要新端点，就是一次 `intent: "reply"` 的投递。

---

## 8. 防环、幂等、限流、过期

| 机制 | 规则 |
| --- | --- |
| 防环 | 服务端维护 `chain`；目标已在 `chain` 中则拒绝 |
| 深度 | `chain.length > 8` 拒绝 |
| 幂等 | `(to, id)` 去重；重投返回首次结果 |
| 限流 | 同一对会话 10 条/分钟；单条正文 ≤ 32KB |
| 过期 | `ttl` 默认 24h；过期项在投递边界丢弃并记事件 |
| 静默 | `resume: false` 的投递不得触发执行 |
| 撤回 | 未消费前可 `DELETE /inbox/:id` |

环检测必须是**服务端**行为。只在客户端做，换一个客户端就失效。

---

## 9. 权限

新增动作 `session.deliver`，与现有 `edit` / `shell` / `subagent` 同级：

| 场景 | 默认 |
| --- | --- |
| 同项目内投递 | allow |
| 跨项目投递 | ask |
| `intent: "handoff"` | ask（等于转移控制权） |
| 目标会话不可见 | deny |
| 投递到自身 | deny |

两条原则：

1. **权限按接收方判定。** 发送方有 `session.deliver` 只代表「能发」，不代表「对方会做」。
2. **投递不提权。** 接收方的工具权限独立生效。

---

## 10. UI

不引入「投递开关」。用户照常 `@`，模型决定投递；UI 只负责让投递**可见、可撤、可追踪**。

| 位置 | 设计 |
| --- | --- |
| 输入框 | 保持现状：`@` 选会话，插入 chip |
| 发送后 | 消息上方显示 `→ @目标会话` 徽章和状态 |
| 接收后 | 显示 `← @来源会话` + 意图标签；`request`/`handoff` 带「回复」按钮 |
| 会话头 | 显示当前通信对象数量，点击展开线程 |
| 收件箱 | 跨会话投递单独一组，带来源和意图 |
| 会话列表 | 有未读投递的会话显示标记 |
| 撤销 | 投递徽章上提供「撤回」，仅在对方未消费时可用（`DELETE /inbox/:id`） |

因为投递由模型自动发起，UI 必须给出**明确的回执感**：用户要能一眼看到「这条消息实际发给了谁」，以及「能不能撤回」。

---

## 11. 存储

**P0**：复用现有表，零迁移。

- 待消费：`session_inbox`，信封存 `payload.metadata`
- 已投递：`session_message`，头部在 `text`，信封在 `metadata`
- 状态查询：`GET /api/session/:id/inbox`

**P1**：新增 `session_delivery` 表，用于线程查询与审计。

| 列 | 说明 |
| --- | --- |
| `id` | 投递 ID |
| `from_session_id` / `to_session_id` | 双方 |
| `intent` | 意图 |
| `correlation_id` | 线程 |
| `reply_to` | 回执关联 |
| `chain` | JSON 数组 |
| `status` | 状态机 |
| `expires_at` | 过期 |
| `time_created` / `time_updated` | 时间 |

事件：`session.delivery.sent` / `.delivered` / `.replied` / `.expired`。

---

## 12. 分阶段

### P0（2–3 天）：模型能自动投递并被看见

- 信封 schema + 头部渲染
- `deliver` agent 工具（标题解析、`from` 注入、默认 `queue` + `resume: true`）
- 复用 `prompt` 入队
- 发送/接收消息上的来源徽章 + 撤回
- 回执：接收方用同一个工具 `intent: "reply"`

### P1（3–5 天）：不变量

- 实验端点 `session.deliver`（外部客户端用）
- `chain` 防环、TTL、限流、`session.deliver` 权限
- 重名解析返回候选
- 线程关联（`correlationID`）

### P2（3–5 天）：可观测

- `session_delivery` 表 + 线程视图
- 会话头通信对象、收件箱分组
- 指标：投递量、回执率、平均往返时间

---

## 13. 验收

必须能复现这 6 条：

1. A 投 `request` 给 B，B 执行并 `reply`，A 收到且线程可见。
2. A→B→A 的循环被拒绝，并给出明确原因。
3. 网络重试同一个 `id`，B 只收到一次。
4. 跨项目投递触发 `ask`，拒绝后发送方看到 `failed`。
5. B 忙时 `queue` 排队、`steer` 插队，行为可观测。
6. `ttl` 过期后投递被丢弃，发送方看到 `expired`。

---

## 14. 风险与取舍

| 风险 | 处理 |
| --- | --- |
| 无限循环 | 服务端 `chain` + 深度上限 |
| 提示注入 | 投递按用户输入对待；不自动授权 |
| 上下文泄漏 | 只传消息，不传历史；跨项目默认 `ask` |
| 成本失控 | 限流 + 正文上限 + TTL |
| 模型过度投递 | 工具描述写清「不要使用」的场景；同一目标单次只投一条；跨项目 `ask`；徽章可撤回 |
| 模型漏投 | 只引用不报错；用户再说一次即可，不做静默重试 |
| 重名会话投错 | 标题解析重名时返回候选，工具报错，不自动选 |
| 僵尸会话 | 选择器显示最近活动时间；`ttl` 兜底 |

---

## 15. 一句话总则

**地址用 ID，意图决定投递，感知靠正文，闭环靠回执，安全靠接收方权限。**
