#!/usr/bin/env bash
# restart.sh — 杀死系统内所有 aicraft 进程（客户端 + 服务端 + 残留服务），然后重启桌面开发环境
set -u

# 匹配口径：命令行里含 "aicraft" 或 "AI Craft"（打包版路径是 "AI Craft.app"，大小写不敏感）
# 排除：本脚本自身、grep
list_victims() {
  ps ax -o pid=,command= \
    | grep -iE "aicraft|AI Craft" \
    | grep -v "grep" \
    | grep -v "restart\.sh" \
    | awk '{print $1}'
}

PIDS=$(list_victims)

if [ -n "$PIDS" ]; then
  echo "==> 优雅终止: $(echo "$PIDS" | tr '\n' ' ')"
  kill $PIDS 2>/dev/null
  sleep 2
  # 漏网的直接强杀
  SURVIVORS=$(list_victims)
  if [ -n "$SURVIVORS" ]; then
    echo "==> 强杀剩余: $(echo "$SURVIVORS" | tr '\n' ' ')"
    kill -9 $SURVIVORS 2>/dev/null
    sleep 1
  fi
else
  echo "==> 没有发现运行中的 aicraft 进程"
fi

echo "==> 启动 dev:desktop"
cd "$(dirname "$0")"
LOG="${TMPDIR:-/tmp}/aicraft-dev-desktop.log"
nohup bun run dev:desktop >"$LOG" 2>&1 &
echo "==> 已后台启动，日志: $LOG"
