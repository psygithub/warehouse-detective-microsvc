#!/bin/bash
#
# Warehouse Detective - 一体化自动备份脚本
#
# 功能:
# 1. 自动安装依赖 (rclone)。
# 2. 执行数据库的在线备份。
# 3. 将备份上传到 Google Drive。
# 4. 清理本地的旧备份。
# 5. (首次运行时) 将自身添加到 cron 定时任务中。
#

set -e

# ==============================================================================
# ---                           用户配置区域                           ---
# ==============================================================================
# 请根据您的实际环境修改以下变量

# 您的应用部署的根目录 (绝对路径)
APP_DIR="/app/waredetective"

# Rclone 配置的远程存储名称 (这是您在运行 "rclone config" 时为 Google Drive 设置的名称)
RCLONE_REMOTE="gdrive"

# Google Drive 上的备份文件夹路径 (如果不存在，rclone 会自动创建)
REMOTE_PATH="backups/waredetective"

# 在本地保留多少天的备份文件
KEEP_DAYS=7

# 定时任务执行时间 (Cron 格式: 分 时 日 月 周)
# 默认: 每天凌晨 5:05
CRON_SCHEDULE="5 5 * * *"

# ==============================================================================
# ---                         脚本主体 (通常无需修改)                        ---
# ==============================================================================

# --- 派生变量 (自动计算) ---
DB_FILE="data/warehouse.db"
DB_PATH="$APP_DIR/$DB_FILE"
BACKUP_DIR="$APP_DIR/backups"
LOG_DIR="$APP_DIR/logs"
LOG_FILE="$LOG_DIR/backup.log"
SCRIPT_FULL_PATH=$(readlink -f "$0")

# --- 函数定义 ---

# 日志记录函数
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# 检查并安装 rclone
install_rclone() {
    if ! command -v rclone &> /dev/null; then
        log "未找到 rclone，正在使用官方脚本进行安装..."
        
        # 检查 curl 是否安装
        if ! command -v curl &> /dev/null; then
            log "错误: 未找到 curl。请先安装 curl (sudo yum install curl) 后再运行此脚本。"
            exit 1
        fi
        
        # 下载并执行 rclone 官方安装脚本
        curl https://rclone.org/install.sh | sudo bash
        
        if [ $? -ne 0 ]; then
            log "错误: rclone 安装失败。请检查网络连接或尝试手动安装。"
            exit 1
        fi

        log "rclone 安装成功。"
        echo ""
        echo "===================================================================="
        echo " [!] 重要操作：配置 Rclone 连接 Google Drive"
        echo "===================================================================="
        echo "Rclone 已安装，现在您需要手动进行一次性授权配置。"
        echo "请以将要运行备份任务的用户身份，在终端中执行以下命令："
        echo ""
        echo "   rclone config"
        echo ""
        echo "然后完全按照下面的步骤操作："
        echo "--------------------------------------------------------------------"
        echo " 1. 看到 'n/s/q>' 提示时, 输入 'n' (新建一个 remote), 按 Enter。"
        echo ""
        echo " 2. 'name>': 输入一个此连接的简称, 例如 '$RCLONE_REMOTE', 按 Enter。"
        echo "    -> 这个名字需要填入本脚本顶部的 RCLONE_REMOTE 配置项。"
        echo ""
        echo " 3. 'Storage>': 在列表中找到 'drive' (Google Drive), 输入对应的数字, 按 Enter。"
        echo ""
        echo " 4. 'client_id>': 直接按 Enter 跳过。"
        echo ""
        echo " 5. 'client_secret>': 直接按 Enter 跳过。"
        echo ""
        echo " 6. 'scope>': 输入 '1' (完全访问权限), 按 Enter。"
        echo ""
        echo " 7. 'root_folder_id>': 直接按 Enter 跳过。"
        echo ""
        echo " 8. 'service_account_file>': 直接按 Enter 跳过。"
        echo ""
        echo " 9. 'Edit advanced config?': 输入 'n' (否), 按 Enter。"
        echo ""
        echo "10. 'Use auto config?': 输入 'n' (否), 按 Enter。 (这是在服务器上配置的关键步骤)"
        echo ""
        echo "11. 复制链接: rclone 会生成一个 'https://accounts.google.com/...' 链接。"
        echo "    -> 将这个链接完整地复制下来。"
        echo ""
        echo "12. 浏览器授权: 将链接粘贴到您本地电脑的浏览器中打开, 登录并授权。"
        echo ""
        echo "13. 获取验证码: Google 会在浏览器中显示一个验证码字符串。"
        echo ""
        echo "14. 粘贴验证码: 将验证码完整地复制, 然后粘贴回服务器终端, 按 Enter。"
        echo ""
        echo "15. 'Configure this as a team drive?': 输入 'n' (否), 按 Enter。"
        echo ""
        echo "16. 'y/e/d>': 看到配置摘要后, 输入 'y' (是) 保存配置, 按 Enter。"
        echo ""
        echo "17. 'q>': 输入 'q' 退出配置工具。"
        echo "--------------------------------------------------------------------"
        echo ""
        echo "配置完成后，请再次运行此脚本以完成定时任务的设置。"
        echo "===================================================================="
        exit 0 # 首次安装后退出，强制用户先完成手动配置
    fi
}

# 设置定时任务
setup_cron() {
    log "正在检查并设置 cron 定时任务..."
    CRON_JOB="$CRON_SCHEDULE $SCRIPT_FULL_PATH --run-backup >/dev/null 2>&1"
    
    if crontab -l 2>/dev/null | grep -q -F "$SCRIPT_FULL_PATH"; then
        log "定时任务已存在，无需再次添加。"
    else
        (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
        log "定时任务已成功添加。"
    fi
}

# 执行备份逻辑
run_backup() {
    log "--- 备份流程开始 ---"
    
    # 确保目录存在
    mkdir -p "$BACKUP_DIR"
    mkdir -p "$LOG_DIR"

    # 检查数据库文件
    if [ ! -f "$DB_PATH" ]; then
        log "错误: 数据库文件未找到于 $DB_PATH"
        exit 1
    fi

    # 创建备份文件名
    TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
    BACKUP_FILE="$BACKUP_DIR/warehouse.db.$TIMESTAMP.bak"

    log "正在备份数据库到 $BACKUP_FILE ..."
    sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
    
    log "正在上传到 Google Drive (远程: $RCLONE_REMOTE)..."
    rclone copyto "$BACKUP_FILE" "$RCLONE_REMOTE:$REMOTE_PATH/warehouse.db.$TIMESTAMP.bak" --log-level INFO
    
    log "上传成功。正在清理旧的本地备份 (保留最近 $KEEP_DAYS 天)..."
    find "$BACKUP_DIR" -type f -name "*.bak" -mtime +$KEEP_DAYS -delete
    
    log "--- 备份流程结束 ---"
}


# --- 主逻辑 ---

# 如果脚本以 --run-backup 参数运行，则只执行备份逻辑 (供 cron 调用)
if [ "$1" = "--run-backup" ]; then
    run_backup
    exit 0
fi

# 否则，执行首次设置流程
echo "=== Warehouse Detective 一体化备份设置 ==="
install_rclone
setup_cron
echo ""
echo "设置完成！"
echo "请确保您已经按照提示，使用 'rclone config' 正确配置了 Google Drive。"
echo "您可以手动执行以下命令来立即运行一次备份进行测试："
echo "  $SCRIPT_FULL_PATH --run-backup"
echo ""
