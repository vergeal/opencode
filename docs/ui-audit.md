# UI 审计：按 `docs/opencode-ui-standard.md` 与 `docs/ui-acceptance-standard.md`

证据来源：仓库代码与 grep 输出（逐条带 `文件:行`）。**按本会话约束不做截图识别**，验收证据以代码行与命令输出为准。

统计：条目 **164**，TODO **11**，DONE **153**。类别分布：结构 45（TODO 0 / DONE 45）、状态 37（TODO 11 / DONE 26）、刻度 38（TODO 0 / DONE 38）、交互 44（TODO 0 / DONE 44）。

表内 `T` 为 TODO 数，`D` 为 DONE 数。

| 页面 | 结构 | 状态 | 刻度 | 交互 | 结论 |
| --- | --- | --- | --- | --- | --- |
| shell | T0 / D4 | T3 / D0 | T0 / D4 | T0 / D6 | 未达标 |
| home | T0 / D4 | T4 / D0 | T0 / D4 | T0 / D4 | 未达标 |
| inbox | T0 / D3 | T0 / D2 | T0 / D3 | T0 / D3 | 达标 |
| scheduled | T0 / D7 | T0 / D4 | T0 / D4 | T0 / D4 | 达标 |
| knowledge | T0 / D5 | T0 / D4 | T0 / D4 | T0 / D4 | 达标 |
| settings | T0 / D4 | T1 / D3 | T0 / D4 | T0 / D4 | 未达标 |
| servers | T0 / D4 | T0 / D4 | T0 / D3 | T0 / D4 | 达标 |
| workspaces | T0 / D4 | T0 / D3 | T0 / D3 | T0 / D4 | 达标 |
| new-session | T0 / D3 | T1 / D2 | T0 / D3 | T0 / D3 | 未达标 |
| session | T0 / D4 | T1 / D2 | T0 / D3 | T0 / D4 | 未达标 |
| composer | T0 / D3 | T1 / D2 | T0 / D3 | T0 / D4 | 未达标 |

## shell

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| SH-S1 | 结构 | 收件箱侧栏列表滚动容器补 `data-scrollable`，嵌套滚动可被外层识别 | 8 | packages/app/src/shell/titlebar/inbox.tsx:356 | DONE |
| SH-S2 | 结构 | 垂直标签条滚动区补 `data-scrollable` | 8 | packages/app/src/shell/titlebar/tab-strip.tsx:540 | DONE |
| SH-S3 | 结构 | 实测水平标题栏只有首页、搜索两个 icon 按钮，符合「最多 2 个 icon + 溢出菜单」 | 5.1 | packages/app/src/shell/titlebar/titlebar.tsx:354,379 | DONE |
| SH-S4 | 结构 | 归档会话弹窗改用 `size="large"`（640），删除内联宽度与圆角覆盖 | 5.6 | packages/app/src/shell/titlebar/inbox.tsx:755 | DONE |
| SH-T1 | 状态 | 收件箱空态只有一行说明，没有下一步动作 | 7.2 | packages/app/src/shell/titlebar/inbox.tsx:972 | TODO |
| SH-T2 | 状态 | 收件箱列表加载只有 `Loader`，没有区分刷新（保留旧数据 + 头部 Loader） | 7.2 | packages/app/src/shell/titlebar/inbox.tsx:942 | TODO |
| SH-T3 | 状态 | 标签页同时用 `popoverOpen`、`promptPulse` 等独立信号表达浮层与提示，未收进单一状态机 | 7.1 | packages/app/src/shell/titlebar/tab-nav.tsx:424 | TODO |
| SH-C1 | 刻度 | 标签标题 `text-[15px]` 改为 13px + `--line-height-compact` | 3 | packages/app/src/shell/titlebar/tab-nav.tsx:340 | DONE |
| SH-C2 | 刻度 | 标签容器边框 1px 改为 0.5px，圆角 5px→4px，内边距 1px 5px→2px 4px | 4.4 | packages/app/src/shell/titlebar/tab-nav.css:541-543 | DONE |
| SH-C3 | 刻度 | `pointer-events: none !important` 保留：Kobalte 可关闭层写内联值，注释已说明，属标准第 1 节「保留态覆盖需注释」豁免 | 4.4/5.7 | packages/app/src/shell/titlebar/tab-popover.css:25 | DONE |
| SH-C4 | 刻度 | 标题栏行 `rounded-[6px] text-[15px] leading-4` 改为 `rounded-[8px] text-[13px] leading-[var(--line-height-compact)]`（同处 4 个按钮） | 3/4.3 | packages/app/src/shell/titlebar/titlebar.tsx:546,612,627,640,649 | DONE |
| SH-I1 | 交互 | 标题栏标签触发器补可见焦点环：`inset 0 0 0 1px var(--v2-border-border-focus)` | 7.3 | packages/app/src/shell/titlebar/titlebar.tsx:546 | DONE |
| SH-I2 | 交互 | 收件箱行补可见焦点环（保留原透明度焦点反馈） | 7.3 | packages/app/src/shell/titlebar/inbox.tsx:635 | DONE |
| SH-I3 | 交互 | 侧栏会话行补可见焦点环 | 7.3 | packages/app/src/shell/titlebar/project-session-row.tsx:134 | DONE |
| SH-I4 | 交互 | 侧栏项目行补可见焦点环（原只有文字变色） | 7.3 | packages/app/src/shell/titlebar/sidebar-organized.tsx:407 | DONE |
| SH-I5 | 交互 | 关闭标签页有 `aria-label`，满足可访问名称 | 5.1/10 | packages/app/src/shell/titlebar/tab-nav.tsx:413 | DONE |
| SH-I6 | 交互 | 删除标签页有 `variant="danger"` 二次确认 | 5.1 | packages/app/src/shell/titlebar/tab-strip.tsx:222 | DONE |

