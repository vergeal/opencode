# UI 审计：按 `docs/opencode-ui-standard.md` 与 `docs/ui-acceptance-standard.md`

证据来源：仓库代码与 grep 输出（逐条带 `文件:行`）。**按本会话约束不做截图识别**，验收证据以代码行与命令输出为准。

统计：条目 **160**，TODO **105**，DONE **55**。类别分布：结构 40 / 状态 38 / 刻度 38 / 交互 44。

表内 `T` 为 TODO 数，`D` 为 DONE 数。

| 页面 | 结构 | 状态 | 刻度 | 交互 | 结论 |
| --- | --- | --- | --- | --- | --- |
| shell | T4 / D0 | T3 / D0 | T4 / D0 | T4 / D2 | 未达标 |
| home | T4 / D0 | T4 / D0 | T4 / D0 | T3 / D1 | 未达标 |
| inbox | T3 / D0 | T3 / D0 | T3 / D0 | T3 / D0 | 未达标 |
| scheduled | T3 / D1 | T2 / D2 | T3 / D1 | T1 / D3 | 未达标 |
| knowledge | T0 / D4 | T2 / D2 | T3 / D1 | T2 / D2 | 未达标 |
| settings | T1 / D3 | T2 / D2 | T4 / D0 | T1 / D3 | 未达标 |
| servers | T3 / D1 | T1 / D3 | T2 / D1 | T1 / D3 | 未达标 |
| workspaces | T2 / D2 | T2 / D1 | T3 / D0 | T2 / D2 | 未达标 |
| new-session | T3 / D0 | T1 / D2 | T3 / D0 | T1 / D2 | 未达标 |
| session | T2 / D1 | T1 / D2 | T2 / D1 | T2 / D2 | 未达标 |
| composer | T3 / D0 | T1 / D2 | T3 / D0 | T1 / D3 | 未达标 |

## shell

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| SH-S1 | 结构 | 收件箱侧栏列表滚动容器未标记 `data-scrollable`，嵌套滚动无法被外层识别 | 8 | packages/app/src/shell/titlebar/inbox.tsx:356 | TODO |
| SH-S2 | 结构 | 垂直标签条自建滚动区，同样缺 `data-scrollable` | 8 | packages/app/src/shell/titlebar/tab-strip.tsx:543 | TODO |
| SH-S3 | 结构 | 标题栏同时暴露首页、搜索、命令面板三个图标按钮，超过「最多 2 个 icon + 溢出」 | 5.1 | packages/app/src/shell/titlebar/titlebar.tsx:362,386,744 | TODO |
| SH-S4 | 结构 | 归档会话弹窗用内联 `!w-[min(calc(100vw_-_32px),560px)]` 覆盖宽度，停在非 640/880 | 5.6 | packages/app/src/shell/titlebar/inbox.tsx:758 | TODO |
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
| HM-S1 | 结构 | 首页详情列写死 `minmax(0,720px)`，不随容器自适应放大 | 4.1 | packages/app/src/home/route.tsx:43-44 | TODO |
| HM-S2 | 结构 | 项目列表滚动容器缺 `data-scrollable` | 8 | packages/app/src/home/projects/view.tsx:225 | TODO |
| HM-S3 | 结构 | 会话搜索框宽度字面量 `max-w-[420px]` | 4.1 | packages/app/src/home/sessions/view.tsx:381 | TODO |
| HM-S4 | 结构 | 搜索结果浮层 `rounded-[12px]`，与列表行的 9–10px 不统一 | 4.3 | packages/app/src/home/sessions/view.tsx:318 | TODO |
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
| IB-S1 | 结构 | 收件箱页只有空态块，没有标准要求的顶部筛选行 | 6.3 | packages/app/src/inbox/route.tsx:16 | TODO |
| IB-S2 | 结构 | 页面没有列表/详情骨架，有数据时无处承载 | 6.3 | packages/app/src/inbox/route.tsx:14-25 | TODO |
| IB-S3 | 结构 | 收件箱真正列表位于侧栏，页面与侧栏两处入口结构不一致 | 6.3 | packages/app/src/shell/titlebar/inbox.tsx:356 | TODO |
| IB-T1 | 状态 | 空态只有说明与 hint，没有下一步动作按钮 | 7.2 | packages/app/src/inbox/route.tsx:20-23 | TODO |
| IB-T2 | 状态 | 空态图标用 `rounded-[9px]` 字面量，未用标准圆角档 | 4.3 | packages/app/src/inbox/route.tsx:17 | TODO |
| IB-T3 | 状态 | 页面无加载、错误、部分失败分支 | 7.2 | packages/app/src/inbox/route.tsx:14 | TODO |
| IB-C1 | 刻度 | 正文用 `text-[15px]`，标准 UI 正文为 13px | 3 | packages/app/src/inbox/route.tsx:20 | TODO |
| IB-C2 | 刻度 | 同页混用 15px 与 13px，层级不稳定 | 3 | packages/app/src/inbox/route.tsx:21 | TODO |
| IB-C3 | 刻度 | 图标容器 `rounded-[9px]` 为字面量 | 4.3 | packages/app/src/inbox/route.tsx:17 | TODO |
| IB-I1 | 交互 | 空态没有可聚焦动作，键盘无法继续 | 7.3 | packages/app/src/inbox/route.tsx:16 | TODO |
| IB-I2 | 交互 | 页面没有筛选与键盘导航 | 7.3 | packages/app/src/inbox/route.tsx | TODO |
| IB-I3 | 交互 | 空态说明没有语义角色 | 10 | packages/app/src/inbox/route.tsx:20 | TODO |

