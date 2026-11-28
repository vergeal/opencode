# Solid → React 迁移扫描清单

扫描日期：2026-11-27。范围：全仓移除 solid，技术栈切换 React；`packages/tui` 整包删除（本项目只做 Electron 桌面客户端）。

## 一、总规模

| 类别 | 数量 |
|---|---|
| 待改源码文件（非 tui，引用 solid 生态） | **789** |
| 其中 TSX | ~600+ |
| 待改非源码文件（package.json / tsconfig / vite / 文档 / 脚本） | ~232 |
| 整包删除 | `packages/tui`（208 文件 / 66,546 行） |

### 按包分布（待改源码文件）

| 包 | 文件数 | 说明 |
|---|---|---|
| app | 461 | 大头，~110K 行；`src/` 下 96K 行含 solid |
| ui | 111 | 组件库，被 app/session-ui 依赖 |
| gui-plugins | 77 | 插件宿主侧内置插件 |
| session-ui | 70 | 含 SSR markdown 渲染（`isServer`） |
| stories | 15 | storybook 框架 |
| aix | 14 | 插件 SDK，含 `src/tui/` 目录（随 tui 删） |
| web | 12 | PWA 入口 |
| client | 11 | `src/solid/` 导出子路径（`@aicraft/client/solid`） |
| desktop | 10 | main 进程插件模块测试引用 solid |
| cli | 8 | 删 tui 后残留引用清理 |

## 二、Solid API 使用量（非 tui，按出现次数）

### 响应式核心 → React hooks / 状态库

| API | 次数 | React 对应 |
|---|---|---|
| createMemo | 1,987 | useMemo / 派生状态（需逐处评估失效依赖） |
| cache | 1,785 | 无直接对应，多为 memo/Map 改写 |
| createSignal | 764 | useState / useSyncExternalStore |
| onCleanup | 725 | useEffect cleanup |
| createEffect | 565 | useEffect（细粒度→依赖数组，语义差异最大点） |
| createStore (solid-js/store) | 392 / 252 文件 | 需选型：zustand / immer+context；produce 279、reconcile 268、unwrap 172 处 |
| createRoot | 285 | 无直接对应，多为 disposable 模式改写 |
| batch | 403 | 移除或换 flushSync/自动批处理 |
| untrack | 281 | 移除 |
| onMount | 273 | useEffect |
| createComponent | 70 | 直接 JSX |
| onError | 139 | ErrorBoundary |
| createResource | 79 | 换 @tanstack/react-query |
| createComputed | 50 | 视场景 |
| createRenderEffect | 24 | — |
| createTransition/startTransition | 3/29 | React 19 useTransition |
| Accessor 类型 | 遍布 | 函数调用 `foo()` → 值 `foo`，机械但量大 |

### JSX 控制流组件

| 组件 | 次数 | React 对应 |
|---|---|---|
| `<Show>` | 1,637 | 三元 / && |
| `<For>` | 343 | map + key |
| `<Match>` / `<Switch>` | 200 / 87 | 条件链 |
| `on:*` 事件指令 | 1,587 | onClick 等 |
| `<Key>` (solid-primitives/keyed) | 151 | key 强制重挂载 |
| `<Index>` | 16 | map |
| `<Dynamic>` | 25 | 组件变量 |
| `<Portal>` | 23 | createPortal |
| `<ErrorBoundary>` | 12 | 自写/ErrorBoundary 库 |
| `use:` 自定义指令 | 69 | 无对应，需改 hook/组件封装 ⚠️ |
| `ref=` | 397 | useRef callback |

### solid-js/web 特殊入口（48 文件）

- `render` / `createComponent`：入口 + 全部测试 fixture（~20 处）→ ReactDOM `createRoot`
- `spread`（ui/overlays/tooltip）：指令运行时，需手写合并 props
- `insert`（app/components-lab）：手动 DOM 插入，需重写
- `isServer`（session-ui/markdown.tsx）：SSR 分支，React 换 `renderToStaticMarkup` 路线 ⚠️

## 三、生态依赖替换表

