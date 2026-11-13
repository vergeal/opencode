# Replica 玻璃外观 — 模块 B 复核报告（系统无障碍降级）

- 分支：`replica-a11y`，基线 `lts/ocdev` 20ed8d8861
- 范围：只改 `packages/app/src/shell/replica/replica.css`，全部追加在文件末尾，未修改任何现有规则
- 改动：`prefers-reduced-transparency: reduce`、`prefers-contrast: more`、`forced-colors: active` 三个媒体查询块

## 1. 特性支持探测

环境：Electron 45.2.3 / Chromium 156.0.8078.80（`packages/desktop` 自带的 Electron 二进制）。

方法：`Emulation.setEmulatedMedia` 逐个模拟特性后读 `matchMedia("(feature: value)").matches`，并用一个不存在的特性做对照。

| 特性 | 模拟后 matches | 结论 |
| --- | --- | --- |
| `prefers-reduced-transparency: reduce` | true | 支持 |
| `prefers-contrast: more` | true | 支持 |
| `forced-colors: active` | true | 支持 |
| `prefers-made-up-feature: reduce`（对照） | false | 探测方法有效 |

两个容易踩的坑：

- `CSS.supports("(prefers-reduced-transparency: reduce)")` 返回 **false**，而且 `CSS.supports("(forced-colors: active)")` 也返回 false。`CSS.supports` 的单参数条件形式不能用来判断媒体特性支持。
- `matchMedia(q).media` 在 Chromium 156 对未知特性也不会退化成 `not all`，同样不能作为判据。

因此不需要主进程读取系统设置下发 `data-` 属性，纯 CSS 足够，改动没有跨包。

## 2. 计算样式输出

方法：独立 Electron 窗口加载真实 `replica.css`（`webContents.insertCSS`）与 replica DOM 骨架（`html[data-replica-window="translucent"]` → `#root` → `[data-replica]` → titlebar / rail / shell / sidebar / workbench），然后用 CDP 逐场景模拟并读取 `getComputedStyle`。

> 测试页没有加载 app 的 token 表，所以深色场景里 `--color-divider` 与 workbench 边框读到的空值 / 黑色来自未定义的 `--v2-border-border-muted`；真实应用里该 token 有值，不影响本模块的规则命中判断。

### baseline（未开启任何偏好，应与改前一致）

| 场景 | 元素 | background | box-shadow |
| --- | --- | --- | --- |
| 浅色 | `[data-replica]` | `rgba(246, 246, 246, 0.62)` | none |
| 浅色 | titlebar | `rgba(0, 0, 0, 0)`（由 frame 承载） | `rgba(255,255,255,0.55) 0 1px 0` |
| 浅色 | sidebar | `rgba(0, 0, 0, 0)` | `rgba(255,255,255,0.55) 0 1px 0` |
| 深色 | `[data-replica]` | `rgba(0, 0, 0, 0)`（shell 承载导航面） | none |
| 深色 | titlebar | `rgba(8, 8, 8, 0.62)` | `rgba(255,255,255,0.09) 0 1px 0` |

### `prefers-reduced-transparency: reduce`

| 场景 | 元素 | background |
| --- | --- | --- |
| 浅色 | html / `#root` / `[data-replica]` / titlebar / rail | `rgb(246, 246, 246)`（无 alpha） |
| 浅色 | sidebar | `rgb(252, 252, 252)` |
| 深色 | html / `#root` / `[data-replica]` / titlebar / rail / sidebar | `rgb(21, 21, 21)` |

`--color-titlebar` 在浅色下由 `rgb(246 246 246 / 62%)` 变为 `rgb(246 246 246)`，深色下由 `rgb(8 8 8 / 62%)` 变为 `rgb(21 21 21)`。

### `prefers-contrast: more`

| 场景 | `--color-divider` | workbench 实际边框 |
| --- | --- | --- |
| 浅色 | `#c9c9c9` | `rgb(201, 201, 201)` |
| 深色 | `rgb(255 255 255 / 30%)` | `rgba(255, 255, 255, 0.3)` |

### `forced-colors: active`

| 元素 | background | box-shadow | border-color |
| --- | --- | --- | --- |
| html / `#root` / `[data-replica]` / titlebar / rail / sidebar / workbench | `rgb(255, 255, 255)`（Canvas） | `none` | — |
| workbench / sidebar-slot | — | `none` | `rgb(0, 0, 0)`（CanvasText） |

`inset 0 1px 0` 高光在两个主题下都被移除。

## 3. 复现

```bash
# 计算样式探测（支持性 + 七种场景）
/Users/ekko/Projects/opencode/packages/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  /private/var/folders/6j/dmtcww5s4vscysry2hgh39mw0000gp/T/opencode/replica-css-check.js
```

截图脚本（真实 `replica.css` + 渐变背景代替壁纸，浅/深各 baseline 与 reduce 两张）：
`/private/var/folders/6j/dmtcww5s4vscysry2hgh39mw0000gp/T/opencode/replica-shots.js`，
输出目录 `/private/var/folders/6j/dmtcww5s4vscysry2hgh39mw0000gp/T/opencode/replica-glass/`。

注意：这些是页面渲染截图，不是系统截图。窗口 vibrancy 只能在真实 desktop 窗口里看到。

## 4. 覆盖关系（合并时请复核）

深色下 `[data-replica]` 被 `html[data-replica-window="translucent"][data-color-scheme="dark"] [data-replica] { background: transparent }` 清空（由 shell 承载导航面）。`prefers-reduced-transparency` 块里用**完全相同选择器**、在文件末尾重新赋 `background: var(--color-rail)`，因此靠「同特异度、更晚出现」覆盖，选择器字符串与现有规则逐字一致，可直接 diff 核对。

## 5. 未验证

- macOS 系统开关是否真的驱动 Chromium 的 `prefers-reduced-transparency`（特性本身已确证支持；平台映射需人工开启系统偏好验证，归 pm 合并后执行）。
- `forced-colors` 在 macOS 不触发，未在真实 Windows 高对比度模式验证，属防御性代码。
- 未做「改前/改后」逐像素截图对比；默认状态下的计算样式已逐项与 baseline 比对。
