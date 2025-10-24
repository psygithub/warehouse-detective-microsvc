#!/bin/bash

# =============================================================================
# DevOps 自动化部署脚本 (仅 Playwright 服务)
#
# 功能:
#   1. 从 Git 拉取最新代码。
#   2. 停止并删除旧的 Playwright 服务容器。
#   3. 为 Playwright 服务构建新的 Docker 镜像。
#   4. 启动 Playwright 服务容器。
#
# 使用方法:
#   ./deploy_playwright.sh
#
# =============================================================================

# --- 在这里配置您的变量 ---
PLAYWRIGHT_CONTAINER_NAME="playwright-service"
PLAYWRIGHT_IMAGE_NAME="playwright-service"
BROWSER_CONTAINER_NAME="browser-service"
DOCKER_NETWORK="waredetective-net"
# -------------------------

set -e

# --- 步骤 1: 从 Git 拉取最新代码 ---
echo "--- [步骤 1/4] 正在从 Git 拉取最新代码... ---"
git pull

# --- 步骤 2: 清理旧的容器 ---
echo "--- [步骤 2/4] 正在清理旧的 Playwright 服务容器... ---"
docker stop "$PLAYWRIGHT_CONTAINER_NAME" || true
docker rm "$PLAYWRIGHT_CONTAINER_NAME" || true
echo "旧容器清理完毕。"

# --- 步骤 3: 构建 Docker 镜像 ---
echo "--- [步骤 3/4] 正在构建 Playwright 服务 Docker 镜像... ---"
docker build -t "$PLAYWRIGHT_IMAGE_NAME:latest" -f playwright-service/Dockerfile ./playwright-service

# --- 步骤 4: 运行新的 Docker 容器 ---
echo "--- [步骤 4/4] 正在启动新的 Playwright 服务容器... ---"
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

# 注意：此脚本假定 browser-service 正在运行或可访问。
docker run -d --name "$PLAYWRIGHT_CONTAINER_NAME" --network "$DOCKER_NETWORK" -p 3001:3001 --restart always \
  -v "$SCRIPT_DIR/config:/app/config" \
  -e "BROWSER_SERVICE_URL=ws://$BROWSER_CONTAINER_NAME:3000" \
  "$PLAYWRIGHT_IMAGE_NAME:latest"

echo ""
echo "==============================================="
echo "  🚀 Playwright 服务部署成功！"
echo "==============================================="
