# 桌面端三栏 UI 1:1 复刻需求文档

状态：待开发
来源：`/Users/ekko/Downloads/ChatGPT-Work-Electron-UI-1to1-Design-Spec.md`
目标会话：`ses_e64812c14ffdCHzXmm40sQaCH7`
工作分支：`lts/ocdev`
工作目录：`/Users/ekko/Projects/opencode`

---

## 0. 已确认的决策

| 决策 | 结论 |
| --- | --- |
| 复刻范围 | **重写三栏壳**，替换现有标签页布局 |
| 颜色与字体 | **严格按设计文档**，可偏离 `packages/app/AGENTS.md` 的字体与 token 规范 |
| 与收件箱的关系 | **先做复刻骨架**，收件箱 T6 侧栏改造等骨架完成后再做 |

第 2 条是用户明确确认的偏离项。实现时不要再用「仓库规范不允许」为由改回 Inter 或现有 `--v2-*` 色值。

---

## 1. 目标与范围

### 1.1 目标

按设计文档复刻截图默认态，做到几何和视觉 1:1：

1. 顶部 macOS 标题栏
2. 最左一级导航栏 36px
3. 中间项目/会话侧栏 239px
4. 右侧纯白主工作区
5. 欢迎标题 + 输入卡片 + 下方快捷栏

### 1.2 不做

- 对话消息流
- 设置页
- 菜单展开、弹窗
- 截图里没有的仪表盘、卡片网格、渐变
- 截图上的红色数字 `1 / 2 / 3`

### 1.3 数据原则

- 项目、会话、工作区名称用**真实数据**，不要把截图里的示例项目硬编码。
- 文案走 i18n，中文值按设计文档，英文值补对应翻译。
- `ChatGPT Work` 作为产品名保留，不翻译。

---

## 2. 几何规格

基准窗口：**1000 × 463 CSS px**（截图 2000×926，DPR 2）。

| 项 | 值 |
| --- | ---: |
| 标题栏高度 | 27px |
| 一级导航栏宽度 | 36px |
| 侧栏宽度 | 239px（默认固定，可允许拖动） |
| 主工作区 | `minmax(0, 1fr)` |
| 侧栏与主区边界 | 1px |
| 欢迎区中心轴 | 主工作区左边界向右 63% |
| 输入框宽度 | 440px，`min(440px, calc(100% - 32px))` |
| 输入卡片高度 | 68px |
| 输入卡片圆角 | 14px |
| 底部快捷栏高度 | 25px |
| 欢迎标题字号 | 19–20px / 500 |
| 欢迎标题与输入框间距 | 17–22px |

硬要求：

- 主工作区必须 `min-width: 0`。
- 欢迎内容不能用主工作区 `justify-content: center` 得到错误位置。
- 窗口变宽时输入框不跟着无限拉宽。
- 侧栏内容独立滚动，顶部工作区栏固定。

---

## 3. 颜色 Token

严格使用设计文档的值，新增一套复刻 token。不要映射到现有 `--v2-*`。

```css
--app-chrome: #F3F5F4;
--rail-bg: #F0F2F1;
--sidebar-bg: #FAFCFB;
--main-bg: #FFFFFF;
--surface-muted: #F3F5F4;
--surface-hover: #F1F3F2;
--surface-selected: #EDEFEF;
--border-subtle: #E9ECEA;
--text-primary: #242625;
--text-secondary: #727875;
--text-tertiary: #AEB4B1;
--icon-primary: #242725;
--icon-secondary: #858B87;
--accent-warning: #F05B24;
--status-blue: #65B5F5;
--send-button-bg: #929695;
--send-button-fg: #FFFFFF;
```

规则：

- 主工作区纯白，不套灰卡片。
- 边框 1px，禁止黑色描边。
- 悬停/选中只比底色深少量，不用品牌色整块填充。
- 橙色只用于「完全访问」等状态。
- 不使用渐变、玻璃拟态、霓虹、重阴影。

深色模式：设计文档没有定义。P0 只保证浅色 1:1；深色沿用现有深色 token 兜底，不阻塞 P0，但切换深色时不能出现白底黑字的割裂。