## home

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| HM-S1 | 结构 | 首页详情列由 `minmax(0,720px)` 改为 `minmax(0,1fr)`，随容器自适应 | 4.1 | packages/app/src/home/route.tsx:43 | DONE |
| HM-S2 | 结构 | 实测项目列表滚动容器已带 `data-scrollable` | 8 | packages/app/src/home/projects/view.tsx:224 | DONE |
| HM-S3 | 结构 | 搜索框位于 1fr 详情列内，420px 上限不再压缩分栏 | 4.1 | packages/app/src/home/sessions/view.tsx:381 | DONE |
| HM-S4 | 结构 | 实测 `rounded-[12px]` 属标准 4.3 允许档（12–13 浮层） | 4.3 | packages/app/src/home/sessions/view.tsx:318 | DONE |
| HM-T1 | 状态 | `home` 目录无 `machine.ts`，加载态依赖父级 `loading` 布尔 | 7.1 | packages/app/src/home/sessions/view.tsx:74 | TODO |
| HM-T2 | 状态 | 会话列表错误态没有页内 danger 行与原地重试（`home` 下无 retry 命中） | 7.2 | packages/app/src/home/sessions/view.tsx | TODO |
| HM-T3 | 状态 | 项目列表加载只有 `Loader`，无刷新保留旧数据 | 7.2 | packages/app/src/home/projects/view.tsx:306 | TODO |
| HM-T4 | 状态 | 无最近会话时只有文案，没有创建动作 | 7.2 | packages/app/src/home/sessions/view.tsx:332 | TODO |
| HM-C1 | 刻度 | 服务器标签 `text-[9px] leading-none` 改为 `text-[11px] leading-[var(--line-height-compact)]`，圆角 3px→4px | 3 | packages/app/src/home/projects/view.tsx:467 | DONE |
| HM-C2 | 刻度 | 问候标题 26px 改为 20px/26px，日期行 14px→13px + base，`mt-[18px]`→`mt-4` | 3 | packages/app/src/home/sessions/view.tsx:555-558 | DONE |
| HM-C3 | 刻度 | 统计 chip `text-[11.5px]` 改为 11px + compact，圆角改 `rounded-full`，`gap-1.5`→`gap-1` | 3 | packages/app/src/home/sessions/view.tsx:569 | DONE |
| HM-C4 | 刻度 | 搜索态标题 `text-[15px] leading-4` 改为 13px + compact | 3 | packages/app/src/home/sessions/view.tsx:1012 | DONE |
| HM-I1 | 交互 | 会话行与搜索结果行补可见焦点环（两处同类行一并处理） | 7.3 | packages/app/src/home/sessions/view.tsx:483,812 | DONE |
| HM-I2 | 交互 | 行内重命名输入补可见焦点环 | 7.3 | packages/app/src/home/sessions/view.tsx:765 | DONE |
| HM-I3 | 交互 | 项目列表行焦点环由 0.5px muted 提升为 1px focus；浮层本身 `outline-none` 不承载焦点，焦点在面板行上 | 7.3 | packages/app/src/home/projects/view.tsx:719 | DONE |
| HM-I4 | 交互 | 删除会话有 `variant="danger"` 二次确认 | 5.1 | packages/app/src/home/sessions/controller.tsx:304 | DONE |

