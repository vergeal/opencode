# Replica 玻璃外观优化 — 工作项分组

## 背景与统一约束

replica 壳在 macOS 上使用原生 vibrancy（`under-window`）+ 半透明 tint 近似 Liquid Glass。桌面层的真实折射/动态高光在 Web 里无法实现，因此目标不是复刻，而是：**克制、可读、可降级**。

所有模块共用以下约束：

- 主区（conversation）必须保持实色，不参与玻璃化。
- 改动范围默认只允许：`packages/app/src/shell/replica/replica.css`、`packages/desktop/src/main/windows/defaults.ts`。越界需在 PR 说明原因。
- 验收必须用**系统截图**（窗口背后要有壁纸），页面截图看不到 vibrancy，不能作为玻璃效果的证据。
- 不得回归：非 macOS 的 `opaque` 路径、Windows/Linux 布局、mobile（`data-slot="destination-bar"`）布局、主题切换。
- 提交信息 `type(scope): summary`；分支名不超过三个词、用连字符。
- 每个 PR 附浅色 + 深色两张系统截图。

---

## 模块 A：窗口材质与失焦行为（Electron 主进程）

**建议负责人**：桌面端小组　**建议工作量**：0.5 天　**依赖**：无（可最先合入）

**范围**
- `packages/desktop/src/main/windows/defaults.ts:59-71` 的 `platformFrame()`。

**改动点**
1. `frame.vibrancy` 从 `"under-window"` 改为 `"sidebar"`（可先在本地 A/B，取观感更好者），目的是减少壁纸色彩的饱和渗透——目前紫色壁纸会明显染进玻璃。
2. `frame.visualEffectState` 从 `"active"` 改为 `"followWindow"`，让窗口失焦时材质自动退让，符合 macOS 原生行为。
3. 保持 `titleBarStyle: "hidden"`、`trafficLightPosition`、`roundedCorners` 现有逻辑不变。

**验收**
- 浅色/深色下，同一张彩色壁纸透出的颜色明显更中性。
- 切换到其它应用后，玻璃变灰、变实；切回后恢复。
- Windows/Linux 行为零变化（该分支只在 `darwin` 内）。

**风险**：`sidebar` 材质对深色模式更暗，需与模块 C 的深色导航不透明度一起看，必要时回调模块 C 的数值而不是材质。

---

## 模块 B：系统无障碍降级（CSS）

**建议负责人**：前端基础/无障碍小组　**建议工作量**：0.5 天　**依赖**：可与 A 并行，验收需在 A 之后

**范围**
- `packages/app/src/shell/replica/replica.css` 文件末尾新增媒体查询块，不修改现有规则。

**改动点**
1. `@media (prefers-reduced-transparency: reduce)`：在 `html[data-replica-window="translucent"]` 下把 `--color-titlebar` / `--color-rail` / `--color-navigation` 换成实色（例：浅色 `rgb(246 246 246)`、深色 `rgb(21 21 21)`），并让 `[data-replica]` 恢复不透明背景。
   - 注意：`packages/ui/src/styles/base.css:450-458` 已有 `prefers-reduced-transparency` 分支，负责把 `--v2-material-blur-*` 置 `none` 并切到 opaque surface。**不要重复实现浮层部分**，只补 replica chrome 的着色。
2. `@media (prefers-contrast: more)`：把 `--color-divider` 加深一档，保证 workbench 边框在玻璃上可见。
3. `@media (forced-colors: active)`：把 `background`/`box-shadow` 交还给系统色（`Canvas`、`CanvasText`），移除 `inset 0 1px 0` 高光。

**验收**
- 系统偏好设置开启「降低透明度」后重启应用，窗口无明显透视，文字对比达标。
- 开启「增强对比度」后，面板边框清晰可见。
- 未开启任何偏好时，渲染与当前完全一致（逐像素对比截图）。

**风险**：Chromium 对 `prefers-reduced-transparency` 的支持需先确认；若不支持，改用主进程读取 `nativeTheme`/系统设置后下发一个 `data-` 属性。

---

## 模块 C：导航层次与高光（CSS）

**建议负责人**：视觉小组　**建议工作量**：1 天　**依赖**：无

**范围**
- `replica.css:128-175`（tint 规则与顶部高光）、`replica.css:146-161`（深色导航）。

**改动点**
1. 浅色下 `[data-slot="replica-sidebar"]` 与 `[data-slot="replica-rail"]` 目前完全同色（都是 `rgb(246 246 246 / 62%)`），导航区没有层次。在 sidebar 上叠加 `rgb(255 255 255 / 8%)`～`12%`，恢复「侧栏比 rail 略亮」。**注意**：叠加不得让 workbench 圆角缺口出现色差三角（缺口由 shell 层提供底色），需截图检查四个角。
2. `titlebar` 与 `sidebar` 各有一条 `inset 0 1px 0` 高光（`replica.css:165-173`），相距 39px，读起来是两条平行亮线。建议只在 `titlebar` 保留，或改为 `linear-gradient(180deg, rgb(255 255 255 / 55%), transparent 1px)`，让圆角处更柔和。
3. 深色下 `titlebar` 62% 与导航 90% 是硬切换（`replica.css:146-161`）。在 `[data-slot="replica-shell"]` 顶部加 8–12px 渐变，从 `--color-titlebar` 过渡到 `--color-navigation`，消除水平断层。

**验收**
- 浅色/深色四个角的圆角干净，无亮/暗三角。
- 导航区与 rail 有可辨识但不刺眼的层次。
- 顶部只有一条高光线，且高光在圆角处跟随弧线。

**风险**：所有改动都与模块 D 同一文件，合入顺序上先 C 后 D，或 D 只改几何相关行以降低冲突。

---

