#!/bin/bash
# 拼多多利润计算器 · 本地启动（macOS / Linux）
cd "$(dirname "$0")" || exit 1

echo "============================================"
echo "  拼多多利润计算器 · 本地启动"
echo "============================================"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "[错误] 没有检测到 Node.js"
  echo "请先到 https://nodejs.org 下载安装 LTS 版本，装完重新运行本脚本。"
  echo ""
  exit 1
fi

mkdir -p data/uploads

echo ""
echo "服务启动中，请勿关闭本终端..."
echo "前台首页: http://localhost:3000"
echo "后台管理: http://localhost:3000/admin.html"
echo "初始管理员: admin  密码: admin888"
echo ""
echo "停止服务：按 Ctrl + C"
echo "============================================"
echo ""

( sleep 1; open "http://localhost:3000" 2>/dev/null || xdg-open "http://localhost:3000" 2>/dev/null ) &
node server.js
