const path = require('path');
const Database = require('better-sqlite3');

console.log('--- 启动预警详情（Alert Details）数据修复脚本 ---');

// 构造数据库文件的绝对路径
// __dirname -> main-app/scripts
const dbPath = path.join(__dirname, '../../data/warehouse.db');
console.log(`正在连接数据库: ${dbPath}`);

let db;
try {
    db = new Database(dbPath);
} catch (error) {
    console.error('数据库连接失败！请检查路径是否正确。', error);
    process.exit(1);
}

// 定义需要被标准化的键名映射
// key: 旧的或不规范的键名, value: 标准的驼峰式键名
const keyMap = {
    'start_qty': 'startQty',
    'end_qty': 'endQty',
    // 根据用户反馈，也处理其他可能的大小写不一致问题
    'startqty': 'startQty',
    'endqty': 'endQty',
    'StartQty': 'startQty',
    'EndQty': 'endQty'
};

function normalizeKeys(detailsObj) {
    const newDetails = {};
    let hasChanged = false;

    for (const key in detailsObj) {
        const normalizedKey = keyMap[key] || key;
        if (normalizedKey !== key) {
            hasChanged = true;
        }
        newDetails[normalizedKey] = detailsObj[key];
    }

    return { newDetails, hasChanged };
}

try {
    console.log('正在从 product_alerts 表中读取所有记录...');
    const alerts = db.prepare('SELECT id, details FROM product_alerts').all();
    console.log(`共找到 ${alerts.length} 条预警记录。`);

    const updateStmt = db.prepare('UPDATE product_alerts SET details = ? WHERE id = ?');

    let updatedCount = 0;

    const fixAlertsTransaction = db.transaction((alertsToFix) => {
        for (const alert of alertsToFix) {
            try {
                const details = JSON.parse(alert.details);
                
                // 检查是否为有效的对象
                if (details === null || typeof details !== 'object') {
                    continue;
                }

                const { newDetails, hasChanged } = normalizeKeys(details);

                if (hasChanged) {
                    const newDetailsJson = JSON.stringify(newDetails);
                    updateStmt.run(newDetailsJson, alert.id);
                    updatedCount++;
                    console.log(`  - 已修复 ID: ${alert.id}`);
                }

            } catch (e) {
                console.warn(`  - 警告: 无法解析 ID: ${alert.id} 的 details 字段，已跳过。错误: ${e.message}`);
            }
        }
    });

    console.log('开始扫描并修复数据...');
    fixAlertsTransaction(alerts);

    console.log('--- 修复完成 ---');
    console.log(`总共检查了 ${alerts.length} 条记录。`);
    console.log(`成功修复并更新了 ${updatedCount} 条记录。`);

} catch (error) {
    console.error('处理过程中发生严重错误:', error);
} finally {
    if (db) {
        db.close();
        console.log('数据库连接已关闭。');
    }
}