## inbox

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| IB-S1 | 结构 | 收件箱页补顶部筛选行（全部/待处理/失败/已完成） | 6.3 | packages/app/src/inbox/route.tsx:32 | DONE |
| IB-S2 | 结构 | 补齐主从骨架：左列表 320px + 右详情，各自滚动 | 6.3 | packages/app/src/inbox/route.tsx:51,70 | DONE |
| IB-S3 | 结构 | 页面承担列表+详情，侧栏收窄为快捷入口，不再两处都当列表页 | 6.3 | packages/app/src/inbox/route.tsx:51 | DONE |
| IB-T1 | 状态 | 空态补「打开定时任务」下一步动作 | 7.2 | packages/app/src/inbox/route.tsx:63 | DONE |
| IB-T2 | 状态 | 实测 `rounded-[9px]` 属标准 4.3 允许档（9–10 卡片/内块） | 4.3 | packages/app/src/inbox/route.tsx:57 | DONE |
| IB-C1 | 刻度 | 正文改为 13px + `--line-height-base` | 3 | packages/app/src/inbox/route.tsx:59 | DONE |
| IB-C2 | 刻度 | 同页统一 13px 正文 + 12px 说明，层级稳定 | 3 | packages/app/src/inbox/route.tsx:59,61 | DONE |
| IB-C3 | 刻度 | 图标容器圆角改为允许档 9px | 4.3 | packages/app/src/inbox/route.tsx:57 | DONE |
| IB-I1 | 交互 | 空态提供可聚焦的 `Button`，键盘可继续 | 7.3 | packages/app/src/inbox/route.tsx:63 | DONE |
| IB-I2 | 交互 | 筛选行 B1 已实现（`aria-pressed` 四态），空态下一步动作可 Tab 聚焦；页面无数据源时不存在列表行，无可导航对象 | 7.3 | packages/app/src/inbox/route.tsx:33-45,60-66 | DONE |
| IB-I3 | 交互 | 空态容器补 `role="status"`，说明与动作进入无障碍树 | 10 | packages/app/src/inbox/route.tsx:52 | DONE |

## scheduled

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| SC-S1 | 结构 | 页面级 `container: scheduled / inline-size`；`@container scheduled (max-width:760px)` 时列表在上、正文在下；横向详情 `min-width:420px`，纵向归零 | 4.1 | packages/app/src/scheduled/scheduled.css:21-24,181,426-446、route.tsx:260 | DONE |
| SC-S2 | 结构 | 实测列表已带 `data-scrollable` | 8 | packages/app/src/scheduled/route.tsx:301 | DONE |
| SC-S3 | 结构 | 实测筛选 chip 与搜索同在 `PageToolbar` 单行，右对齐 | 6.1 | packages/app/src/scheduled/route.tsx:276 | DONE |
| SC-S4 | 结构 | 列表宽 320px，落在 300–360 区间 | 4.1 | packages/app/src/scheduled/scheduled.css:31 | DONE |
| SC-T1 | 状态 | 有 `machine.ts` 判别联合承载生命周期 | 7.1 | packages/app/src/scheduled/machine.ts | DONE |
| SC-T2 | 状态 | 错误态有原地重试 | 7.2 | packages/app/src/scheduled/route.tsx:348 | DONE |
| SC-T3 | 状态 | `load.started` 保留旧数据转 `refreshing`，工具栏显示 `Loader`；首次加载才在列表区给 `Loader` | 7.2 | packages/app/src/scheduled/machine.ts:22、route.tsx:295,303 | DONE |
| SC-T4 | 状态 | 空列表给一句说明 + 「新建任务」按钮 | 7.2 | packages/app/src/scheduled/route.tsx:311-318 | DONE |
| SC-C1 | 刻度 | 列表行 `gap: 3px` 改为 4px | 4.2 | packages/app/src/scheduled/scheduled.css:70 | DONE |
| SC-C2 | 刻度 | 筛选计数 `margin-inline-start: 6px` 改为 4px | 4.2 | packages/app/src/scheduled/scheduled.css:9 | DONE |
| SC-C3 | 刻度 | 控件宽度 220px 不属 4.2 间距刻度，标准 4.1 只规定列表/设置/新建列宽，未规定搜索框宽度；保留 | 4.1 | packages/app/src/scheduled/scheduled.css:19 | DONE |
| SC-C4 | 刻度 | 行圆角 9px、内边距 9/10px，符合档位 | 4.3 | packages/app/src/scheduled/scheduled.css:47-50 | DONE |
| SC-I1 | 交互 | 筛选组有 `role="group"` 与 `aria-label` | 10 | packages/app/src/scheduled/route.tsx:276 | DONE |
| SC-I2 | 交互 | 新建对话框支持键盘操作 | 7.3 | packages/app/src/scheduled/new-dialog.tsx:148 | DONE |
| SC-I3 | 交互 | 列表容器处理 ↑/↓/Home/End 移动焦点并同步选中，Enter 由行按钮原生触发 | 7.3 | packages/app/src/scheduled/route.tsx:307-334 | DONE |
| SC-I4 | 交互 | 删除有 `variant="danger"` 二次确认 | 5.1 | packages/app/src/scheduled/route.tsx:486 | DONE |
| SC-S5 | 结构 | 列表行结构改为「标题 + 右侧下次运行时间 / 触发描述 / 状态点 + 状态文字 + 运行次数」 | 5.2/6.1 | packages/app/src/scheduled/route.tsx:320,328 | DONE |
| SC-S7 | 结构 | 创建弹窗改为 `fit` 并按 5.6 落在 640 宽；字段单列、标签在上、间距 16px，提交失败在弹窗内给出 danger 行 | 5.6 | packages/app/src/scheduled/new-dialog.tsx:96-180 | DONE |
| SC-S6 | 结构 | 详情补「最近记录」区；接口只有 `lastFiredAt`/`lastOutcome`/`lastOutput`，按真实数据渲染一条并给出空态，不补假行 | 6.1 | packages/app/src/scheduled/route.tsx:401 | DONE |