## 模块 D：面板几何与边界（CSS）

**建议负责人**：视觉小组（与 C 同一人更佳）　**建议工作量**：0.5 天　**依赖**：C 先合入，或约定 D 只改指定行

**范围**
- `replica.css:51`、`:111`（`--color-divider`）、`:68`（`--radius-panel`）、`:76`、`:122`（`--shadow-panel`）、`:256-260`（workbench 边框/圆角/阴影）。

**改动点**
1. `--radius-panel` 从 `16px` 降到 `12px`～`14px`，更接近 macOS 原生窗口圆角；同步调整 `--shadow-panel` 的扩散半径，避免大圆角配大阴影显得像卡片。
2. 玻璃态下 `--color-divider: #eeeeee` 叠在 62% 白上几乎不可见。为 translucent 场景单独提供一个更深的 divider（如 `rgb(0 0 0 / 6%)`），只作用于 `[data-slot="replica-workbench"]` 的边框与 `[data-slot="replica-sidebar-slot"]` 的分隔线。
3. 复核 `border: 1px solid` 在 `devicePixelRatio` 非整数（当前窗口 dpr 1.25 实际渲染为 0.8px）下的观感，必要时改用 `box-shadow: inset 0 0 0 1px` 保证 1 物理像素。

**验收**
- 圆角与 macOS 系统窗口并排对比不突兀。
- 面板边界在浅色、深色、纯白壁纸、彩色壁纸四种情况下均可见。
- 圆角缩小后，圆角缺口仍与导航层同色。

---

## 模块 E：性能与功耗（验证）

**建议负责人**：性能小组　**建议工作量**：1 天　**依赖**：A/C/D 合入后执行

**范围**：不改产品代码，产出报告与阈值建议。

**内容**
1. 在长会话（≥200 条消息）中滚动，记录主线程帧率与 GPU 占用（Activity Monitor / Chrome tracing）。
2. 对比玻璃开启与关闭（`opaque`）时的空闲功耗与内存。
3. 对比滚动时 `backdrop-filter` 叠加 vs 纯 vibrancy（当前实现不用 `backdrop-filter`，确认不要引入）。
4. 结论落成一段「是否允许继续增加玻璃面积」的建议。

**验收**：报告包含数字、测试机型号、macOS 版本；如发现滚动掉帧，给出具体元素与建议降级方式。

---

## 模块 F：跨平台与回归（验证）

**建议负责人**：QA　**建议工作量**：0.5 天　**依赖**：A–D 全部合入

**检查清单**
- Windows：`opaque` 路径、`roundedCorners: false`、标题栏覆盖层按钮位置。
- Linux：无 vibrancy 分支时的实色路径。
- Web（`dev:web`）：`data-replica-window="opaque"`，不应出现透明/露底。
- mobile 布局：`[data-slot="destination-bar"]` 在 translucent 下透明后是否与 `[data-replica]` 底色协调。
- 主题切换（浅 → 深 → 浅）：无闪烁、无残留透明、`data-color-scheme` 与变量同步。
- 侧栏折叠/展开动画、拖拽调宽（`data-resizing`）过程中不出现三角或闪烁。

---

## 模块 G：浮层 blur 与 vibrancy 叠加（新发现，待派工）

**建议负责人**：UI 基础小组　**建议工作量**：0.5 天　**依赖**：A 合入后

**背景**（来自模块 E 报告）：全局浮层使用 `--v2-material-blur-thick: blur(30px) saturate(180%)`，而窗口本身已是系统 vibrancy。当浮层出现在侧栏/标题栏等玻璃区域之上时，`backdrop-filter` 会对已经模糊过的材质再模糊一次，结果是发灰、透明度叠加、合成成本上升。

**涉及的浮层**（`backdrop-filter: var(--v2-material-blur-thick)`）：
- `packages/ui/src/navigation/menu/menu.css:17`
- `packages/ui/src/components/popover.css:11`
- `packages/ui/src/components/context-menu.css:10`
- `packages/ui/src/components/hover-card.css:14`
- `packages/ui/src/forms/select/select.css:17`
- `packages/ui/src/feedback/toast/toast.css:32`
- `packages/ui/src/overlays/dialog/dialog.css:28`
- `packages/app/src/settings/appearance/font-picker.css:65`
- tooltip 用 `--v2-material-blur-regular`（`packages/ui/src/overlays/tooltip/tooltip.css:21,55`）

**改动点**
1. 为 `html[data-replica-window="translucent"]` 增加一段，把 `--v2-material-blur-thick` / `--v2-material-blur-regular` 置 `none`，并让 `--v2-material-surface` / `-strong` 切到 `-opaque` 版本（与 `base.css:450-458` 的 reduced-transparency 分支保持同一组变量，避免两套逻辑）。
2. 只影响浮层，不改主区与 composer。
3. 如果某个浮层在去 blur 后与背景区分不足，给它单独加 `box-shadow`，而不是重新加回 blur。

**验收**
- 命令面板、右键菜单、select、dialog、toast 打开时不发灰，文字边缘清晰。
- 浮层出现在主区之上（背后是白色内容）与出现在侧栏之上（背后是 vibrancy）观感一致。
- 与系统「降低透明度」开启后的效果不冲突（两条路径产出相同的变量值）。

**风险**：部分浮层依赖 blur 制造层次感，去 blur 后需要靠阴影补，需逐个截图确认。

---


1. A（主进程材质）— 已完成，提交 `3a26199a05`
2. C（导航层次与高光）
3. D（几何与边界）
4. B（无障碍降级，基于最终着色值）
5. G（浮层 blur 与 vibrancy 叠加）
6. E、F 验证并出报告

C 与 D 触及同一文件，必须约定先 C 后 D，或拆成两个连续的小 PR，避免冲突。
