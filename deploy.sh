#!/bin/bash

# =============================================================================
# DevOps 自动化部署脚本 (微服务版)
#
# 功能:
#   1. 从 Git 拉取最新代码。
#   2. 停止并删除旧的 Docker 容器。
#   3. 为主应用和 Playwright 服务构建新的 Docker 镜像。
#   4. 启动 browser, playwright, app 三个容器来运行应用。
#   5. 清理构建过程中产生的无用镜像。
#
# 使用方法:
#   ./deploy.sh
#
# =============================================================================

# --- 在这里配置您的变量 ---
APP_CONTAINER_NAME="warehouse-detective-app"
APP_IMAGE_NAME="warehouse-detective"

PLAYWRIGHT_CONTAINER_NAME="playwright-service"
PLAYWRIGHT_IMAGE_NAME="playwright-service"

BROWSER_CONTAINER_NAME="browser-service"
DOCKER_NETWORK="waredetective-net"
# -------------------------

set -e

# --- 步骤 1: 从 Git 拉取最新代码 ---
echo "--- [步骤 1/6] 正在从 Git 拉取最新代码... ---"
git pull

# --- 步骤 2: 清理旧的容器 ---
echo "--- [步骤 2/6] 正在清理旧的容器... ---"
docker stop "$APP_CONTAINER_NAME" "$PLAYWRIGHT_CONTAINER_NAME" "$BROWSER_CONTAINER_NAME" || true
docker rm "$APP_CONTAINER_NAME" "$PLAYWRIGHT_CONTAINER_NAME" "$BROWSER_CONTAINER_NAME" || true
echo "旧容器清理完毕。"

# --- 步骤 3: 检查并创建 Docker 网络 ---
echo "--- [步骤 3/6] 正在检查 Docker 网络 ($DOCKER_NETWORK)... ---"
if ! docker network ls | grep -q "$DOCKER_NETWORK"; then
    echo "网络不存在，正在创建..."
    docker network create "$DOCKER_NETWORK"
else
    echo "网络已存在。"
fi

# --- 步骤 4: 构建 Docker 镜像 ---
echo "--- [步骤 4/6] 正在构建 Docker 镜像... ---"
echo "构建主应用镜像 ($APP_IMAGE_NAME)..."
docker build -t "$APP_IMAGE_NAME:latest" -f main-app/Dockerfile ./main-app

echo "构建 Playwright 服务镜像 ($PLAYWRIGHT_IMAGE_NAME)..."
docker build -t "$PLAYWRIGHT_IMAGE_NAME:latest" -f playwright-service/Dockerfile ./playwright-service

# --- 步骤 5: 运行新的 Docker 容器 ---
echo "--- [步骤 5/6] 正在启动新的容器... ---"
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

echo "启动浏览器服务 ($BROWSER_CONTAINER_NAME)..."
docker run -d --name "$BROWSER_CONTAINER_NAME" --network "$DOCKER_NETWORK" --restart always browserless/chrome:latest

echo "启动 Playwright 服务 ($PLAYWRIGHT_CONTAINER_NAME)..."
docker run -d --name "$PLAYWRIGHT_CONTAINER_NAME" --network "$DOCKER_NETWORK" -p 3001:3001 --restart always \
  -v "$SCRIPT_DIR/config:/app/config" \
  -e "BROWSER_SERVICE_URL=ws://$BROWSER_CONTAINER_NAME:3000" \
  "$PLAYWRIGHT_IMAGE_NAME:latest"

echo "启动主应用 ($APP_CONTAINER_NAME)..."
docker run -d --name "$APP_CONTAINER_NAME" --network "$DOCKER_NETWORK" -p 3000:3000 --restart always \
  -v "$SCRIPT_DIR/data:/app/data" \
  -v "$SCRIPT_DIR/output:/app/output" \
  -v "$SCRIPT_DIR/config:/app/config" \
  -e "PLAYWRIGHT_SERVICE_URL=http://$PLAYWRIGHT_CONTAINER_NAME:3001" \
  "$APP_IMAGE_NAME:latest"

# --- 步骤 6: 清理无用的镜像 ---
echo "--- [步骤 6/6] 正在清理无用的 Docker 镜像... ---"
docker image prune -f

echo ""
echo "==============================================="
echo "  🚀 部署成功！"
echo "  所有服务已成功启动。"
echo "==============================================="