## knowledge

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| KN-S1 | 结构 | 列表、文件区、预览区各自独立滚动 | 4.1/8 | packages/app/src/knowledge/route.tsx:452,730,850 | DONE |
| KN-S2 | 结构 | 列表宽度可拖拽，未写死 | 4.1 | packages/app/src/knowledge/route.tsx:844 | DONE |
| KN-S3 | 结构 | 详情区上限 420px，符合可读下限 | 4.1 | packages/app/src/knowledge/knowledge.css:256 | DONE |
| KN-S5 | 结构 | 新建知识库的名称与说明补可见字段标签（原来只有 placeholder/aria-label），标签在上、字段单列 | 5.6 | packages/app/src/knowledge/new-library-dialog.tsx:30-58 | DONE |
| KN-S4 | 结构 | 文件预览用 `<pre>`，代码字体与正文行高正确 | 3 | packages/app/src/knowledge/route.tsx:877 | DONE |
| KN-T1 | 状态 | 空态有说明与「新建」动作 | 7.2 | packages/app/src/knowledge/route.tsx:458,511 | DONE |
| KN-T2 | 状态 | 预览加载用 `Loader`，非 `Spinner` | 7.2 | packages/app/src/knowledge/route.tsx:873 | DONE |
| KN-T3 | 状态 | 预览读取失败给页内 danger 行 + 原地重试 `retryPreview` | 7.2 | packages/app/src/knowledge/route.tsx:905-928 | DONE |
| KN-T4 | 状态 | 预览已从 `fileName`/`fileText`/`loadingFile` 三个字段收进 `preview-machine.ts` 判别联合（idle/loading/ready/failed，含过期 path 拒绝） | 7.1 | packages/app/src/knowledge/preview-machine.ts:1-40 | DONE |
| KN-C1 | 刻度 | 六个 `--knowledge-tone` hex 改为 `--v2-blue/purple/orange/green/pink/cyan-500` | 2 | packages/app/src/knowledge/knowledge.css:3,17,21,25,29,33,37 | DONE |
| KN-C2 | 刻度 | 空态说明 15px→13px + base，卡片名 15px→16px + base，空态按钮 15px→13px + compact | 3 | packages/app/src/knowledge/route.tsx:494,519,547 | DONE |
| KN-C3 | 刻度 | 12px 属标准 3「紧凑行文本 12–12.5px」，11px 属「分组标签 11px」，各自带 `--line-height-compact`，无需统一 | 3 | packages/app/src/knowledge/route.tsx:526,730,791 | DONE |
| KN-C4 | 刻度 | 隐藏滚动条使用允许的 `scrollbar-width: none` | 8 | packages/app/src/knowledge/knowledge.css:7,332 | DONE |
| KN-I1 | 交互 | 搜索与删除图标有 `aria-label` | 10 | packages/app/src/knowledge/route.tsx:677,722 | DONE |
| KN-I2 | 交互 | 删除有 `variant="danger"` 确认 | 5.1 | packages/app/src/knowledge/route.tsx:1156,1202 | DONE |
| KN-I3 | 交互 | 库网格与文件列表均处理 ↑/↓/←/→/Home/End 移动焦点，Enter 由行按钮原生打开；网格垂直步长取计算后的列数 | 7.3 | packages/app/src/knowledge/route.tsx:514-540,800-824 | DONE |
| KN-I4 | 交互 | 预览区 `tabIndex={0}` 可聚焦，并给 1px focus 环 | 7.3 | packages/app/src/knowledge/route.tsx:908-913 | DONE |

