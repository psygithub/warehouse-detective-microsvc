#!/bin/bash
# =============================================================================
# 🚀 DevOps 自动化部署脚本 (主应用 - 最终优化增强版 v2)
#
# 功能:
#   1. 检查依赖 (curl)
#   2. 从 Git 拉取最新代码
#   3. 构建新 Docker 镜像（带时间标签）
#   4. 检查 Docker 网络（不存在则创建）
#   5. 停止并备份旧容器
#   6. 启动新容器 (使用唯一的 BUILD_TAG)
#   7. 执行宿主机到容器的 /api/health 健康检查
#   8. 根据结果清理或自动回滚
#   9. 清理旧的构建镜像
#  10. 支持命令参数 --rollback-only
#
# 使用方法:
#   ./deploy_main_app.sh
#   ./deploy_main_app.sh --rollback-only  # 仅执行回滚
# =============================================================================

# --- 配置区域 ---
APP_CONTAINER_NAME="warehouse"
APP_IMAGE_NAME="warehouse-detective"
DOCKER_NETWORK="waredetective-net"
APP_PORT=3000
# [优化 1] 健康检查 URL 现在指向宿主机的 localhost
APP_HEALTH_URL="http://localhost:${APP_PORT}/api/health"
OLD_CONTAINER_NAME="${APP_CONTAINER_NAME}-old-backup"
HEALTH_CHECK_TIMEOUT=30 # 秒
KEEP_LATEST_IMAGES=2    # [建议 1] 保留最近的镜像数量
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

# --- 彩色日志函数 ---
info()    { echo -e "\033[1;34m[INFO]\033[0m $*"; }
warn()    { echo -e "\033[1;33m[WARN]\033[0m $*"; }
error()   { echo -e "\033[1;31m[ERROR]\033[0m $*"; }
success() { echo -e "\033[1;32m[SUCCESS]\033[0m $*"; }

# --- 遇错退出 + 管道错误检测 ---
set -euo pipefail

# --- 自动回滚机制 ---
# 只有在 backup 步骤 (步骤4) 之后才激活 trap
activate_rollback_trap() {
    trap rollback_on_error ERR
    info "回滚陷阱已激活。"
}

rollback_on_error() {
    error "检测到异常退出，尝试自动回滚..."
    # 强制移除可能启动失败的新容器
    docker rm -f "$APP_CONTAINER_NAME" >/dev/null 2>&1 || true
    
    if docker ps -a --format '{{.Names}}' | grep -wq "$OLD_CONTAINER_NAME"; then
        info "正在恢复备份容器 $OLD_CONTAINER_NAME ..."
        docker rename "$OLD_CONTAINER_NAME" "$APP_CONTAINER_NAME" >/dev/null 2>&1 || true
        docker start "$APP_CONTAINER_NAME" >/dev/null 2>&1 || true
        success "已恢复旧容器 $APP_CONTAINER_NAME。"
    else
        warn "未找到旧容器备份 ($OLD_CONTAINER_NAME)，无法自动回滚。"
    fi
}
# 早期阶段的简单 trap
trap 'error "部署在早期阶段失败，未执行回滚。"' ERR

# --- 依赖检查 ---
if ! command -v curl &> /dev/null; then
    error "依赖 'curl' 未安装。请先安装 curl。"
    exit 1
fi

# --- 参数解析 ---
ROLLBACK_ONLY=false
if [[ "${1:-}" == "--rollback-only" ]]; then
    ROLLBACK_ONLY=true
fi

# --- 仅回滚模式 ---
if [ "$ROLLBACK_ONLY" = true ]; then
    info "执行手动回滚操作..."
    # [优化] 手动回滚时，禁用自动回滚陷阱
    trap - ERR
    if docker ps -a --format '{{.Names}}' | grep -wq "$OLD_CONTAINER_NAME"; then
        docker rm -f "$APP_CONTAINER_NAME" >/dev/null 2>&1 || true
        docker rename "$OLD_CONTAINER_NAME" "$APP_CONTAINER_NAME"
        docker start "$APP_CONTAINER_NAME"
        success "手动回滚完成，旧容器已恢复运行。"
    else
        error "未找到备份容器: $OLD_CONTAINER_NAME，无法执行回滚。"
        exit 1
    fi
    exit 0
fi

# --- 步骤 1: Git 拉取 ---
info "[1/8] 正在从 Git 拉取最新代码..."
git pull

# --- 步骤 2: 构建 Docker 镜像 ---
info "[2/8] 正在构建主应用 Docker 镜像..."
BUILD_TAG="$(date +%Y%m%d_%H%M%S)" # 使用更精确的秒级时间戳
docker build --pull -t "$APP_IMAGE_NAME:latest" -t "$APP_IMAGE_NAME:$BUILD_TAG" -f main-app/Dockerfile ./main-app

