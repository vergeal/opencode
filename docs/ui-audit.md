# UI 审计：按 `docs/opencode-ui-standard.md` 与 `docs/ui-acceptance-standard.md`

证据来源：仓库代码与 grep 输出（逐条带 `文件:行`）。**按本会话约束不做截图识别**，验收证据以代码行与命令输出为准。

统计：条目 **160**，TODO **67**，DONE **93**。类别分布：结构 41（TODO 3 / DONE 38）、状态 37（13 / 24）、刻度 38（31 / 7）、交互 44（20 / 24）。

表内 `T` 为 TODO 数，`D` 为 DONE 数。

| 页面 | 结构 | 状态 | 刻度 | 交互 | 结论 |
| --- | --- | --- | --- | --- | --- |
| shell | T0 / D4 | T3 / D0 | T4 / D0 | T4 / D2 | 结构达标 |
| home | T0 / D4 | T4 / D0 | T4 / D0 | T3 / D1 | 结构达标 |
| inbox | T0 / D3 | T0 / D2 | T0 / D3 | T2 / D1 | 状态达标 |
| scheduled | T1 / D5 | T0 / D4 | T3 / D1 | T1 / D3 | 状态达标 |
| knowledge | T0 / D4 | T0 / D4 | T3 / D1 | T2 / D2 | 状态达标 |
| settings | T0 / D4 | T1 / D3 | T4 / D0 | T1 / D3 | 未达标 |
| servers | T0 / D3 | T0 / D4 | T2 / D1 | T1 / D3 | 状态达标 |
| workspaces | T0 / D4 | T2 / D1 | T3 / D0 | T2 / D2 | 未达标 |
| new-session | T2 / D1 | T1 / D2 | T3 / D0 | T1 / D2 | 未达标 |
| session | T0 / D3 | T1 / D2 | T2 / D1 | T2 / D2 | 未达标 |
| composer | T0 / D3 | T1 / D2 | T3 / D0 | T1 / D3 | 未达标 |

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
| SH-C1 | 刻度 | 标签标题字号字面量 `text-[15px]` | 3 | packages/app/src/shell/titlebar/tab-nav.tsx:340 | TODO |
| SH-C2 | 刻度 | 标签容器边框 `1px solid`，应为 0.5px | 4.4 | packages/app/src/shell/titlebar/tab-nav.css:541 | TODO |
| SH-C3 | 刻度 | 标签弹层用 `!important` 强制 `pointer-events` | 4.4/5.7 | packages/app/src/shell/titlebar/tab-popover.css:25 | TODO |
| SH-C4 | 刻度 | 标题栏行同时写 `rounded-[6px]`、`text-[15px]`、`leading-4` 字面量 | 3/4.3 | packages/app/src/shell/titlebar/titlebar.tsx:546 | TODO |
| SH-I1 | 交互 | 标题栏行 `focus-visible:outline-none` 且无替代焦点环 | 7.3 | packages/app/src/shell/titlebar/titlebar.tsx:546 | TODO |
| SH-I2 | 交互 | 收件箱行 `focus-visible:outline-none`，无可见焦点环 | 7.3 | packages/app/src/shell/titlebar/inbox.tsx:634 | TODO |
| SH-I3 | 交互 | 侧栏会话行 `focus-visible:outline-none`，无可见焦点环 | 7.3 | packages/app/src/shell/titlebar/project-session-row.tsx:134 | TODO |
| SH-I4 | 交互 | 侧栏项目行焦点态只改文字色，没有可见环 | 7.3 | packages/app/src/shell/titlebar/sidebar-organized.tsx:407 | TODO |
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
| HM-C1 | 刻度 | `text-[9px] leading-none` 同时违反字号与行高规则 | 3 | packages/app/src/home/projects/view.tsx:468 | TODO |
| HM-C2 | 刻度 | 页面标题 26px，超出 20–21px | 3 | packages/app/src/home/sessions/view.tsx:555 | TODO |
| HM-C3 | 刻度 | 徽章字号字面量 `text-[11.5px]` | 3 | packages/app/src/home/sessions/view.tsx:569 | TODO |
| HM-C4 | 刻度 | 搜索态标题写 `text-[15px] leading-4` 字面量 | 3 | packages/app/src/home/sessions/view.tsx:1012 | TODO |
| HM-I1 | 交互 | 会话行 `focus-visible:outline-none`，无可见焦点环 | 7.3 | packages/app/src/home/sessions/view.tsx:739 | TODO |
| HM-I2 | 交互 | 行内重命名输入 `focus-visible:outline-none`，无可见焦点环 | 7.3 | packages/app/src/home/sessions/view.tsx:765 | TODO |
| HM-I3 | 交互 | 项目菜单浮层 `outline-none`，无焦点环 | 7.3 | packages/app/src/home/projects/view.tsx:126 | TODO |
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
| IB-I2 | 交互 | 页面没有筛选与键盘导航 | 7.3 | packages/app/src/inbox/route.tsx | TODO |
| IB-I3 | 交互 | 空态说明没有语义角色 | 10 | packages/app/src/inbox/route.tsx:20 | TODO |