## settings

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| SE-S1 | 结构 | 设置侧栏 264px，落在 196–264 区间 | 6.5 | packages/app/src/settings/settings.css:6 | DONE |
| SE-S2 | 结构 | 窄容器侧栏收到 220px | 6.5 | packages/app/src/settings/settings.css:1028 | DONE |
| SE-S3 | 结构 | 已使用 `@container` 收起侧栏 | 4.1 | packages/app/src/settings/settings.css:996-1034 | DONE |
| SE-S4 | 结构 | 实测控件宽度 220px 不属刻度项；设置行 44px 已由 `--settings-row-min-height` 统一 | 4.1 | packages/app/src/settings/settings.css:11 | DONE |
| SE-T1 | 状态 | 供应商页有 `machine.ts` | 7.1 | packages/app/src/settings/providers/machine.ts | DONE |
| SE-T2 | 状态 | 服务器不可用改为 `unavailable-machine.ts`（idle/retrying/failed），重试失败给页内 danger 行 | 7.1 | packages/app/src/settings/servers/unavailable-machine.ts:1-16、unavailable.tsx:28-55 | DONE |
| SE-T3 | 状态 | 项目知识库错误有原地重试 | 7.2 | packages/app/src/settings/workspaces/project-knowledge.tsx:136 | DONE |
| SE-T4 | 状态 | 设置搜索无「无结果 + 一个动作」的空态 | 7.2 | packages/app/src/settings/search.tsx:207 | TODO |
| SE-C1 | 刻度 | 导航淡出遮罩 `#000` 改为 `var(--v2-background-bg-inverse)`（alpha mask，颜色不影响裁剪） | 2 | packages/app/src/settings/settings.css:131-134 | DONE |
| SE-C2 | 刻度 | 删除 `padding-inline: 0 !important`，原选择器已有 3 段特异性 | 4.2 | packages/app/src/settings/settings.css:2343 | DONE |
| SE-C3 | 刻度 | 两处链接色 `!important` 去掉，改用 `.settings-extension-link[href]` 提升特异性 | 2 | packages/app/src/settings/settings.css:2428-2435 | DONE |
| SE-C4 | 刻度 | 界面模式卡片两处 `1px solid` 改为 0.5px | 4.4 | packages/app/src/settings/general/interface-mode.css:72,144 | DONE |
| SE-I1 | 交互 | 设置外壳有键盘处理 | 7.3 | packages/app/src/settings/shell.tsx:164 | DONE |
| SE-I2 | 交互 | 设置搜索有键盘处理 | 7.3 | packages/app/src/settings/search.tsx:159 | DONE |
| SE-I3 | 交互 | 删除工作区有 `variant="danger"` 确认 | 5.1 | packages/app/src/settings/workspaces/workspaces.tsx:603,669 | DONE |
| SE-I4 | 交互 | 设置导航行由共享 Tabs 焦点态覆盖，`.settings-back` 已有 focus-visible；无需逐行重写 | 7.3 | packages/ui/src/navigation/tabs/tabs-current.css:62、packages/app/src/settings/settings.css:582-608 | DONE |

## servers

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| SV-S1 | 结构 | 连接页是单一 `main`，带 `aria-labelledby` | 10 | packages/app/src/servers/connect/screen.tsx:23 | DONE |
| SV-S2 | 结构 | 实测两个入口互斥：无插件时为按钮，有插件时同一触发点变菜单 | 5.1 | packages/app/src/servers/registry/add-menu.tsx:13 | DONE |
| SV-S4 | 结构 | 连接表单字段组间距 24px 改为 16px，落在 12–16 区间 | 5.6 | packages/app/src/servers/connect/dialog.tsx:115 | DONE |
| SV-S3 | 结构 | 实测为单步表单，标准 5.6 要求步骤指示仅用于真正的多步流程 | 5.6 | packages/app/src/servers/connect/dialog.tsx:95 | DONE |
| SV-T1 | 状态 | 连接流程有 `machine.ts` | 7.1 | packages/app/src/servers/connect/machine.ts | DONE |
| SV-T2 | 状态 | 健康状态由 `health-machine` 派生 | 7.1 | packages/app/src/runtime/server/health-machine.ts | DONE |
| SV-T3 | 状态 | 健康点改为 `role="status"` + 语义文案（已连接/无法连接/检测中/认证/连接中/版本不兼容），颜色只作辅助 | 5.3 | packages/app/src/servers/registry/row.tsx:10-26 | DONE |
| SV-T4 | 状态 | 认证、连接中、不兼容都带文字 `aria-label` | 10 | packages/app/src/servers/registry/row.tsx:27,36 | DONE |
| SV-C1 | 刻度 | 连接页边框 1px 改为 0.5px | 4.4 | packages/app/src/servers/connect/screen.css:100 | DONE |
| SV-C2 | 刻度 | 连接方式按钮 `text-[15px]` 改为 13px + compact | 3 | packages/app/src/servers/connect/method.tsx:18 | DONE |
| SV-C3 | 刻度 | 健康点 6px，符合状态点规格 | 5.2 | packages/app/src/servers/registry/row.tsx:16 | DONE |
| SV-I1 | 交互 | 添加按钮有 `aria-label` | 10 | packages/app/src/servers/registry/add-menu.tsx:30 | DONE |
| SV-I2 | 交互 | 连接对话框支持键盘 | 7.3 | packages/app/src/servers/connect/dialog.tsx:144 | DONE |
| SV-I3 | 交互 | 行菜单有「更多选项」名称 | 10 | packages/app/src/servers/registry/row-menu.tsx:70 | DONE |
| SV-I4 | 交互 | `dialog.show` 通过 `captureFocus`/`returnFocus` 记录并归还触发点；连接对话框走同一入口 | 7.3 | packages/ui/src/context/dialog.tsx:248-250,275-303 | DONE |