## scheduled

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| SC-S1 | 结构 | 主从分栏靠 `flex` 宽度写死，缺少 `@container`，窄容器不会先收详情 | 4.1 | packages/app/src/scheduled/scheduled.css:20-36 | TODO |
| SC-S2 | 结构 | 列表自建 `overflow-y-auto`，缺 `data-scrollable` | 8 | packages/app/src/scheduled/scheduled.css:34 | TODO |
| SC-S3 | 结构 | 搜索框独占一行，未与筛选 chip 组成单行工具栏 | 6.1 | packages/app/src/scheduled/scheduled.css:14 | TODO |
| SC-S4 | 结构 | 列表宽 320px，落在 300–360 区间 | 4.1 | packages/app/src/scheduled/scheduled.css:31 | DONE |
| SC-T1 | 状态 | 有 `machine.ts` 判别联合承载生命周期 | 7.1 | packages/app/src/scheduled/machine.ts | DONE |
| SC-T2 | 状态 | 错误态有原地重试 | 7.2 | packages/app/src/scheduled/route.tsx:348 | DONE |
| SC-T3 | 状态 | 仅在 `status==="loading"` 给 `Loader`，刷新时清空列表 | 7.2 | packages/app/src/scheduled/route.tsx:303 | TODO |
| SC-T4 | 状态 | 空列表没有「一句说明 + 一个下一步动作」 | 7.2 | packages/app/src/scheduled/route.tsx:303 | TODO |
| SC-C1 | 刻度 | 行内 `gap: 3px` 不在 2/4/8 刻度 | 4.2 | packages/app/src/scheduled/scheduled.css:45 | TODO |
| SC-C2 | 刻度 | 筛选计数 `margin: 6px` 不在刻度 | 4.2 | packages/app/src/scheduled/scheduled.css:9 | TODO |
| SC-C3 | 刻度 | 搜索框宽度 `220px` 字面量 | 4.1 | packages/app/src/scheduled/scheduled.css:16 | TODO |
| SC-C4 | 刻度 | 行圆角 9px、内边距 9/10px，符合档位 | 4.3 | packages/app/src/scheduled/scheduled.css:47-50 | DONE |
| SC-I1 | 交互 | 筛选组有 `role="group"` 与 `aria-label` | 10 | packages/app/src/scheduled/route.tsx:276 | DONE |
| SC-I2 | 交互 | 新建对话框支持键盘操作 | 7.3 | packages/app/src/scheduled/new-dialog.tsx:148 | DONE |
| SC-I3 | 交互 | 列表行没有方向键移动 / Enter 打开的证据 | 7.3 | packages/app/src/scheduled/route.tsx | TODO |
| SC-I4 | 交互 | 删除有 `variant="danger"` 二次确认 | 5.1 | packages/app/src/scheduled/route.tsx:486 | DONE |

## knowledge