## scheduled

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| SC-S1 | 结构 | 主从分栏靠 `flex` 宽度写死，缺少 `@container`，窄容器不会先收详情 | 4.1 | packages/app/src/scheduled/scheduled.css:20-36 | TODO |
| SC-S2 | 结构 | 实测列表已带 `data-scrollable` | 8 | packages/app/src/scheduled/route.tsx:301 | DONE |
| SC-S3 | 结构 | 实测筛选 chip 与搜索同在 `PageToolbar` 单行，右对齐 | 6.1 | packages/app/src/scheduled/route.tsx:276 | DONE |
| SC-S4 | 结构 | 列表宽 320px，落在 300–360 区间 | 4.1 | packages/app/src/scheduled/scheduled.css:31 | DONE |
| SC-T1 | 状态 | 有 `machine.ts` 判别联合承载生命周期 | 7.1 | packages/app/src/scheduled/machine.ts | DONE |
| SC-T2 | 状态 | 错误态有原地重试 | 7.2 | packages/app/src/scheduled/route.tsx:348 | DONE |
| SC-T3 | 状态 | `load.started` 保留旧数据转 `refreshing`，工具栏显示 `Loader`；首次加载才在列表区给 `Loader` | 7.2 | packages/app/src/scheduled/machine.ts:22、route.tsx:295,303 | DONE |
| SC-T4 | 状态 | 空列表给一句说明 + 「新建任务」按钮 | 7.2 | packages/app/src/scheduled/route.tsx:311-318 | DONE |
| SC-C1 | 刻度 | 行内 `gap: 3px` 不在 2/4/8 刻度 | 4.2 | packages/app/src/scheduled/scheduled.css:45 | TODO |
| SC-C2 | 刻度 | 筛选计数 `margin: 6px` 不在刻度 | 4.2 | packages/app/src/scheduled/scheduled.css:9 | TODO |
| SC-C3 | 刻度 | 搜索框宽度 `220px` 字面量 | 4.1 | packages/app/src/scheduled/scheduled.css:16 | TODO |
| SC-C4 | 刻度 | 行圆角 9px、内边距 9/10px，符合档位 | 4.3 | packages/app/src/scheduled/scheduled.css:47-50 | DONE |
| SC-I1 | 交互 | 筛选组有 `role="group"` 与 `aria-label` | 10 | packages/app/src/scheduled/route.tsx:276 | DONE |
| SC-I2 | 交互 | 新建对话框支持键盘操作 | 7.3 | packages/app/src/scheduled/new-dialog.tsx:148 | DONE |
| SC-I3 | 交互 | 列表行没有方向键移动 / Enter 打开的证据 | 7.3 | packages/app/src/scheduled/route.tsx | TODO |
| SC-I4 | 交互 | 删除有 `variant="danger"` 二次确认 | 5.1 | packages/app/src/scheduled/route.tsx:486 | DONE |
| SC-S5 | 结构 | 列表行结构改为「标题 + 右侧下次运行时间 / 触发描述 / 状态点 + 状态文字 + 运行次数」 | 5.2/6.1 | packages/app/src/scheduled/route.tsx:320,328 | DONE |
| SC-S6 | 结构 | 详情补「最近记录」区；接口只有 `lastFiredAt`/`lastOutcome`/`lastOutput`，按真实数据渲染一条并给出空态，不补假行 | 6.1 | packages/app/src/scheduled/route.tsx:401 | DONE |