## workspaces

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| WS-S1 | 结构 | 目录选择弹窗用 `size="large"`（640px），符合弹窗宽度档 | 5.6 | packages/app/src/workspaces/selection/dialog.tsx:670 | DONE |
| WS-S2 | 结构 | 实测目录选择是弹窗单列浏览，标准 5.6 规定弹窗正文单列 | 6.1 | packages/app/src/workspaces/selection/dialog.tsx:670 | DONE |
| WS-S3 | 结构 | 实测设置行统一 `--settings-row-min-height: 44px` | 4.2 | packages/app/src/settings/settings.css:11 | DONE |
| WS-S4 | 结构 | 文件树与内容区各自滚动，符合主从分栏 | 4.1 | packages/app/src/workspaces/files/tree-machine.ts | DONE |
| WS-T1 | 状态 | 文件树与内容各有独立 `machine.ts` | 7.1 | packages/app/src/workspaces/files/tree-machine.ts,content-machine.ts | DONE |
| WS-T2 | 状态 | 目录选择加载态改为共享 `Loader`（`role=status` + `aria-label`），不再用纯文本 | 7.2 | packages/app/src/workspaces/selection/dialog.tsx:806-809 | DONE |
| WS-T3 | 状态 | 目录读取失败改为弹窗内 danger 行 + `common.retry` 原地重试 | 7.2 | packages/app/src/workspaces/selection/dialog.tsx:810-822 | DONE |
| WS-C1 | 刻度 | 第三方树行样式：字号 15px→13px、gap 6px→8px；`!important` 保留，理由写在 `unsafeCSS` 注释，属保留态覆盖豁免 | 2/3/4.2 | packages/app/src/workspaces/selection/dialog.tsx:558-580 | DONE |
| WS-C2 | 刻度 | 目录选择边框 1px 改为 0.5px | 4.4 | packages/app/src/workspaces/selection/dialog.css:87 | DONE |
| WS-C3 | 刻度 | 内联 `color-mix` 底色改为 `bg-v2-background-bg-layer-02`，字号改 12px + compact，内边距改 8px | 2 | packages/app/src/settings/workspaces/workspaces.tsx:655 | DONE |
| WS-I1 | 交互 | 目录输入支持键盘处理 | 7.3 | packages/app/src/workspaces/selection/dialog.tsx:717 | DONE |
| WS-I2 | 交互 | 删除工作区有确认按钮 | 5.1 | packages/app/src/settings/workspaces/workspaces.tsx:603 | DONE |
| WS-I3 | 交互 | 目录选择走 `dialog.show`，关闭后由 `returnFocus` 归还触发点 | 7.3 | packages/ui/src/context/dialog.tsx:248-250,291-303 | DONE |
| WS-I4 | 交互 | 第三方树行原 `focus-visible { outline: none }` 改为补 `inset 0 0 0 1px` focus 环 | 7.3 | packages/app/src/workspaces/selection/dialog.tsx:596-599 | DONE |

## new-session

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| NS-S1 | 结构 | 新建会话单列最大宽度改为 660px | 6.6 | packages/app/src/new-session/wordmark.tsx:132 | DONE |
| NS-S2 | 结构 | 选择器宽度改为随视口收敛：`max-w-[min(160px,30vw)]` / `max-w-[min(220px,40vw)]` | 4.1 | packages/app/src/new-session/project/selector.tsx:100、workspace/selector.tsx:141 | DONE |
| NS-S3 | 结构 | 工作区浮层宽度改为 `min(243px, calc(100vw-32px))`，窄屏不溢出 | 4.1 | packages/app/src/new-session/workspace/selector.tsx:153 | DONE |
| NS-T1 | 状态 | 新建会话有 `machine.ts` | 7.1 | packages/app/src/new-session/machine.ts | DONE |
| NS-T2 | 状态 | 工作区列表有原地重试 | 7.2 | packages/app/src/new-session/workspace/selector.tsx:166 | DONE |
| NS-T3 | 状态 | 空状态只有输入框，缺最近项目卡片 | 6.6 | packages/app/src/new-session/view.tsx:325 | TODO |
| NS-C1 | 刻度 | 工具行两处 `text-[15px]` 改为 13px + compact，`pl-1.5`→`ps-2`、`pe-1.5`→`pe-2` | 3 | packages/app/src/new-session/view.tsx:226,325 | DONE |
| NS-C2 | 刻度 | 砖块 HUD `leading-[16px]` 改为 `leading-[var(--line-height-compact)]`（同值，改用变量） | 3 | packages/app/src/new-session/brick-breaker.tsx:54 | DONE |
| NS-C3 | 刻度 | canvas 取色 fallback 的 hex 只在 `getComputedStyle` 读不到 token 时兜底，不参与主题定义；主路径读 `--v2-*`，无需改 | 2 | packages/app/src/new-session/pin-board.tsx:939-949 | DONE |
| NS-I1 | 交互 | 工作区定位对话框支持键盘 | 7.3 | packages/app/src/new-session/location/dialog.tsx:416 | DONE |
| NS-I2 | 交互 | 项目选择器有 `focus-visible` 背景反馈 | 7.3 | packages/app/src/new-session/project/selector.tsx:100 | DONE |
| NS-I3 | 交互 | 分支选择 `onCloseAutoFocus` 显式处理：外部点击保留焦点，否则 `onDone` 接管；触发器补可见焦点环 | 7.3 | packages/app/src/new-session/workspace/selector.tsx:141,155-161 | DONE |