| 现依赖 | 文件数 | 替换为 |
|---|---|---|
| @solid-primitives/* | 99 | 逐个换：event-listener/resize-observer/media/storage → React 等价 hook 或社区库 |
| @solidjs/router | 52 | react-router（路由结构重做，含 test-browser 里 router cleanup 测试） |
| @tanstack/solid-query | 39 | @tanstack/react-query（API 基本同构，机械替换） |
| @tanstack/solid-virtual | 4 | @tanstack/react-virtual |
| @solidjs/meta | 6 | react-helmet 或 desktop 场景直接删 |
| solid-sonner | 1 | sonner |
| solid-list | 2 | 自实现或换库 |
| @dnd-kit/solid | 4 | @dnd-kit/react |
| @sentry/solid | 4 | @sentry/react |
| corvu（Solid 无头组件） | 4 | 换 @radix-ui / react-aria 或自研 ⚠️ |
| @aicraft/client/solid | client 11 文件 + 宿主引用 | 新建 `@aicraft/client/react` 导出 |

## 四、构建 / 配置 / 基建改动点

- `package.json`（root）：catalog 中 solid-js、@opentui/*、vite-plugin-solid、@solidjs/*、@tanstack/solid-* 全部移除；新增 react、react-dom、vite react 插件、react-router 等
- `patches/solid-js@1.9.17.patch`：删除（注意 patch 里修的问题 React 侧是否需要另行处理）
- `patches/@corvu%2Fdrawer@0.2.4.patch`、`@dnd-kit%2Fdom` patch：随依赖替换处理
- tsconfig `jsxImportSource: solid-js`：app / desktop / gui-plugins / session-ui / stories / ui / web 共 7 处 → `react`；cli / tui 的 `@opentui/solid` 随删除消失
- vite 配置：`packages/ui/vite.config.ts`、`packages/app/vite.js`、`packages/stories/vite.config.ts`（含 dedupe 列表）、`packages/app/e2e/reproduction/timeline-suspense/vite.config.ts`、`packages/cli/vite.node.config.ts`、`packages/aix/src/gui/vite.ts` → 换 `@vitejs/plugin-react`
- `.oxlintrc.json`：solid-js 相关规则（2 处）
- `turbo.json`：`@aicraft/tui#typecheck:tsc` 等 tui 任务
- root scripts：`dev:live` / `dev:vite:live` 的 `AICRAFT_TUI_CHANNEL`、`upgrade-opentui` 脚本
- `bunfig.toml` / `packages/app/package.json` 测试脚本：`--conditions=solid`、`--preload ../ui/test/solid-jsx.ts`（该 preload 文件本身删除，换成 React 测试基建）
- 测试基建：component-tests 60 + test-browser 57 + e2e 102 文件，其中 88 个含 solid 字样；`packages/desktop/src/main/plugin/module.test.ts` 断言 vite-plugin-solid 产物格式，需重写为 React 插件产物断言

## 五、插件宿主共享机制（架构级，风险最高）⚠️

- `packages/app/src/runtime/plugin/module.ts` L23-26：宿主向插件共享 `solid-js` / `solid-js/web` / `solid-js/store` / `@aicraft/client/solid` 单例 → 换成 react / react-dom / client/react
- `packages/aix/src/gui/modules.ts` L25-31：插件 SDK 声明外部共享模块同名清单 → 同步改，**这是对外插件 API 的 breaking change**，aix 版本号与迁移公告要跟上
- gui-plugins 77 文件是"自家插件"，同时充当宿主机制的验证样本
- `packages/aix/src/host.ts` / `bundle.ts`：`tui` entry kind 解析随 TUI 删除

## 六、TUI 删除的连带改动点

- 整删 `packages/tui`
- `packages/cli`：`package.json` 依赖、`dev/vite.ts`（bundle @aicraft/tui）、`dev/host.d.ts`（TuiInput）、`src/ui/timeline.tsx`、`src/config/schema.ts`、`src/config/migrate.ts`、`test/import-boundaries.test.ts`（大量 packages/tui 路径断言）
- `packages/theme`：`src/tui/` 整个子目录（7 文件引用 @opentui/core）、package.json exports `./tui`
- `packages/aix`：`src/tui/` 目录、package.json 的 @opentui/solid 依赖与 exports、host/bundle 的 tui entry
- root：catalog @opentui/*、`script/upgrade-opentui.ts`、turbo tui 任务、`AICRAFT_TUI_CHANNEL` 脚本变量

## 七、app 包内最大单文件（重点评审对象）

| 文件 | 行数 |
|---|---|
| src/composer/editor/editor.tsx | 1,933 |
| src/providers/connect/dialog.tsx | 1,818 |
| src/session/requests/session-question-dock-experimental.tsx | 1,575 |
| src/shell/replica/sidebar.tsx | 1,538 |
| src/runtime/plugin/host-apis.tsx | 1,224 |
| src/home/sessions/view.tsx | 1,215 |
| src/shell/titlebar/inbox.tsx | 1,186 |
| src/runtime/plugin/host.tsx | 1,078 |
| src/session/timeline/answer-timeline.tsx | 965 |
| src/settings/providers/providers.tsx | 916 |

## 八、建议执行顺序（成本最优）

1. **Phase 0 — 删 TUI**：整删 tui + cli/theme/aix 连带 + root 配置。跑通 `bun run dev:desktop` 与全量 typecheck。
2. **Phase 1 — 选型与地基**：定状态方案（createStore 的 252 文件如何映射）、react-router、query 替换；搭 `@vitejs/plugin-react`、测试 preload、`@aicraft/client/react`。
3. **Phase 2 — 自底向上迁移**：ui → session-ui → client(react 导出) → app 叶子模块 → app 核心（composer/timeline/shell）→ gui-plugins + 宿主共享机制（同批验证）→ web/stories/desktop。
4. **Phase 3 — 清尾**：删 patches/solid-js、oxlint 规则、文档、`--conditions=solid`，全量 e2e 回归。

每个 Phase 内按包分小批（10–20 文件/批），每批独立 session 控制上下文重发成本。