## knowledge

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| KN-S1 | 结构 | 列表、文件区、预览区各自独立滚动 | 4.1/8 | packages/app/src/knowledge/route.tsx:452,730,850 | DONE |
| KN-S2 | 结构 | 列表宽度可拖拽，未写死 | 4.1 | packages/app/src/knowledge/route.tsx:844 | DONE |
| KN-S3 | 结构 | 详情区上限 420px，符合可读下限 | 4.1 | packages/app/src/knowledge/knowledge.css:256 | DONE |
| KN-S4 | 结构 | 文件预览用 `<pre>`，代码字体与正文行高正确 | 3 | packages/app/src/knowledge/route.tsx:877 | DONE |
| KN-T1 | 状态 | 空态有说明与「新建」动作 | 7.2 | packages/app/src/knowledge/route.tsx:458,511 | DONE |
| KN-T2 | 状态 | 预览加载用 `Loader`，非 `Spinner` | 7.2 | packages/app/src/knowledge/route.tsx:873 | DONE |
| KN-T3 | 状态 | 预览读取失败给页内 danger 行 + 原地重试 `retryPreview` | 7.2 | packages/app/src/knowledge/route.tsx:905-928 | DONE |
| KN-T4 | 状态 | 预览已从 `fileName`/`fileText`/`loadingFile` 三个字段收进 `preview-machine.ts` 判别联合（idle/loading/ready/failed，含过期 path 拒绝） | 7.1 | packages/app/src/knowledge/preview-machine.ts:1-40 | DONE |
| KN-C1 | 刻度 | 六个 `--knowledge-tone` 使用 hex 字面量 | 2 | packages/app/src/knowledge/knowledge.css:3,17,21,25,29,33,37 | TODO |
| KN-C2 | 刻度 | 库名与标题用 `text-[15px]` 字面量 | 3 | packages/app/src/knowledge/route.tsx:483,511 | TODO |
| KN-C3 | 刻度 | 元信息混用 `text-[12px]`、`text-[11px]` 字面量 | 3 | packages/app/src/knowledge/route.tsx:490,752 | TODO |
| KN-C4 | 刻度 | 隐藏滚动条使用允许的 `scrollbar-width: none` | 8 | packages/app/src/knowledge/knowledge.css:7,332 | DONE |
| KN-I1 | 交互 | 搜索与删除图标有 `aria-label` | 10 | packages/app/src/knowledge/route.tsx:677,722 | DONE |
| KN-I2 | 交互 | 删除有 `variant="danger"` 确认 | 5.1 | packages/app/src/knowledge/route.tsx:1156,1202 | DONE |
| KN-I3 | 交互 | 库列表没有方向键 / Enter 导航证据 | 7.3 | packages/app/src/knowledge/route.tsx | TODO |
| KN-I4 | 交互 | 文件预览区没有可见焦点环 | 7.3 | packages/app/src/knowledge/route.tsx:877 | TODO |

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
| SE-C1 | 刻度 | 导航淡出遮罩用 `#000` 字面量 | 2 | packages/app/src/settings/settings.css:131-132 | TODO |
| SE-C2 | 刻度 | `padding-inline: 0 !important` 覆盖 | 4.2 | packages/app/src/settings/settings.css:2336 | TODO |
| SE-C3 | 刻度 | 链接色两处 `!important` | 2 | packages/app/src/settings/settings.css:2422,2427 | TODO |
| SE-C4 | 刻度 | 界面模式卡片边框 `1px solid` | 4.4 | packages/app/src/settings/general/interface-mode.css:72,144 | TODO |
| SE-I1 | 交互 | 设置外壳有键盘处理 | 7.3 | packages/app/src/settings/shell.tsx:164 | DONE |
| SE-I2 | 交互 | 设置搜索有键盘处理 | 7.3 | packages/app/src/settings/search.tsx:159 | DONE |
| SE-I3 | 交互 | 删除工作区有 `variant="danger"` 确认 | 5.1 | packages/app/src/settings/workspaces/workspaces.tsx:603,669 | DONE |
| SE-I4 | 交互 | 设置行焦点环未统一，部分行依赖浏览器默认 | 7.3 | packages/app/src/settings/shell.tsx:164 | TODO |

