# 并行开发交接表

基线：`175917f88d`（`lts/ocdev`）

## 分工

| 组 | 会话 | worktree | 分支 | 交付内容 |
|---|---|---|---|---|
| A | `ses_e64812c14ffdCHzXmm40sQaCH7` | `/Users/ekko/Projects/opencode` | `lts/ocdev` | 首页回跳、首页 Composer（由它自己串行执行） |
| B | `ses_e366fd81bffeqgXnMINdNcI1Vk` | `.../worktree/b7d2f0/settings-layout` | `settings-layout` | 设置页改主窗口布局 |
| C | `ses_e366fd5e3ffe2baaB9x6lkfIYN` | `.../worktree/b7d2f0/command-palette` | `command-palette` | 命令面板视觉优化 |
| D | `ses_e366d7555ffeQbJ1WR4dcQ5p6H` | `.../worktree/b7d2f0/explore` | `explore` | 探索页 + 知识库独立入口 |


## 流程（由项目经理执行）

1. 三路各自在 worktree 提交，不 push，不合并。
2. 项目经理逐组核对：commit 列表、改动文件、验收点是否齐全。
3. 项目经理生成合并单，投递到 A 组会话执行 `git merge --no-ff`。
4. A 组合并后跑检查，报告结果。

不在开发会话里写"你自己等别人完成再合并"的指令。

## 各组验收点

### B 设置页主窗口布局
- 打开设置时左侧 rail 与会话侧栏仍在
- 设置二级页面可切换，URL 一致
- 从设置能点回会话
- 767px 以下不横向溢出
- 深色下设置与侧栏不割裂

### C 命令面板视觉
- 不再整屏粗体
- 面板 / 条目 / 图标按钮三级圆角统一
- hover、选中、键盘焦点三态可区分
- 深色对比度正常
- ⌘K、上下键、Enter、Esc 行为不变

### D 探索页
- rail 上探索与知识库是两个独立入口，图标不同
- 探索进入 `/explore` 而非 `/knowledge`
- 插件、技能两个分区可见
- 技能安装/卸载/启用/禁用可用，刷新保留
- 设置里没有重复的技能入口
- Python 插件能力边界有明确说明

## 预期冲突文件

- `packages/app/src/shell/routes/routes.tsx`
- `packages/app/src/shell/shell.tsx`
- `packages/app/src/shell/replica/rail.tsx`
- `packages/app/src/runtime/i18n/en.ts`、`zh.ts`

## 解冲突原则

- 路由：`/explore` 与 `/settings` 都要保留
- 布局：keep-alive 与设置主窗口挂载都要保留
- rail：知识库独立入口与首页回跳逻辑都要保留
- i18n：按 key 合并，不重排、不覆盖

## 合并后验证

- 仓库根目录 `bun run check`
- `packages/app` 下 `bun typecheck`
- 五项功能逐条确认
