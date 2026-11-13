#!/usr/bin/env bash
# 强制结束本仓库所有 OpenCode dev 进程，再按原样重启前端与后端。
#
# 覆盖范围：
#   - 后端：packages/cli 的 `src/index.ts serve --service`（dev 后台服务）
#   - 前端：packages/desktop 的 `bun run dev` / electron-vite / OpenCode Dev.app
#   - 前端：packages/app 的 web dev
#   - 顺带清理 console、www 的 dev
#
# 只匹配本仓库内的 dev 进程，不会动 /Applications 里安装的正式版 OpenCode。
# 注意：如果你正在 dev 版桌面端里运行本脚本，它会把宿主客户端一起杀掉。
#
# 用法：
#   ./restart.sh            杀干净并按原样重启
#   ./restart.sh --dry-run  只列出会被杀掉的进程，不执行

# 需要 bash：用 ./restart.sh 执行。不要用 `sh restart.sh`，POSIX sh 没有数组和进程替换。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT/.restart"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

BUN="$(command -v bun || true)"
[ -n "$BUN" ] || BUN="$HOME/.bun/bin/bun"

SELF="$$"
SELF_PARENT="$(ps -o ppid= -p "$$" | tr -d ' ')"

# cwd 是否在本仓库内。只对 bun/node/electron 这类运行器调用，避免遍历整张进程表。
in_repo() {
  local pid="$1" cwd
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  [ -n "$cwd" ] || return 1
  case "$cwd" in
    "$ROOT" | "$ROOT"/*) return 0 ;;
  esac
  return 1
}

# 判断一个进程是否属于本仓库的 dev。
is_dev() {
  local pid="$1" cmd="$2"
  case "$cmd" in
    # 命令行里带仓库路径的：够精确，直接认。
    *"$ROOT/packages/cli"* | *"$ROOT/packages/desktop"* | *"$ROOT/packages/app"* | \
      *"$ROOT/packages/console"* | *"$ROOT/services/www"* | *"$ROOT/node_modules/.bun/electron-vite"* | \
      *"$ROOT/node_modules/.bun/vite"*)
      return 0
      ;;
  esac
  # 包裹层进程（bun run dev、script/dev.ts）的命令行没有路径，靠 cwd 判断。
  # 只认 dev 运行器，避免把仓库里其他 bun test / node 进程一起杀掉。
  case "$cmd" in
    *bun\ run\ dev* | *bun\ run\ script/dev.ts* | *bun\ --cwd*dev*)
      in_repo "$pid" && return 0
      ;;
  esac
  return 1
}

# 输出：pid<TAB>command
collect() {
  ps -Ao pid=,command= | while read -r pid cmd; do
    [ -z "${pid:-}" ] && continue
    case "$pid" in
      "$SELF" | "$SELF_PARENT") continue ;;
    esac
    is_dev "$pid" "$cmd" && printf '%s\t%s\n' "$pid" "$cmd"
  done
}

ENTRIES=()
while IFS= read -r line; do ENTRIES+=("$line"); done < <(collect)

if [ "${#ENTRIES[@]}" -eq 0 ]; then
  echo "没有发现运行中的 OpenCode dev 进程。"
else
  echo "发现 ${#ENTRIES[@]} 个 OpenCode dev 进程："
  for entry in "${ENTRIES[@]}"; do
    printf '  %s\t%s\n' "${entry%%$'\t'*}" "$(echo "$entry" | cut -f2- | cut -c1-160)"
  done
fi

# 记下原来的启动命令，杀完按原样拉起，端口和参数保持不变。
BACKEND_CMD=""
FRONTEND="none"
for entry in "${ENTRIES[@]}"; do
  pid="${entry%%$'\t'*}"
  cmd="$(echo "$entry" | cut -f2-)"
  case "$cmd" in
    *" src/index.ts serve "*) [ -z "$BACKEND_CMD" ] && BACKEND_CMD="$cmd" ;;
  esac
  case "$cmd" in
    *"electron-vite"*) [ "$FRONTEND" = "none" ] && FRONTEND="desktop" ;;
  esac
done
if [ "$FRONTEND" = "none" ]; then
  for entry in "${ENTRIES[@]}"; do
    cmd="$(echo "$entry" | cut -f2-)"
    case "$cmd" in
      *bun*" dev"*) [ "$FRONTEND" = "none" ] && FRONTEND="web" ;;
    esac
  done
fi

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "dry-run：未杀任何进程。"
  echo "后端命令：${BACKEND_CMD:-（无）}"
  echo "前端类型：$FRONTEND"
  exit 0
fi

# 先杀前端：避免桌面端在重启过程中把刚杀掉的后端再拉起来。
kill_matching() {
  local entries=("$@")
  [ "${#entries[@]}" -eq 0 ] && return 0
  local pids=()
  for entry in "${entries[@]}"; do pids+=("${entry%%$'\t'*}"); done
  kill -9 "${pids[@]}" 2>/dev/null
}

front=()
back=()
for entry in "${ENTRIES[@]}"; do
  cmd="$(echo "$entry" | cut -f2-)"
  case "$cmd" in
    *" src/index.ts serve "*) back+=("$entry") ;;
    *) front+=("$entry") ;;
  esac
done

kill_matching "${front[@]}"
kill_matching "${back[@]}"

# Electron 与 detached 服务可能被重新包裹或残留，扫第二轮把漏网的清掉。
sleep 1
REST=()
while IFS= read -r line; do REST+=("$line"); done < <(collect)
if [ "${#REST[@]}" -gt 0 ]; then
  echo "清理残留 ${#REST[@]} 个进程…"
  kill_matching "${REST[@]}"
  sleep 1
fi

LEFT=$(collect | wc -l | tr -d ' ')
echo "已结束 OpenCode dev 进程，剩余 ${LEFT} 个。"

mkdir -p "$LOG_DIR"

if [ -n "$BACKEND_CMD" ]; then
  cd "$ROOT"
  nohup bash -c "$BACKEND_CMD" >"$LOG_DIR/server.log" 2>&1 &
  echo "$!" >"$LOG_DIR/server.pid"
  echo "后端已重启，日志：$LOG_DIR/server.log"
  # 给服务一点时间完成注册，避免桌面端启动时又另起一个。
  sleep 2
fi

case "$FRONTEND" in
  desktop)
    cd "$ROOT/packages/desktop"
    nohup "$BUN" run dev >"$LOG_DIR/desktop.log" 2>&1 &
    echo "$!" >"$LOG_DIR/desktop.pid"
    echo "桌面端已重启，日志：$LOG_DIR/desktop.log"
    ;;
  web)
    cd "$ROOT"
    nohup "$BUN" run dev:web >"$LOG_DIR/web.log" 2>&1 &
    echo "$!" >"$LOG_DIR/web.pid"
    echo "Web 端已重启，日志：$LOG_DIR/web.log"
    ;;
  none)
    echo "没有发现需要重启的前端进程；后端已单独拉起。"
    ;;
esac

echo "完成。若之前还开着 TUI（bun dev），它需要你在终端里重新运行。"