## servers

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| SV-S1 | 结构 | 连接页是单一 `main`，带 `aria-labelledby` | 10 | packages/app/src/servers/connect/screen.tsx:23 | DONE |
| SV-S2 | 结构 | 实测两个入口互斥：无插件时为按钮，有插件时同一触发点变菜单 | 5.1 | packages/app/src/servers/registry/add-menu.tsx:13 | DONE |
| SV-S3 | 结构 | 实测为单步表单，标准 5.6 要求步骤指示仅用于真正的多步流程 | 5.6 | packages/app/src/servers/connect/dialog.tsx:95 | DONE |
| SV-T1 | 状态 | 连接流程有 `machine.ts` | 7.1 | packages/app/src/servers/connect/machine.ts | DONE |
| SV-T2 | 状态 | 健康状态由 `health-machine` 派生 | 7.1 | packages/app/src/runtime/server/health-machine.ts | DONE |
| SV-T3 | 状态 | 健康点改为 `role="status"` + 语义文案（已连接/无法连接/检测中/认证/连接中/版本不兼容），颜色只作辅助 | 5.3 | packages/app/src/servers/registry/row.tsx:10-26 | DONE |
| SV-T4 | 状态 | 认证、连接中、不兼容都带文字 `aria-label` | 10 | packages/app/src/servers/registry/row.tsx:27,36 | DONE |
| SV-C1 | 刻度 | 连接页边框 `1px solid` | 4.4 | packages/app/src/servers/connect/screen.css:100 | TODO |
| SV-C2 | 刻度 | 连接方式按钮 `text-[15px]` 字面量 | 3 | packages/app/src/servers/connect/method.tsx:18 | TODO |
| SV-C3 | 刻度 | 健康点 6px，符合状态点规格 | 5.2 | packages/app/src/servers/registry/row.tsx:16 | DONE |
| SV-I1 | 交互 | 添加按钮有 `aria-label` | 10 | packages/app/src/servers/registry/add-menu.tsx:30 | DONE |
| SV-I2 | 交互 | 连接对话框支持键盘 | 7.3 | packages/app/src/servers/connect/dialog.tsx:144 | DONE |
| SV-I3 | 交互 | 行菜单有「更多选项」名称 | 10 | packages/app/src/servers/registry/row-menu.tsx:70 | DONE |
| SV-I4 | 交互 | 关闭连接对话框后焦点回触发点未验证 | 7.3 | packages/app/src/servers/connect/dialog.tsx | TODO |

## workspaces

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| WS-S1 | 结构 | 目录选择弹窗用 `size="large"`（640px），符合弹窗宽度档 | 5.6 | packages/app/src/workspaces/selection/dialog.tsx:670 | DONE |
| WS-S2 | 结构 | 实测目录选择是弹窗单列浏览，标准 5.6 规定弹窗正文单列 | 6.1 | packages/app/src/workspaces/selection/dialog.tsx:670 | DONE |
| WS-S3 | 结构 | 实测设置行统一 `--settings-row-min-height: 44px` | 4.2 | packages/app/src/settings/settings.css:11 | DONE |
| WS-S4 | 结构 | 文件树与内容区各自滚动，符合主从分栏 | 4.1 | packages/app/src/workspaces/files/tree-machine.ts | DONE |
| WS-T1 | 状态 | 文件树与内容各有独立 `machine.ts` | 7.1 | packages/app/src/workspaces/files/tree-machine.ts,content-machine.ts | DONE |
| WS-T2 | 状态 | 目录选择加载态用 `Loader` | 7.2 | packages/app/src/workspaces/selection/dialog.tsx:670 | TODO |
| WS-T3 | 状态 | 目录选择错误态没有弹窗内字段级错误 | 7.2 | packages/app/src/workspaces/selection/dialog.tsx:710 | TODO |
| WS-C1 | 刻度 | 目录选择内联样式大量 `!important` 与 24px/15px/6px 字面量 | 2/3/4.2 | packages/app/src/workspaces/selection/dialog.tsx:559-610 | TODO |
| WS-C2 | 刻度 | 目录选择边框 `1px solid` | 4.4 | packages/app/src/workspaces/selection/dialog.css:87 | TODO |
| WS-C3 | 刻度 | 工作区路径用内联 `color-mix(in oklch, ...)` 造底色 | 2 | packages/app/src/settings/workspaces/workspaces.tsx:655 | TODO |
| WS-I1 | 交互 | 目录输入支持键盘处理 | 7.3 | packages/app/src/workspaces/selection/dialog.tsx:717 | DONE |
| WS-I2 | 交互 | 删除工作区有确认按钮 | 5.1 | packages/app/src/settings/workspaces/workspaces.tsx:603 | DONE |
| WS-I3 | 交互 | 目录选择关闭后焦点回触发点未验证 | 7.3 | packages/app/src/workspaces/selection/dialog.tsx:670 | TODO |
| WS-I4 | 交互 | 文件树行没有可见焦点环 | 7.3 | packages/app/src/workspaces/files/tree-machine.ts | TODO |

