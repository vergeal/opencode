# 项目知识库索引开发推进文档

来源需求：项目设置里把知识库关联到项目；项目会话异步用零成本小模型检索知识库、生成索引并随内容变更同步；主会话不检索，避免污染上下文。

---

## 1. 现状与约束

- 知识库目前是**桌面端功能**：元数据存在 app 的持久化存储（`knowledge/store.ts`），正文由桌面主进程保存，通过 `listKnowledgeFiles` / `readKnowledgeFile` 读取。
- 会话、工具与索引跑在**服务器**侧，读不到桌面存储，所以正文必须同步到后端。
- 后端已有 `Project`（SQLite 表、`prompt` 字段）、`Session`（可指定 `agent` / `model`、`generate` 不写历史）、`Model.available()`（含成本）。
- 项目设置已能按 `project.id` 读写项目级数据（`settings/workspaces/project.tsx`）。

## 2. 功能列表

| 编号 | 功能 | 解决什么问题 | 优先级 |
| --- | --- | --- | --- |
| K1 | 项目设置新增「知识库」区块 | 让项目拥有自己的知识库集合 | P0 |
| K2 | 从全部知识库中关联 / 解除关联 | 同一份知识库可服务多个项目 | P0 |
| K3 | 展示文档数、索引状态、索引模型、索引时间 | 用户知道知识库是否可用 | P0 |
| K4 | 桌面端把正文同步到后端 | 服务器会话能检索 | P0 |
| K5 | 服务器切块并建立可检索索引 | 检索不依赖外部向量服务 | P0 |
| K6 | 关联或内容变化后自动重建索引 | 内容更新后检索结果不过期 | P0 |
| K7 | 零成本小模型生成库摘要与关键词 | 索引可读、检索更准；无零成本模型时回退默认模型 | P0 |
| K8 | 仅索引会话可用的 `knowledge_search` 工具 | 主会话不检索，避免无关片段污染上下文 | P0 |
| K9 | 索引失败可见并可重试 | 失败不静默 | P0 |
| K10 | 相关片段回链到文档路径 | 模型能说明出处 | P1 |
| K11 | 增量同步（只传变化的文档） | 大库同步更快 | P1 |
| K12 | 向量检索 | 语义召回 | P2 |

## 3. 数据模型（后端 SQLite）

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `knowledge_library` | `library_id` PK、`name`、`description`、`summary`、`keywords`、`status`、`model`、`document_count`、`chunk_count`、`indexed_at`、`time_created/updated` | 库的索引状态 |
| `knowledge_document` | `(library_id, path)` PK、`name`、`kind`、`size`、`hash`、`text` | 桌面端同步来的正文 |
| `knowledge_chunk` | `id`、`library_id`、`path`、`ordinal`、`text` | 检索单元，约 1000 字符、100 字符重叠 |
| `project_knowledge` | `(project_id, library_id)` PK、`time_created` | 项目关联 |

`status`：`empty`（无文档）、`indexing`、`ready`、`failed`（摘要失败，可再次同步重试）。`stale` 预留给后续增量同步。索引任务随进程结束而中断，服务启动时会把遗留的 `indexing` 改为 `failed`，避免设置页一直轮询。

## 4. API

全部在 `/api/experimental/knowledge` 下（实验性，可能变更）：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/experimental/knowledge` | 列出全部库及其索引状态 |
| `PUT` | `/api/experimental/knowledge/:libraryID` | 同步库元数据与文档，内容变化或失败重试时重建索引 |
| `DELETE` | `/api/experimental/knowledge/:libraryID` | 删除库的服务器副本 |
| `GET` | `/api/experimental/knowledge/assigned/:projectID` | 列出项目关联的库 |
| `PUT` | `/api/experimental/knowledge/assigned/:projectID/:libraryID` | 关联；首次关联或缺少模型时触发索引 |
| `DELETE` | `/api/experimental/knowledge/assigned/:projectID/:libraryID` | 解除关联（保留服务器副本与索引） |

检索不开放 HTTP，只作为工具暴露给知识库索引会话。

## 5. 索引与检索

### 同步

1. 桌面端读取库内每个文件的正文（`readKnowledgeFile`）。
2. `PUT` 上传 `{ name, description, documents: [{ path, name, kind, size, text }] }`。
3. 服务器按 `hash` 对比：正文未变的库保留现有索引，不重复调用模型。
4. 正文变化或上次索引失败时重建 `knowledge_chunk`，状态置 `indexing`；无文档则为 `empty`。

### 小模型摘要

1. 在已启用模型里挑**零成本 chat 模型**：`cost` 中 `input` 与 `output` 都为 0；找不到回退 `Model.default()`。
2. 创建一个隐藏的 `knowledge` agent 会话（不挂在任何用户会话下），用该模型 `generate` 一次，输入是库名、描述与文档标题 + 片段。
3. 只接受 `{ "summary": string, "keywords": string[] }`；模型不可用或摘要写入失败时把库标为 `failed`，确定性切块仍可检索，再次同步或重新关联会重试。
4. 实际使用的模型写入 `knowledge_library.model`，设置页展示。

### 检索

- `knowledge_search` 只对 `agent === "knowledge"` 的会话开放；其他 agent 调用直接失败，主会话也不会收到任何自动注入的片段。
- 输入 `{ query, limit? }`，按会话所属项目取关联库的 chunks。
- 打分：query 按空白切词，中文补充二元组；命中 token 越多分越高，返回 top N（默认 6）片段与文档路径。

### 实时同步

- 桌面端：知识库导入 / 删除文件后，若该库在服务器已有副本（即曾被项目关联），自动重新上传并重建索引；未关联的库只留在本地。
- 删除知识库时删除服务器副本；在项目设置里提供手动「同步」，用于内容修正或失败重试。
- 项目设置关联时先 `assign` 再上传正文，首次索引因此能拿到项目自己的模型偏好。

## 6. 前端

- `packages/app/src/knowledge/sync.ts`：读取桌面正文 → 调用 `PUT`；Web 端或缺少文件读取能力时不可用。
- 项目设置「知识库」区块：列出全部本地库，开关关联；显示文档数、状态、实际模型、索引时间；关联时先上传再写入关联，支持手动同步与解除。索引中每 3 秒刷新一次状态。
- 桌面端知识库页：导入与删除后，仅对服务器已有副本的库自动重新同步。
- 文案走 i18n（`en` + `zh`），新增 `project.settings.knowledge.*`。

## 7. 验收

- 在项目设置关联一个知识库后，状态从 `indexing` 变为 `ready`，文档数与模型可见。
- 关闭 `experimental.schedules` 不影响知识库。
- 主会话的工具列表里没有 `knowledge_search`；索引会话可以检索并拿到路径。
- 更新桌面知识库内容后重新同步，检索结果随之变化。
- 无零成本模型时回退默认模型，并在设置里显示实际模型；索引失败时状态为 `failed`，再次同步可重试。

## 8. 分期

- P0：K1–K9。
- P1：K10–K11（路径回链已包含在 P0 结果里，增量同步与失败重试细化）。
- P2：K12（向量检索）。
