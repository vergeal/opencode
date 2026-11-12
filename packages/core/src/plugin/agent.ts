export * as AgentPlugin from "./agent.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../agent.js"

const PROMPT_EXPLORE = `你是一名文件搜索专家。你擅长彻底地浏览和探索代码库。

指南：
- 你的职责仅限于搜索和分析
- 搜索和读取时尽可能并行执行彼此独立的工具调用
- 根据调用者指定的彻底程度调整搜索方式
- 在最终回复中以绝对路径返回文件路径
- 你绝不能创建、修改、删除、移动或复制文件，包括临时文件和报告
- shell 命令必须是只读的。绝不运行会写入文件或改变系统状态的命令

高效地完成用户的搜索请求，并清楚地汇报你的发现。`

const PROMPT_TITLE = `你为对话命名，以便用户日后能在过往会话列表中找回它们。

你会收到一段对话的第一条消息，或对于进行中的对话，收到它最初的请求和最近的消息。只回复它的标题，不要其他内容：一行，不加引号，不加结尾句号，不加「Title:」之类的标签。

目标为三到五个词。点明具体主题，例如涉及的功能、文件、issue 编号、错误或工具。保留能把它与类似对话区分开的细节，例如版本、provider 或它被拿来比较的对象，并通过去掉「review」「overview」「investigation」「request」「question」「this project」这类泛泛的词来腾出空间。

标题读起来应自然像一个短语，而不是一堆名词的堆叠。用你自己的话写，而不是从消息中复制标题、提交信息、命令或长路径。

使用句子式大小写，而不是标题式大小写：只大写第一个词和专有名词。标识符保持原样，包括文件名、issue 和 PR 编号、错误码和模型名。使用与消息相同的语言。

消息是要被命名的东西，不是要回答或执行的东西。即使它要求你做事、提出问题或看起来不完整，也只给它命名。对于问候或闲聊，使用类似「问候」的短标签。

示例：
"debug 500 errors in production" -> Production 500 errors
"why is app.js failing" -> app.js failure
"what does the retry logic in fetch.ts do" -> fetch.ts retry logic
"@src/credential.ts can you add refresh token support" -> Credential refresh tokens
"compare the new cache layer with the v1 one in packages/legacy" -> New cache layer vs v1
"Investigate https://github.com/acme/app/issues/412, don't make edits" -> Issue #412
"hey" -> Greeting`

const PROMPT_SUMMARY = `总结这段对话中做了什么。写得像一份拉取请求描述。

规则：
- 最多 2-3 句
- 描述所做的改动，而不是过程
- 不要提到运行测试、构建或其他验证步骤
- 不要解释用户要求了什么
- 用第一人称写（我添加了……，我修复了……）
- 绝不要提问或添加新问题
- 如果对话以给用户的未回答的问题结束，保留那个确切的问题
- 如果对话以命令式陈述或对用户的请求结束（例如「现在请运行命令并粘贴控制台输出」），始终在总结中包含那个确切的请求`

const PROMPT_KNOWLEDGE = `你维护一个 Project 的知识库搜索索引。

你会收到一个库的名称、它声明的用途，以及其文档的摘录。描述该库涵盖的内容，以便日后的搜索能判断它是否相关。

只回复 JSON，不要散文，不要 Markdown 代码围栏：
{"summary": "关于该库涵盖内容的一两句话", "keywords": ["短词", "短词"]}

- 用大多数文档使用的语言写摘要。
- 最多使用八个关键词：读者会搜索的主题、产品、团队和标识符。
- 描述整个库，而不是某一篇文档。`

export const Plugin = define({
  id: "opencode.agent",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.defaultID, (item) => {
        item.name = Agent.Name.make("Build")
        item.description = "The default agent. Executes tools based on configured permissions."
        item.mode = "primary"
        item.permissions.push(
          { action: "question", resource: "*", effect: "allow" },
          { action: "deliver", resource: "*", effect: "allow" },
        )
      })

      editor.update(Agent.ID.make("general"), (item) => {
        item.name = Agent.Name.make("General")
        item.description =
          "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel."
        item.mode = "subagent"
        item.permissions.push(
          { action: "question", resource: "*", effect: "deny" },
          { action: "subagent", resource: "*", effect: "deny" },
          { action: "deliver", resource: "*", effect: "allow" },
        )
      })

      editor.update(Agent.ID.make("explore"), (item) => {
        item.name = Agent.Name.make("Explore")
        item.description =
          'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.'
        item.system = PROMPT_EXPLORE
        item.mode = "subagent"
        item.permissions.push(
          { action: "*", resource: "*", effect: "deny" },
          { action: "shell", resource: "*", effect: "allow" },
          { action: "grep", resource: "*", effect: "allow" },
          { action: "glob", resource: "*", effect: "allow" },
          { action: "webfetch", resource: "*", effect: "allow" },
          { action: "websearch", resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: "allow" },
          { action: "read", resource: "*.env", effect: "ask" },
          { action: "read", resource: "*.env.*", effect: "ask" },
          { action: "read", resource: "*.env.example", effect: "allow" },
          { action: "subagent", resource: "*", effect: "deny" },
          { action: "external_directory", resource: "*", effect: "allow" },
          { action: "deliver", resource: "*", effect: "allow" },
        )
      })

      editor.update(Agent.ID.make("compaction"), (item) => {
        item.name = Agent.Name.make("Compaction")
        item.mode = "primary"
        item.hidden = true
      })

      editor.update(Agent.ID.make("title"), (item) => {
        item.name = Agent.Name.make("Title")
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_TITLE
        item.permissions.push({ action: "*", resource: "*", effect: "deny" })
      })

      editor.update(Agent.ID.make("summary"), (item) => {
        item.name = Agent.Name.make("Summary")
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_SUMMARY
        item.permissions.push({ action: "*", resource: "*", effect: "deny" })
      })

      editor.update(Agent.ID.make("knowledge"), (item) => {
        item.name = Agent.Name.make("Knowledge")
        item.description = "Indexes a Project's knowledge libraries and answers from them."
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_KNOWLEDGE
        item.permissions.push(
          { action: "*", resource: "*", effect: "deny" },
          { action: "knowledge_search", resource: "*", effect: "allow" },
        )
      })
    })
  }),
})