## new-session

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| NS-S1 | 结构 | 新建会话单列最大宽度改为 660px | 6.6 | packages/app/src/new-session/wordmark.tsx:132 | DONE |
| NS-S2 | 结构 | 项目与工作区选择器宽度写死 `max-w-[160px]` / `max-w-[220px]` | 4.1 | packages/app/src/new-session/project/selector.tsx:100 | TODO |
| NS-S3 | 结构 | 工作区浮层写死 `w-[243px]` | 4.1 | packages/app/src/new-session/workspace/selector.tsx:153 | TODO |
| NS-T1 | 状态 | 新建会话有 `machine.ts` | 7.1 | packages/app/src/new-session/machine.ts | DONE |
| NS-T2 | 状态 | 工作区列表有原地重试 | 7.2 | packages/app/src/new-session/workspace/selector.tsx:166 | DONE |
| NS-T3 | 状态 | 空状态只有输入框，缺最近项目卡片 | 6.6 | packages/app/src/new-session/view.tsx:325 | TODO |
| NS-C1 | 刻度 | 工具行 `text-[15px]` 字面量 | 3 | packages/app/src/new-session/view.tsx:226,325 | TODO |
| NS-C2 | 刻度 | 砖块小游戏 HUD 写 `text-[12px] leading-[16px]` | 3 | packages/app/src/new-session/brick-breaker.tsx:54 | TODO |
| NS-C3 | 刻度 | 画布取色 fallback 使用 hex 字面量 | 2 | packages/app/src/new-session/pin-board.tsx:939-949 | TODO |
| NS-I1 | 交互 | 工作区定位对话框支持键盘 | 7.3 | packages/app/src/new-session/location/dialog.tsx:416 | DONE |
| NS-I2 | 交互 | 项目选择器有 `focus-visible` 背景反馈 | 7.3 | packages/app/src/new-session/project/selector.tsx:100 | DONE |
| NS-I3 | 交互 | 关闭浮层焦点回触发点未验证 | 7.3 | packages/app/src/new-session/workspace/selector.tsx:153 | TODO |