---

## 4. 字体

严格使用系统字体栈：

```css
font-family:
  -apple-system,
  BlinkMacSystemFont,
  "SF Pro Text",
  "SF Pro Display",
  "PingFang SC",
  "Hiragino Sans GB",
  "Microsoft YaHei",
  sans-serif;
```

这偏离 `packages/app/AGENTS.md` 的字体角色规范，已由用户确认。实现时：

- 只在复刻壳内覆盖，不改全局字体设置的其他页面。
- 不新增 `@font-face`，不引入字体包。
- 中文回退必须正常，中英文字高一致。

字号：

| 场景 | 字号 / 字重 |
| --- | --- |
| 工作区名称 | 14px / 600 |
| 侧栏一级入口 | 13px / 400–500 |
| 区块标题 | 12px / 500 |
| 项目、会话名称 | 12–13px / 400 |
| 欢迎标题 | 19–20px / 500 |
| 输入占位 | 11–12px / 400 |
| 底部工具栏 | 10–11px / 400–500 |

---

## 5. 组件拆分与文件映射

| 设计组件 | 现有文件或新建 | 职责 |
| --- | --- | --- |
| `NativeTitleBar` | `shell/titlebar/titlebar.tsx` | 27px 标题栏、交通灯区域、前进/后退/侧栏切换、拖拽区 |
| `PrimaryRail` | 新建 `shell/rail/primary-rail.tsx` | 36px 一级导航 |
| `RailButton` | 新建 | 图标按钮、active/hover/disabled/tooltip |
| `Sidebar` | `shell/titlebar/sidebar-*` | 239px 容器、独立滚动 |
| `WorkspaceHeader` | 新建 `shell/titlebar/workspace-header.tsx` | 工作区名、通知点、搜索 |
| `NewChatEntry` | `shell/titlebar/titlebar.tsx` 内 | 28px 新聊天入口 |
| `SidebarSection` | 新建 | 置顶/项目分区 |
| `ProjectTree` | `shell/titlebar/sidebar-sessions.ts` 或新建 | 项目与展开层级 |
| `ConversationItem` | 新建 | 会话行、选中、hover、pinned、more |
| `MainWorkspace` | `shell/shell.tsx` | 主内容画布 |
| `WelcomeView` | `new-session/` 或新建 | 欢迎页与锚点 |
| `Composer` | `composer/` | 输入卡片 + 工具栏 |
| `ComposerUtilityBar` | `composer/` | 项目/插件/设备快捷入口 |

每个组件只控制自己的布局和状态，不把侧栏、输入框、主区塞进一个超大组件。

---

## 6. 关键视觉细节

### 6.1 标题栏

- 背景 `--app-chrome`，高度 27px。
- 交通灯直径约 9px，间距 6px。
- 右侧依次：后退、前进、侧栏切换，图标约 14px，热区 24–28px。
- 拖拽区与可点击控件分离：

```css
.titlebar-drag-region { -webkit-app-region: drag; }
.titlebar-control { -webkit-app-region: no-drag; }
```

- 不让网页内容覆盖交通灯区域。

### 6.2 一级导航

- 宽度 36px，图标列，无标题文字。
- 激活态 24×24 浅灰圆角热区。
- 入口顺序：首页、历史、探索、更多。
- 状态：默认灰、悬停变深 + 浅灰底、激活深色 + 浅灰底。

### 6.3 侧栏

- 顶部工作区栏 32–36px：`ChatGPT Work` + 下箭头，右侧通知铃铛（蓝点）和搜索。
- 新聊天：28px，左侧编辑图标，文字「新聊天」，悬停才出底色。
- 置顶区：标题 12px/500，纯文本行，行高 20–22px，超长省略。
- 项目区：文件夹图标 14px，行高 21–23px，展开项缩进 15px。
- 会话行：无文件夹图标，单行截断，行高 24px，hover/选中浅灰圆角，选中时右侧出更多和图钉。
- 滚动条 3–4px，浅灰胶囊，轨道透明。

### 6.4 欢迎页