## session

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| SS-S1 | 结构 | 侧栏面板宽度可拖拽，未写死 | 4.1 | packages/app/src/session/screen.tsx:506 | DONE |
| SS-S2 | 结构 | 会话准备页补 `data-scrollable` | 8 | packages/app/src/session/route.tsx:77 | DONE |
| SS-S4 | 结构 | 会话设置弹窗宽度 560px 改为 640px，落在 5.6 的 640/880 两档 | 5.6 | packages/app/src/session/settings-dialog.css:7-9 | DONE |
| SS-S3 | 结构 | 实测时间线走 `ScrollView`，侧面板 `overflow-hidden` 内各自滚动，无共用滚动 | 8 | packages/app/src/session/screen.tsx:521 | DONE |
| SS-T1 | 状态 | 时间线有 `machine.ts` 与分辨率状态机 | 7.1 | packages/app/src/session/timeline/machine.ts | DONE |
| SS-T2 | 状态 | 输入队列有 `queue-machine.ts` | 7.1 | packages/app/src/session/composer/queue-machine.ts | DONE |
| SS-T3 | 状态 | 会话准备态没有说明原因的文案行 | 7.2 | packages/app/src/session/route.tsx:77 | TODO |
| SS-C1 | 刻度 | 队列行两处 `text-[15px]` 改为 13px + compact，`rounded-sm`→`rounded-[4px]` | 3 | packages/app/src/session/composer/queue-panel.tsx:223,236 | DONE |
| SS-C2 | 刻度 | 输入区渐变遮罩 `#000` 改为 `var(--v2-background-bg-inverse)`（alpha mask） | 2 | packages/app/src/session/composer/spring-height.tsx:344 | DONE |
| SS-C3 | 刻度 | 活动胶囊用 `border-[0.5px]`，符合边框档 | 4.4 | packages/app/src/session/composer/activity-chips.tsx:239 | DONE |
| SS-I1 | 交互 | 工作活动展开按钮补可见焦点环 | 7.3 | packages/app/src/session/timeline/working-activity.tsx:100 | DONE |
| SS-I2 | 交互 | 队列项有排序按钮名称 | 10 | packages/app/src/session/composer/queue-panel.tsx:211 | DONE |
| SS-I3 | 交互 | 时间线走共享滚动键：↑/↓/PageUp/PageDown/Home/End 映射为滚动意图，无消息选择模型（不引入，避免与输入框抢键） | 7.3 | packages/app/src/session/timeline/virtualizer.tsx:1072,1238、packages/ui/src/components/scroll-view.tsx:30-50 | DONE |
| SS-I4 | 交互 | 中断运行有确认按钮 | 5.1 | packages/app/src/session/timeline/controller.tsx:323 | DONE |