| 编号 | 类别 | 问题 | 标准条款 | 文件:行 | 状态 |
| --- | --- | --- | --- | --- | --- |
| KN-S1 | 结构 | 列表、文件区、预览区各自独立滚动 | 4.1/8 | packages/app/src/knowledge/route.tsx:452,730,850 | DONE |
| KN-S2 | 结构 | 列表宽度可拖拽，未写死 | 4.1 | packages/app/src/knowledge/route.tsx:844 | DONE |
| KN-S3 | 结构 | 详情区上限 420px，符合可读下限 | 4.1 | packages/app/src/knowledge/knowledge.css:256 | DONE |
| KN-S4 | 结构 | 文件预览用 `<pre>`，代码字体与正文行高正确 | 3 | packages/app/src/knowledge/route.tsx:877 | DONE |
| KN-T1 | 状态 | 空态有说明与「新建」动作 | 7.2 | packages/app/src/knowledge/route.tsx:458,511 | DONE |
| KN-T2 | 状态 | 预览加载用 `Loader`，非 `Spinner` | 7.2 | packages/app/src/knowledge/route.tsx:873 | DONE |
| KN-T3 | 状态 | 知识库页自身没有行内错误与重试（错误只在设置页） | 7.2 | packages/app/src/knowledge/route.tsx | TODO |
| KN-T4 | 状态 | `store.ts` 直接持有加载状态，没有 `machine.ts` 判别联合 | 7.1 | packages/app/src/knowledge/store.ts | TODO |
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
| SE-S4 | 结构 | 外观页字体列表写死 `sm:w-[220px]` | 4.1 | packages/app/src/settings/appearance/appearance.tsx:53 | TODO |
| SE-T1 | 状态 | 供应商页有 `machine.ts` | 7.1 | packages/app/src/settings/providers/machine.ts | DONE |
| SE-T2 | 状态 | 服务器不可用用 `createStore({ retrying: false })` 布尔替代状态机 | 7.1 | packages/app/src/settings/servers/unavailable.tsx:28 | TODO |
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
| SV-S2 | 结构 | 添加服务器有菜单与按钮两个并行入口 | 5.1 | packages/app/src/servers/registry/add-menu.tsx:30,50 | TODO |
| SV-S3 | 结构 | 连接对话框是多步流程，但没有步骤指示 | 5.6 | packages/app/src/servers/connect/dialog.tsx:144 | TODO |
| SV-S4 | 结构 | 注册表行没有按「图标 → 标题 + 状态点 → 副标题 → 元信息」固定结构 | 5.2 | packages/app/src/servers/registry/row.tsx:7 | TODO |
| SV-T1 | 状态 | 连接流程有 `machine.ts` | 7.1 | packages/app/src/servers/connect/machine.ts | DONE |
| SV-T2 | 状态 | 健康状态由 `health-machine` 派生 | 7.1 | packages/app/src/runtime/server/health-machine.ts | DONE |
| SV-T3 | 状态 | 健康点只靠颜色区分（success/critical/faint），没有文字 | 5.3 | packages/app/src/servers/registry/row.tsx:15-20 | TODO |
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
| WS-S2 | 结构 | 目录选择器没有独立的列表/预览分栏，全部堆在单列 | 6.1 | packages/app/src/workspaces/selection/dialog.tsx:670 | TODO |
| WS-S3 | 结构 | 工作区分组列表复用设置页结构，但行高与设置行 44px 不一致 | 4.2 | packages/app/src/settings/workspaces/workspaces.tsx:434 | TODO |
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
| NS-S1 | 结构 | 单列最大宽度 720px，超出新建会话 660px | 6.6 | packages/app/src/new-session/wordmark.tsx:132 | TODO |
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
| SS-S2 | 结构 | 会话准备页自建滚动区，缺 `data-scrollable` | 8 | packages/app/src/session/route.tsx:77 | TODO |
| SS-S3 | 结构 | 时间线与检查器共用外层滚动，未做到各自独立 | 8 | packages/app/src/session/screen.tsx:320 | TODO |
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
| CO-S1 | 结构 | 作曲器浮层写死 `w-[264px]` | 4.1 | packages/app/src/composer/composer.tsx:196 | TODO |
| CO-S2 | 结构 | 编辑器历史区自建 `overflow-y-auto`，缺 `data-scrollable` | 8 | packages/app/src/composer/editor/editor.tsx:304,336 | TODO |
| CO-S3 | 结构 | 输入区与工具条没有 0.5px 分隔线 | 5.5 | packages/app/src/composer/editor/editor.tsx:361 | TODO |
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
| 工具栏按钮数量 | 标准 5.1 最多 2 个 icon；标题栏现有 3 个 | 按标准收敛，见 SH-S3；若保留搜索必须移入溢出菜单 |
| 状态点尺寸 | 标准 5.2 为 6px；`servers/registry/row.tsx` 用 `size-1.5`=6px | 一致，无需改 |
| 页面标题字号 | 标准 3 为 20–21px；home 现为 26px | 按标准改，见 HM-C2 |

## 进度

- 条目：160
- TODO：105
- DONE：55
- 口径：每条一个可复核的代码位置，同一问题不重复立项；后续每完成一项把该行改成 DONE 并补齐 `文件:行`。