## session

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| SS-S1 | 结构 | 侧栏面板宽度可拖拽，未写死 | 4.1 | packages/app/src/session/screen.tsx:506 | DONE |
| SS-S2 | 结构 | 会话准备页补 `data-scrollable` | 8 | packages/app/src/session/route.tsx:77 | DONE |
| SS-S3 | 结构 | 实测时间线走 `ScrollView`，侧面板 `overflow-hidden` 内各自滚动，无共用滚动 | 8 | packages/app/src/session/screen.tsx:521 | DONE |
| SS-T1 | 状态 | 时间线有 `machine.ts` 与分辨率状态机 | 7.1 | packages/app/src/session/timeline/machine.ts | DONE |
| SS-T2 | 状态 | 输入队列有 `queue-machine.ts` | 7.1 | packages/app/src/session/composer/queue-machine.ts | DONE |
| SS-T3 | 状态 | 会话准备态没有说明原因的文案行 | 7.2 | packages/app/src/session/route.tsx:77 | TODO |
| SS-C1 | 刻度 | 队列行用 `text-[15px]` 字面量 | 3 | packages/app/src/session/composer/queue-panel.tsx:223 | TODO |
| SS-C2 | 刻度 | 输入区渐变遮罩用 `#000` 字面量 | 2 | packages/app/src/session/composer/spring-height.tsx:344 | TODO |
| SS-C3 | 刻度 | 活动胶囊用 `border-[0.5px]`，符合边框档 | 4.4 | packages/app/src/session/composer/activity-chips.tsx:239 | DONE |
| SS-I1 | 交互 | 工作活动行 `focus-visible:outline-none`，无可见焦点环 | 7.3 | packages/app/src/session/timeline/working-activity.tsx:100 | TODO |
| SS-I2 | 交互 | 队列项有排序按钮名称 | 10 | packages/app/src/session/composer/queue-panel.tsx:211 | DONE |
| SS-I3 | 交互 | 时间线没有方向键在消息间移动的证据 | 7.3 | packages/app/src/session/timeline | TODO |
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
| CO-C1 | 刻度 | 变体滑块用 `#ffffff` 与 rgba 阴影字面量 | 2 | packages/app/src/composer/editor/variant-slider.css:6,7,11 | TODO |
| CO-C2 | 刻度 | 编辑器用两处 `!important` 覆盖共享样式 | 4 | packages/app/src/composer/editor/editor.css:310,311 | TODO |
| CO-C3 | 刻度 | 拖拽遮罩用 rgba 渐变字面量 | 2 | packages/app/src/composer/dropzone.tsx:68,70 | TODO |
| CO-I1 | 交互 | 编辑器支持完整键盘处理 | 7.3 | packages/app/src/composer/editor/editor.tsx:391 | DONE |
| CO-I2 | 交互 | 变体滑块支持键盘 | 7.3 | packages/app/src/composer/editor/variant-slider.tsx:85 | DONE |
| CO-I3 | 交互 | 附件删除按钮有可访问名称 | 10 | packages/app/src/composer/editor/editor.tsx:900,929,977 | DONE |
| CO-I4 | 交互 | 附件上传取消没有焦点回退处理 | 7.3 | packages/app/src/composer/editor/editor.tsx:1000 | TODO |

## 未解冲突

| 冲突 | 文档与代码现状 | 处理 |
| --- | --- | --- |
| 弹窗宽度 | 标准 5.6 为 640–880；共享 `Dialog` 默认 480，`large` 640，`x-large` 980 | 按 5.6 采用 640/880，`x-large` 980 不用于普通表单；已在 B6 处理 |
| 菜单面板圆角 | 标准 4.3/5.7 为 8px；现有 `menu.css` 为 8px | 不冲突，按 8px 保留 |
| 工具栏按钮数量 | 标准 5.1 最多 2 个 icon；实测水平标题栏只有首页、搜索 2 个（SH-S3 已改判 DONE），垂直侧栏的品牌区是命令面板快捷键文本，不属工具栏 | 无冲突 |
| 状态点尺寸 | 标准 5.2 为 6px；`servers/registry/row.tsx` 用 `size-1.5`=6px | 一致，无需改 |
| 页面标题字号 | 标准 3 为 20–21px；home 现为 26px | 按标准改，见 HM-C2 |
| 服务器注册表行结构 | 标准 5.2 要求固定「图标 → 标题+状态点 → 副标题 → 元信息」；`packages/app` 内只有健康点组件，整行由 `packages/gui-plugins` 渲染，超出本轮可改范围（仅 app/ui/session-ui） | 原 SV-S4 条目移出计数，留待范围放开后按 5.2 重排 |
| 收件箱页面数据源 | 标准 7.2 要求页面具备加载/错误/部分失败三态；`inbox/route.tsx` 目前没有 producer（`packages/app` 内无收件箱数据源，侧栏收件箱只聚合会话事件），无数据可驱动这三态 | 原 IB-T3 条目移出计数；页面保留主从骨架与空态，待收件箱数据源落地后按 7.2 补分支 |
| 运行历史条数 | 标准 6.1 要求「最近记录固定 5 条」；`Schedule.Info` 只提供 `lastFiredAt`、`lastOutcome`、`lastOutput`、`runCount`，没有运行历史数组，也没有 list-runs 端点（改端点属 schema/server，禁改） | `scheduled` 详情按真实数据渲染 1 条并给空态，不补 4 条假记录；需要服务端补 `schedule.runs` 后才谈 5 条 |

## 进度

- 条目：160
- TODO：67
- DONE：93
- 口径：每条一个可复核的代码位置，同一问题不重复立项；后续每完成一项把该行改成 DONE 并补齐 `文件:行`。