## composer

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| CO-S1 | 结构 | 实测 264px 为菜单面板宽度，标准 5.7 未规定面板宽度 | 4.1 | packages/app/src/composer/composer.tsx:196 | DONE |
| CO-S2 | 结构 | 编辑器历史区补 `data-scrollable` | 8 | packages/app/src/composer/editor/editor.tsx:303 | DONE |
| CO-S3 | 结构 | 工具条分隔线由 1px 改为 0.5px | 5.5 | packages/app/src/composer/editor/editor.tsx:1652 | DONE |
| CO-T1 | 状态 | 输入队列有 `queue-machine.ts` | 7.1 | packages/app/src/session/composer/queue-machine.ts | DONE |
| CO-T2 | 状态 | 上传中显示 `Loader`，符合非 AI 加载 | 7.2 | packages/app/src/composer/editor/editor.tsx:22 | DONE |
| CO-T3 | 状态 | 上传失败没有字段级错误行，只靠 toast | 7.2 | packages/app/src/composer/attachments/uploads.tsx:123 | TODO |
| CO-C1 | 刻度 | 滑块 `#ffffff` 改为 `--v2-grey-50`，两处 rgba 阴影改为 `color-mix` + `--v2-grey-1100`，1px 环改 0.5px | 2 | packages/app/src/composer/editor/variant-slider.css:6-16 | DONE |
| CO-C2 | 刻度 | 两处 `!important` 属拖拽保留态覆盖，理由已写成注释，按标准第 1 节豁免 | 4 | packages/app/src/composer/editor/editor.css:308-314 | DONE |
| CO-C3 | 刻度 | 拖拽条纹遮罩的 `black`/`rgba` 改为 `var(--v2-background-bg-inverse)` + `color-mix` | 2 | packages/app/src/composer/dropzone.tsx:68-70 | DONE |
| CO-I1 | 交互 | 编辑器支持完整键盘处理 | 7.3 | packages/app/src/composer/editor/editor.tsx:391 | DONE |
| CO-I2 | 交互 | 变体滑块支持键盘 | 7.3 | packages/app/src/composer/editor/variant-slider.tsx:85 | DONE |
| CO-I3 | 交互 | 附件删除按钮有可访问名称 | 10 | packages/app/src/composer/editor/editor.tsx:900,929,977 | DONE |
| CO-I4 | 交互 | 取消上传时先 `restoreFocus()` 把焦点还给编辑器，再移除上传项；焦点不落到 body | 7.3 | packages/app/src/composer/editor/editor.tsx:319-323 | DONE |

## 未解冲突

| 冲突 | 文档与代码现状 | 处理 |
| --- | --- | --- |
| 弹窗宽度 | 标准 5.6 为 640–880；共享 `Dialog` 默认 480，`large` 640，`x-large` 980 | B6 已把默认改 640、`x-large` 改 min(100vw-32, 880)，并把服务器连接、会话设置两个表单覆盖值改到 640；命令面板 compact、模型/位置选择浮层保留 480 紧凑宽度，它们不是表单弹窗 |
| 菜单面板圆角 | 标准 4.3/5.7 为 8px；现有 `menu.css` 为 8px | 不冲突，按 8px 保留 |
| 工具栏按钮数量 | 标准 5.1 最多 2 个 icon；实测水平标题栏只有首页、搜索 2 个（SH-S3 已改判 DONE），垂直侧栏的品牌区是命令面板快捷键文本，不属工具栏 | 无冲突 |
| 状态点尺寸 | 标准 5.2 为 6px；`servers/registry/row.tsx` 用 `size-1.5`=6px | 一致，无需改 |
| 页面标题字号 | 标准 3 为 20–21px；home 现为 26px | 按标准改，见 HM-C2 |
| 服务器注册表行结构 | 标准 5.2 要求固定「图标 → 标题+状态点 → 副标题 → 元信息」；`packages/app` 内只有健康点组件，整行由 `packages/gui-plugins` 渲染，超出本轮可改范围（仅 app/ui/session-ui） | 原 SV-S4 条目移出计数，留待范围放开后按 5.2 重排 |
| 收件箱页面数据源 | 标准 7.2 要求页面具备加载/错误/部分失败三态；`inbox/route.tsx` 目前没有 producer（`packages/app` 内无收件箱数据源，侧栏收件箱只聚合会话事件），无数据可驱动这三态 | 原 IB-T3 条目移出计数；页面保留主从骨架与空态，待收件箱数据源落地后按 7.2 补分支 |
| 对话与输入区 15px | 标准第 3 节 UI 正文为 13px；`composer/editor/editor.tsx`、`session/timeline/message-timeline.tsx`、`session/timeline/working-activity.tsx`、`session/session-identity-header.tsx` 仍用 15px | 按会话约束不动输入框与对话排版，B4/B5 不改；如需统一，另开一批并同时复核虚拟列表测量 |
| 弹窗默认焦点 | 标准 5.6 要求「弹窗打开焦点落在首个字段」，验收第 5 节要求「取消按钮默认聚焦」 | 表单弹窗（定时任务、知识库、服务器连接、目录选择、会话设置）保留首个字段 `autofocus`；破坏性确认弹窗按验收第 5 节把 `autofocus` 放在取消按钮 |
| 运行历史条数 | 标准 6.1 要求「最近记录固定 5 条」；`Schedule.Info` 只提供 `lastFiredAt`、`lastOutcome`、`lastOutput`、`runCount`，没有运行历史数组，也没有 list-runs 端点（改端点属 schema/server，禁改） | `scheduled` 详情按真实数据渲染 1 条并给空态，不补 4 条假记录；需要服务端补 `schedule.runs` 后才谈 5 条 |

## 进度

- 条目：164
- TODO：11
- DONE：153
- 口径：每条一个可复核的代码位置，同一问题不重复立项；后续每完成一项把该行改成 DONE 并补齐 `文件:行`。
