#!/usr/bin/env bash
# 戴卫得AI工作台 一键安装（macOS）
# 用法：bash install.sh "/你的/Obsidian/库/路径"
set -euo pipefail

VAULT="${1:-}"
if [ -z "$VAULT" ] || [ ! -d "$VAULT/.obsidian" ]; then
  echo "请把你的 Obsidian 库路径作为参数传进来，例如："
  echo '  bash install.sh "$HOME/Documents/我的知识库"'
  echo "（这个文件夹里应该有一个隐藏的 .obsidian 文件夹）"
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$VAULT/.obsidian/plugins/gzh-studio"

echo "1/4 复制插件到 $PLUGIN"
mkdir -p "$PLUGIN"
cp -R "$HERE/plugin/gzh-studio/." "$PLUGIN/"

echo "2/4 复制工作台文件夹（已存在的文件不会被覆盖）"
mkdir -p "$VAULT/公众号写作台" "$VAULT/assets/scripts"
cp -Rn "$HERE/vault-folder/公众号写作台/." "$VAULT/公众号写作台/" 2>/dev/null || true
cp -n "$HERE/vault-folder/assets/scripts/david-workbench.cjs" "$VAULT/assets/scripts/" 2>/dev/null || true

echo "3/4 安装插件依赖（需要 Node.js）"
if command -v npm >/dev/null 2>&1; then
  (cd "$PLUGIN" && npm install --omit=dev --no-audit --no-fund)
else
  echo "  ⚠️ 没找到 npm。请先装 Node.js（https://nodejs.org 下载 LTS 版），再重新运行本脚本。"
fi

echo "4/4 下载 uv（「微信公众号」页的内容工作台要用）"
if [ ! -x "$PLUGIN/bin/uv" ]; then
  mkdir -p "$PLUGIN/bin"
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$PLUGIN/bin" UV_NO_MODIFY_PATH=1 sh || \
    echo "  ⚠️ uv 下载失败，微信公众号页会用不了，其他页面不受影响。可以稍后重跑本脚本。"
fi

echo
echo "✅ 装好了。接下来："
echo "  1. 完全退出并重新打开 Obsidian"
echo "  2. 设置 → 第三方插件 → 关闭「安全模式」→ 在已安装插件里打开「戴卫得AI工作台」"
echo "  3. 左边栏点报纸图标，或命令面板搜「打开写作台」"