# --- 步骤 3: 检查 Docker 网络 ---
info "[3/8] 检查 Docker 网络: $DOCKER_NETWORK"
if ! docker network ls --format '{{.Name}}' | grep -wq "$DOCKER_NETWORK"; then
    docker network create "$DOCKER_NETWORK"
    success "网络已创建。"
else
    info "网络已存在。"
fi

# --- 步骤 4: 停止并备份旧容器 ---
info "[4/8] 停止并备份旧容器..."
if docker ps -a --format '{{.Names}}' | grep -wq "$APP_CONTAINER_NAME"; then
    docker stop "$APP_CONTAINER_NAME" >/dev/null
    docker rm -f "$OLD_CONTAINER_NAME" >/dev/null 2>&1 || true
    docker rename "$APP_CONTAINER_NAME" "$OLD_CONTAINER_NAME"
    success "已备份旧容器为: $OLD_CONTAINER_NAME"
    
    # [优化] 备份成功后，正式激活自动回滚陷阱
    activate_rollback_trap
else
    info "未发现旧容器，将直接启动新容器。"
    # [优化] 即使没有旧容器，也激活陷阱以防新容器启动失败
    activate_rollback_trap
fi

# --- 步骤 5: 启动新容器 ---
info "[5/8] 启动新的主应用容器 (Tag: $BUILD_TAG)..."
set +e # 临时关闭 set -e，手动捕获 docker run 的失败
# [优化 2] 运行刚刚构建的 $BUILD_TAG，而不是 :latest
docker run -d --name "$APP_CONTAINER_NAME" --network "$DOCKER_NETWORK" \
    -p "${APP_PORT}:${APP_PORT}" --restart always \
    -v "$SCRIPT_DIR/data:/data" \
    -v "$SCRIPT_DIR/output:/app/output" \
    -v "$SCRIPT_DIR/config:/app/config" \
    -e "PLAYWRIGHT_SERVICE_URL=http://playwright-service:3001" \
    -e "NODE_UNBUFFERED=1" \
    "$APP_IMAGE_NAME:$BUILD_TAG"
RUN_RESULT=$?
set -e # 重新开启 set -e

if [ $RUN_RESULT -ne 0 ]; then
    error "新容器启动失败 (docker run 返回非 0 退出码)！"
    exit 1 # 将触发 ERR trap
fi

# --- 步骤 6: 健康检查 ---
info "[6/8] 等待服务启动并执行健康检查 (URL: $APP_HEALTH_URL)..."
healthy=false
for i in $(seq 1 $HEALTH_CHECK_TIMEOUT); do
    # [优化 1] 使用宿主机的 curl，检查端口映射和应用
    if curl -fs "$APP_HEALTH_URL" >/dev/null 2>&1; then
        healthy=true
        success "健康检查通过！"
        break
    fi
    info "等待健康检查... ($i/$HEALTH_CHECK_TIMEOUT)"
    sleep 1
done

if [ "$healthy" != "true" ]; then
    error "健康检查失败：未能在 ${HEALTH_CHECK_TIMEOUT}s 内从 ${APP_HEALTH_URL} 获得响应。"
    error "--- [新容器日志] ---"
    docker logs "$APP_CONTAINER_NAME"
    error "--- [日志结束] ---"
    exit 1 # <--- 这一行将触发 ERR trap 来执行回滚
fi

# --- 步骤 7: 成功部署，清理备份 ---
info "[7/8] 部署成功，清理旧的备份容器..."
# 部署成功，解除回滚陷阱
trap - ERR
docker rm -f "$OLD_CONTAINER_NAME" >/dev/null 2>&1 || true
success "已删除备份容器 $OLD_CONTAINER_NAME。"

# --- 步骤 8: [建议 1] 清理旧镜像 ---
info "[8/8] 清理旧的 Docker 镜像 (保留最近 $KEEP_LATEST_IMAGES 个)..."
# (这个命令会列出所有带日期的镜像，按时间排序，跳过最新的N个，然后删除剩余的)
IMAGE_IDS_TO_DELETE=$(docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | \
    grep "^$APP_IMAGE_NAME:[0-9]\{8\}_[0-9]\{6\}" | \
    sort -k1 -r | \
    tail -n +$(($KEEP_LATEST_IMAGES + 1)) | \
    awk '{print $2}')

if [ -n "$IMAGE_IDS_TO_DELETE" ]; then
    docker rmi $IMAGE_IDS_TO_DELETE
    info "已清理旧镜像。"
else
    info "没有需要清理的旧镜像。"
fi
# 同时清理构建过程中产生的悬空镜像
docker image prune -f

echo ""
echo "==============================================="
success "🚀 主应用部署成功！ (Tag: $BUILD_TAG)"
echo "==============================================="
echo ""
