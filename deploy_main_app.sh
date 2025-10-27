#!/bin/bash

# =============================================================================
# DevOps 自动化部署脚本 (仅主应用)
#
# 功能:
#   1. 从 Git 拉取最新代码。
#   2. 停止并删除旧的 Docker 容器。
#   3. 为主应用构建新的 Docker 镜像。
#   4. 启动主应用容器。
#   5. 清理构建过程中产生的无用镜像。
#
# 使用方法:
#   ./deploy_main_app.sh
#
# =============================================================================

# --- 在这里配置您的变量 ---
APP_CONTAINER_NAME="warehouse-detective-app"
APP_IMAGE_NAME="warehouse-detective"
DOCKER_NETWORK="waredetective-net"
# -------------------------

set -e

# --- 步骤 1: 从 Git 拉取最新代码 ---
echo "--- [步骤 1/5] 正在从 Git 拉取最新代码... ---"
git pull

# --- 步骤 2: 清理旧的容器 ---
echo "--- [步骤 2/5] 正在清理旧的主应用容器... ---"
docker stop "$APP_CONTAINER_NAME" || true
docker rm "$APP_CONTAINER_NAME" || true
echo "旧容器清理完毕。"

# --- 步骤 3: 检查并创建 Docker 网络 ---
echo "--- [步骤 3/5] 正在检查 Docker 网络 ($DOCKER_NETWORK)... ---"
if ! docker network ls | grep -q "$DOCKER_NETWORK"; then
    echo "网络不存在，正在创建..."
    docker network create "$DOCKER_NETWORK"
else
    echo "网络已存在。"
fi

# --- 步骤 4: 构建 Docker 镜像 ---
echo "--- [步骤 4/5] 正在构建主应用 Docker 镜像... ---"
docker build -t "$APP_IMAGE_NAME:latest" -f main-app/Dockerfile ./main-app

# --- 步骤 5: 运行新的 Docker 容器 ---
echo "--- [步骤 5/5] 正在启动新的主应用容器... ---"
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

# 注意：此脚本假定 playwright-service 和 browser-service 正在运行或可访问。
# 如果它们不在运行，主应用的部分功能可能会受限。
docker run -d --name "$APP_CONTAINER_NAME" --network "$DOCKER_NETWORK" -p 3000:3000 --restart always \
  -v "$SCRIPT_DIR/data:/data" \
  -v "$SCRIPT_DIR/output:/app/output" \
  -v "$SCRIPT_DIR/config:/app/config" \
  -e "PLAYWRIGHT_SERVICE_URL=http://playwright-service:3001" \
  -e "NODE_UNBUFFERED=1" \
  "$APP_IMAGE_NAME:latest"

echo ""
echo "==============================================="
echo "  🚀 主应用部署成功！"
echo "==============================================="
