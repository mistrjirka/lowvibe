#!/bin/bash
# Full clean rebuild and launch script for code-agent + code-agent-gui

set -e

echo "🧹 Cleaning code-agent..."
cd /home/jirka/programovani/lowviber/code-agent
rm -rf dist
echo "🔨 Building code-agent..."
npm run build

echo ""
echo "🧹 Cleaning code-agent-gui..."
cd /home/jirka/programovani/lowviber/code-agent-gui
rm -rf dist tsconfig.electron.tsbuildinfo node_modules/.vite

echo "🔨 Building code-agent-gui..."
npm run build

echo ""
echo "🚀 Launching GUI..."
npm run dev
