#!/bin/bash

# =============================================================================
# DevOps 自动化部署脚本 (仅浏览器服务)
#
# 功能:
#   1. 从 Git 拉取最新代码。
#   2. 停止并删除旧的浏览器服务容器。
#   3. 拉取最新的 browserless/chrome 镜像。
#   4. 启动浏览器服务容器。
#
# 使用方法:
#   ./deploy_browser.sh
#
# =============================================================================

# --- 在这里配置您的变量 ---
BROWSER_CONTAINER_NAME="browser-service"
DOCKER_NETWORK="waredetective-net"
# -------------------------

set -e

# --- 步骤 1: 从 Git 拉取最新代码 ---
echo "--- [步骤 1/4] 正在从 Git 拉取最新代码... ---"
git pull

# --- 步骤 2: 清理旧的容器 ---
echo "--- [步骤 2/4] 正在清理旧的浏览器服务容器... ---"
docker stop "$BROWSER_CONTAINER_NAME" || true
docker rm "$BROWSER_CONTAINER_NAME" || true
echo "旧容器清理完毕。"

# --- 步骤 3: 拉取最新镜像 ---
echo "--- [步骤 3/4] 正在从 Docker Hub 拉取最新的 browserless/chrome 镜像... ---"
docker pull browserless/chrome:latest

# --- 步骤 4: 运行新的 Docker 容器 ---
echo "--- [步骤 4/4] 正在启动新的浏览器服务容器... ---"
docker run -d --name "$BROWSER_CONTAINER_NAME" --network "$DOCKER_NETWORK" --restart always browserless/chrome:latest

echo ""
echo "==============================================="
echo "  🚀 浏览器服务部署成功！"
echo "==============================================="