- 背景纯白，无面包屑、无页头、无卡片容器。
- 标题「我们要做什么？」，19–20px / 500，与输入框同轴。
- 锚点：主工作区内部 63%，垂直参考 58%，用 `translate(-50%, -50%)` 校准。
- 不添加副标题、插画、欢迎卡片。

### 6.5 输入组件

上卡：

- 纯白、1px `--border-subtle`、14px 圆角、内边距 10px。
- 占位「使用 ChatGPT Work」，`--text-tertiary`，11–12px。
- 工具行：`+`、橙色盾牌、`完全访问`、模型选择、下箭头、圆形发送按钮。
- 发送按钮 19–20px，`#929695`，白色向上箭头；空输入禁用。

下栏：

- `--surface-muted`，12–14px 圆角，与上卡视觉连续。
- 左侧文件夹 + 当前项目名，中间插件入口，右侧设备图标 `margin-left: auto`。
- 不加多余快捷键说明、状态标签。

---

## 7. 与收件箱任务的关系

- 本任务**优先**：先完成三栏骨架。
- 收件箱 P0 的 T6（侧栏三段式）暂停，等骨架完成后在新壳上做。
- 收件箱的数据模型、聚合、列表、详情逻辑不受影响，不要删除已有改动。
- 如果收件箱已经改了 `sidebar-nav.tsx`，复刻时以新骨架为准，保留其未读点能力，不要把未读逻辑一起删掉。

---

## 8. 施工顺序

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| S1 | 三栏骨架 + token + 27px 标题栏 | 三条分栏边界误差 ≤ 2px |
| S2 | 一级导航 36px + 侧栏工作区栏/新聊天 | 入口可点击，激活/悬停正确 |
| S3 | 项目树 + 会话行 | 缩进、行高、选中、截断正确 |
| S4 | 欢迎页 + Composer 上下两层 | 中心轴 63%、输入框 440px |
| S5 | 响应式 + 深色兜底 + 验收 | 缩窗不溢出，深浅色不割裂 |

每个阶段单独提交，便于回滚。

---

## 9. 验收

### 9.1 几何

- 三栏边界误差 ≤ ±2 CSS px。
- 输入框宽高误差 ≤ ±3 CSS px。
- 标题/输入框中心轴误差 ≤ ±4 CSS px。

### 9.2 方式

- 用 DOM 的 `getBoundingClientRect()` 和 `getComputedStyle()` 断言尺寸与颜色。
- **不要用视觉识别或截图识别判断完成。**
- 截图只作为交付物给用户看，不作为自动验收依据。
- 截图尺寸用 2000×926 物理像素或等效 Retina。

### 9.3 功能

- 侧栏项目/会话来自真实数据，不是硬编码。
- 新聊天入口能创建会话。
- 输入框能输入，发送按钮有禁用/激活态。
- 一级导航四个入口可点击，激活态正确。
- 长项目名、长会话名不撑破侧栏。
- 深色切换不出现白底黑字割裂。

---

## 10. 约束

- 不重启 app 或 server。
- 不在仓库根目录跑 `bun test`。
- 不新增依赖；图标用现有图标库。
- 不用 emoji 代替图标。
- 不把整张截图当背景图。
- 布局用 Grid/Flex，不靠大量绝对坐标拼接。
- 不做截图里没有的品牌红主按钮、分组卡片、渐变、插画。
- 保留现有路由、数据层和会话能力；这是视觉壳重写，不是功能删除。

---

## 11. 交付

- 在 `lts/ocdev` 分支提交，不 push。
- 按 S1–S5 分段提交，建议：
  1. `feat(app): add replica three-column shell`
  2. `feat(app): add replica primary rail and sidebar`
  3. `feat(app): add replica welcome composer`
  4. `style(app): finish replica responsive and dark fallback`
- 完成后向用户报告：commit hash、改动文件、几何实测值、未解决差异、风险点。
- 遇到与现有功能冲突，先说明再决定，不静默删功能。

---

## 12. 一句话总则

**几何按文档，颜色按文档，字体按文档；数据用真实的，功能不删，截图只给用户看。**
