const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// 确保数据目录存在
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('已创建数据目录:', dataDir);
}

const dbPath = path.join(dataDir, 'warehouse.db');
const db = new Database(dbPath);

// 初始化表结构
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  email TEXT,
  password TEXT,
  role TEXT,
  session_id TEXT,
  createdAt TEXT,
  isActive INTEGER
);

CREATE TABLE IF NOT EXISTS configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  skus TEXT,
  regions TEXT,
  description TEXT,
  userId INTEGER,
  createdAt TEXT
);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  configId INTEGER,
  skus TEXT,
  regions TEXT,
  results TEXT,
  status TEXT,
  isScheduled INTEGER,
  scheduleId INTEGER,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  cron TEXT,
  configId INTEGER,
  userId INTEGER,
  isActive INTEGER,
  createdAt TEXT
);
-- 创建商品信息表（单表存储所有信息）
CREATE TABLE IF NOT EXISTS xizhiyue_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- 基础信息
    product_sku_id INTEGER UNIQUE NOT NULL,
    product_id INTEGER NOT NULL,
    product_sku TEXT NOT NULL,
    product_name TEXT NOT NULL,
    product_image TEXT,
    
    -- 销售信息
    month_sales INTEGER DEFAULT 0,
    product_price TEXT,
    is_hot_sale INTEGER DEFAULT 0,
    is_new INTEGER DEFAULT 0,
    is_seckill INTEGER DEFAULT 0,
    is_wish INTEGER DEFAULT 0,
    
    -- 库存状态（针对请求的地区）
    target_region_id INTEGER NOT NULL,
    target_region_name TEXT,
    target_region_code TEXT,
    target_quantity INTEGER DEFAULT 0,
    target_price TEXT,
    target_stock_status TEXT,
    
    -- 所有地区库存信息（JSON格式存储）
    all_regions_inventory TEXT,
    
    -- 其他信息（JSON格式存储）
    product_certificate TEXT, -- 证书信息
    product_categories TEXT,  -- 分类信息
    product_attributes TEXT,  -- 属性信息
    formatted_attributes TEXT, -- 格式化属性
    delivery_regions TEXT,    -- 所有地区配送信息
    
    -- 价格信息
    member_price REAL,
    price_currency TEXT,
    price_currency_symbol TEXT,
    base_price REAL,
    guide_price REAL,
    real_price TEXT,
    
    -- 时间信息
    product_addtime TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    
);
-- 创建索引（移到表创建语句之外）
CREATE INDEX IF NOT EXISTS idx_product_sku ON xizhiyue_products (product_sku);
CREATE INDEX IF NOT EXISTS idx_sku_id ON xizhiyue_products (product_sku_id);
CREATE INDEX IF NOT EXISTS idx_region ON xizhiyue_products (target_region_id);
CREATE INDEX IF NOT EXISTS idx_hot_sale ON xizhiyue_products (is_hot_sale);
CREATE INDEX IF NOT EXISTS idx_created_at ON xizhiyue_products (created_at);

-- 创建商品历史价格表（可选，用于跟踪价格变化）
CREATE TABLE IF NOT EXISTS xizhiyue_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_sku_id INTEGER NOT NULL,
    region_id INTEGER NOT NULL,
    price TEXT,
    quantity INTEGER,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 为库存跟踪功能创建新表
CREATE TABLE IF NOT EXISTS tracked_skus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE NOT NULL,
    product_name TEXT,
    product_image TEXT,
    product_id INTEGER,
    product_sku_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracked_sku_id INTEGER NOT NULL,
    sku TEXT,
    record_date DATE NOT NULL,
    qty INTEGER,
    month_sale INTEGER,
    product_sales INTEGER,
    delivery_regions TEXT,
    product_image TEXT,
    raw_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tracked_sku_id, record_date),
    FOREIGN KEY (tracked_sku_id) REFERENCES tracked_skus (id) ON DELETE CASCADE
);

-- 为精细化分析创建新的区域库存历史表
CREATE TABLE IF NOT EXISTS regional_inventory_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracked_sku_id INTEGER NOT NULL,
    sku TEXT NOT NULL,
    product_sku_id INTEGER,
    product_id INTEGER,
    record_date DATE NOT NULL,
    region_id INTEGER NOT NULL,
    region_name TEXT,
    region_code TEXT,
    qty INTEGER,
    price TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tracked_sku_id, record_date, region_id),
    FOREIGN KEY (tracked_sku_id) REFERENCES tracked_skus (id) ON DELETE CASCADE
);

-- 创建产品预警表
CREATE TABLE IF NOT EXISTS product_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracked_sku_id INTEGER NOT NULL,
    sku TEXT NOT NULL,
    region_id INTEGER NOT NULL,
    region_name TEXT,
    alert_type TEXT NOT NULL, -- e.g., 'FAST_CONSUMPTION'
    alert_level INTEGER DEFAULT 1, -- 1: Low, 2: Medium, 3: High
    details TEXT, -- JSON with details like consumption rate, timespan etc.
    status TEXT DEFAULT 'ACTIVE', -- e.g., 'ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tracked_sku_id) REFERENCES tracked_skus (id) ON DELETE CASCADE
);

-- 创建系统配置表
CREATE TABLE IF NOT EXISTS system_configs (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- 创建用户SKU关联表
CREATE TABLE IF NOT EXISTS user_sku (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tracked_sku_id INTEGER NOT NULL,
  expires_at DATETIME, -- NULL 表示长期有效
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (tracked_sku_id) REFERENCES tracked_skus (id) ON DELETE CASCADE,
  UNIQUE(user_id, tracked_sku_id)
);
`);

// 数据库迁移逻辑
function runMigrations() {
    try {
        const regionalColumns = db.prepare('PRAGMA table_info(regional_inventory_history)').all();
        if (!regionalColumns.some(c => c.name === 'product_sku_id')) {
            db.exec('ALTER TABLE regional_inventory_history ADD COLUMN product_sku_id INTEGER');
        }
        if (!regionalColumns.some(c => c.name === 'product_id')) {
            db.exec('ALTER TABLE regional_inventory_history ADD COLUMN product_id INTEGER');
        }
    } catch (err) {
        if (!err.message.includes('no such table: regional_inventory_history')) {
            console.error('Error migrating regional_inventory_history:', err);
        }
    }
    try {
        const columns = db.prepare(`PRAGMA table_info(inventory_history)`).all();
        if (!columns.some(col => col.name === 'month_sale')) {
            db.exec(`
                ALTER TABLE inventory_history ADD COLUMN month_sale INTEGER;
                ALTER TABLE inventory_history ADD COLUMN product_sales INTEGER;
            `);
        }
        if (!columns.some(col => col.name === 'sku')) {
            db.exec('ALTER TABLE inventory_history ADD COLUMN sku TEXT');
        }
    } catch (error) {
        if (!error.message.includes('no such table: inventory_history')) {
            console.error('Migration failed:', error);
        }
    }
    try {
        const columns = db.prepare('PRAGMA table_info(tracked_skus)').all();
        if (!columns.some(c => c.name === 'product_image')) {
            db.exec('ALTER TABLE tracked_skus ADD COLUMN product_image TEXT');
        }
        if (!columns.some(c => c.name === 'updated_at')) {
            db.exec('ALTER TABLE tracked_skus ADD COLUMN updated_at DATETIME');
        }
    } catch (err) {
        if (!err.message.includes('no such table: tracked_skus')) {
            console.error('Error migrating tracked_skus:', err);
        }
    }
}
runMigrations();

function migrateUsersTable() {
    try {
        const columns = db.prepare(`PRAGMA table_info(users)`).all();
        if (!columns.some(col => col.name === 'session_id')) {
            db.exec(`ALTER TABLE users ADD COLUMN session_id TEXT`);
        }
    } catch (error) {
        console.error('Failed to migrate users table:', error);
    }
}
migrateUsersTable();

function migrateUserSkuTable() {
    try {
        const columns = db.prepare(`PRAGMA table_info(user_sku)`).all();
        if (!columns.some(col => col.name === 'expires_at')) {
            db.exec(`ALTER TABLE user_sku ADD COLUMN expires_at DATETIME`);
        }
    } catch (error) {
        if (!error.message.includes('no such table: user_sku')) {
            console.error('Failed to migrate user_sku table:', error);
        }
    }
}
migrateUserSkuTable();

function ensureDefaultAdmin() {
  const admin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`INSERT INTO users (username, email, password, role, createdAt, isActive) VALUES (?, ?, ?, ?, ?, ?)`).run('admin', 'admin@warehouse.com', hash, 'admin', new Date().toISOString(), 1);
  }
}

function initializeSystemConfigs() {
    const configs = [{ key: 'alert_timespan', value: '7' }, { key: 'alert_threshold', value: '0.5' }];
    const stmt = db.prepare('INSERT OR IGNORE INTO system_configs (key, value) VALUES (?, ?)');
    for (const config of configs) {
        stmt.run(config.key, config.value);
    }
}
ensureDefaultAdmin();
initializeSystemConfigs();

function getAllUsers() { return db.prepare('SELECT * FROM users').all(); }
function findUserById(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
function findUserByUsername(username) { return db.prepare('SELECT * FROM users WHERE username = ?').get(username); }
function createUser(userData) {
  const stmt = db.prepare(`INSERT INTO users (username, email, password, role, createdAt, isActive) VALUES (?, ?, ?, ?, ?, ?)`);
  const info = stmt.run(userData.username, userData.email, userData.password, userData.role || 'user', new Date().toISOString(), 1);
  return findUserById(info.lastInsertRowid);
}
function updateUser(id, updateData) {
    const user = findUserById(id);
    if (!user) return null;
    const fields = Object.keys(updateData);
    if (fields.length === 0) return user;
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = fields.map(field => updateData[field]);
    values.push(id);
    const stmt = db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`);
    stmt.run(...values);
    return findUserById(id);
}
function deleteUser(id) { return db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0; }

function saveConfig(configData) {
  const stmt = db.prepare(`INSERT INTO configs (name, skus, regions, description, userId, createdAt) VALUES (?, ?, ?, ?, ?, ?)`);
  const info = stmt.run(configData.name, JSON.stringify(configData.skus), JSON.stringify(configData.regions), configData.description || '', configData.userId, new Date().toISOString());
  return getConfigById(info.lastInsertRowid);
}
function getConfigs() { return db.prepare('SELECT * FROM configs').all(); }
function getConfigById(id) {
  const config = db.prepare('SELECT * FROM configs WHERE id = ?').get(id);
  if (!config) return null;
  return { ...config, skus: JSON.parse(config.skus), regions: JSON.parse(config.regions) };
}
function updateConfig(id, updateData) {
  const config = getConfigById(id);
  if (!config) return null;
  const stmt = db.prepare(`UPDATE configs SET name = ?, skus = ?, regions = ?, description = ? WHERE id = ?`);
  stmt.run(updateData.name || config.name, JSON.stringify(updateData.skus || config.skus), JSON.stringify(updateData.regions || config.regions), updateData.description || config.description, id);
  return getConfigById(id);
}
function deleteConfig(id) { return db.prepare('DELETE FROM configs WHERE id = ?').run(id).changes > 0; }

function safeJsonParse(str, defaultValue = []) {
    if (!str) return defaultValue;
    try {
        const parsed = JSON.parse(str);
        return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
    } catch (e) {
        return defaultValue;
    }
}

function saveResult(resultData) {
  const stmt = db.prepare(`INSERT INTO results (userId, configId, skus, regions, results, status, isScheduled, scheduleId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const info = stmt.run(resultData.userId, resultData.configId, JSON.stringify(resultData.skus), JSON.stringify(resultData.regions), JSON.stringify(resultData.results), resultData.status, resultData.isScheduled ? 1 : 0, resultData.scheduleId, new Date().toISOString(), new Date().toISOString());
  return getResultById(info.lastInsertRowid);
}
function getResults(limit = 100, offset = 0) {
  return db.prepare('SELECT * FROM results ORDER BY createdAt DESC LIMIT ? OFFSET ?').all(limit, offset).map(r => ({ ...r, skus: safeJsonParse(r.skus, []), regions: safeJsonParse(r.regions, []), results: safeJsonParse(r.results, []) }));
}
function getScheduledTaskHistory(limit = 20) {
    return db.prepare(`SELECT * FROM results WHERE isScheduled = 1 ORDER BY createdAt DESC LIMIT ?`).all(limit).map(r => ({ ...r, skus: safeJsonParse(r.skus, []), regions: safeJsonParse(r.regions, []), results: safeJsonParse(r.results, []) }));
}
function getResultById(id) {
  const r = db.prepare('SELECT * FROM results WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, skus: safeJsonParse(r.skus, []), regions: safeJsonParse(r.regions, []), results: safeJsonParse(r.results, []) };
}

function saveSchedule(scheduleData) {
  const stmt = db.prepare(`INSERT INTO schedules (name, cron, configId, userId, isActive, createdAt) VALUES (?, ?, ?, ?, ?, ?)`);
  const info = stmt.run(scheduleData.name, scheduleData.cron, scheduleData.configId, scheduleData.userId, scheduleData.isActive ? 1 : 0, new Date().toISOString());
  return getScheduleById(info.lastInsertRowid);
}
function getSchedules() { return db.prepare('SELECT * FROM schedules').all(); }
function getScheduleById(id) { return db.prepare('SELECT * FROM schedules WHERE id = ?').get(id); }
function updateSchedule(id, updateData) {
  const schedule = getScheduleById(id);
  if (!schedule) return null;
  const stmt = db.prepare(`UPDATE schedules SET name = ?, cron = ?, isActive = ? WHERE id = ?`);
  stmt.run(updateData.name || schedule.name, updateData.cron || schedule.cron, updateData.isActive !== undefined ? (updateData.isActive ? 1 : 0) : schedule.isActive, id);
  return getScheduleById(id);
}
function deleteSchedule(id) { return db.prepare('DELETE FROM schedules WHERE id = ?').run(id).changes > 0; }

function getXizhiyueProductBySkuId(skuId) { return db.prepare('SELECT * FROM xizhiyue_products WHERE product_sku_id = ?').get(skuId); }
function createXizhiyueProduct(productData) {
  const stmt = db.prepare(`INSERT INTO xizhiyue_products (product_sku_id, product_id, product_sku, product_name, product_image, month_sales, product_price, is_hot_sale, is_new, is_seckill, is_wish, target_region_id, target_region_name, target_region_code, target_quantity, target_price, target_stock_status, all_regions_inventory, product_certificate, product_categories, product_attributes, formatted_attributes, delivery_regions, member_price, price_currency, price_currency_symbol, base_price, guide_price, real_price, product_addtime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  return stmt.run(productData.product_sku_id, productData.product_id, productData.product_sku, productData.product_name, productData.product_image, productData.month_sales, productData.product_price, productData.is_hot_sale, productData.is_new, productData.is_seckill, productData.is_wish, productData.target_region_id, productData.target_region_name, productData.target_region_code, productData.target_quantity, productData.target_price, productData.target_stock_status, productData.all_regions_inventory, productData.product_certificate, productData.product_categories, productData.product_attributes, productData.formatted_attributes, productData.delivery_regions, productData.member_price, productData.price_currency, productData.price_currency_symbol, productData.base_price, productData.guide_price, productData.real_price, productData.product_addtime);
}
function updateXizhiyueProduct(skuId, productData) {
  const stmt = db.prepare(`UPDATE xizhiyue_products SET product_name = ?, product_image = ?, month_sales = ?, product_price = ?, is_hot_sale = ?, is_new = ?, is_seckill = ?, is_wish = ?, target_region_id = ?, target_region_name = ?, target_region_code = ?, target_quantity = ?, target_price = ?, target_stock_status = ?, all_regions_inventory = ?, product_certificate = ?, product_categories = ?, product_attributes = ?, formatted_attributes = ?, delivery_regions = ?, member_price = ?, price_currency = ?, price_currency_symbol = ?, base_price = ?, guide_price = ?, real_price = ?, product_addtime = ?, updated_at = CURRENT_TIMESTAMP WHERE product_sku_id = ?`);
  return stmt.run(productData.product_name, productData.product_image, productData.month_sales, productData.product_price, productData.is_hot_sale, productData.is_new, productData.is_seckill, productData.is_wish, productData.target_region_id, productData.target_region_name, productData.target_region_code, productData.target_quantity, productData.target_price, productData.target_stock_status, productData.all_regions_inventory, productData.product_certificate, productData.product_categories, productData.product_attributes, productData.formatted_attributes, productData.delivery_regions, productData.member_price, productData.price_currency, productData.price_currency_symbol, productData.base_price, productData.guide_price, productData.real_price, productData.product_addtime, skuId);
}

function getTrackedSkus() {
    const stmt = db.prepare(`SELECT ts.id, ts.sku, ts.product_name, ts.product_image, ts.product_id, ts.product_sku_id, ts.created_at, ts.updated_at, (SELECT qty FROM inventory_history WHERE tracked_sku_id = ts.id ORDER BY created_at DESC LIMIT 1) as latest_qty, (SELECT month_sale FROM inventory_history WHERE tracked_sku_id = ts.id ORDER BY created_at DESC LIMIT 1) as latest_month_sale, (SELECT created_at FROM inventory_history WHERE tracked_sku_id = ts.id ORDER BY created_at DESC LIMIT 1) as latest_record_time FROM tracked_skus ts ORDER BY ts.created_at DESC`);
    return stmt.all();
}
function getTrackedSkuBySku(sku) { return db.prepare('SELECT * FROM tracked_skus WHERE sku = ?').get(sku); }
function getTrackedSkuById(id) { return db.prepare('SELECT * FROM tracked_skus WHERE id = ?').get(id); }
function updateTrackedSku(id, data) {
    const fields = Object.keys(data);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = [...Object.values(data), id];
    const stmt = db.prepare(`UPDATE tracked_skus SET ${setClause} WHERE id = ?`);
    stmt.run(...values);
}
function addTrackedSku(skuData) {
    const { sku, product_name, product_id, product_sku_id, product_image } = skuData;
    const stmt = db.prepare(`INSERT INTO tracked_skus (sku, product_name, product_id, product_sku_id, product_image) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sku) DO UPDATE SET product_name = excluded.product_name, product_id = excluded.product_id, product_sku_id = excluded.product_sku_id, product_image = excluded.product_image, updated_at = CURRENT_TIMESTAMP`);
    stmt.run(sku, product_name, product_id, product_sku_id, product_image);
    return getTrackedSkuBySku(sku);
}
function deleteTrackedSku(id) { return db.prepare('DELETE FROM tracked_skus WHERE id = ?').run(id).changes > 0; }

function getInventoryHistory(tracked_sku_id) { return db.prepare(`SELECT * FROM inventory_history WHERE tracked_sku_id = ? ORDER BY record_date ASC`).all(tracked_sku_id); }
function saveInventoryRecord(record) {
    const { tracked_sku_id, sku, record_date, qty, month_sale, product_sales, delivery_regions, product_image, raw_data } = record;
    const stmt = db.prepare(`INSERT INTO inventory_history (tracked_sku_id, sku, record_date, qty, month_sale, product_sales, delivery_regions, product_image, raw_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tracked_sku_id, record_date) DO UPDATE SET sku = excluded.sku, qty = excluded.qty, month_sale = excluded.month_sale, product_sales = excluded.product_sales, delivery_regions = excluded.delivery_regions, product_image = excluded.product_image, raw_data = excluded.raw_data, created_at = CURRENT_TIMESTAMP`);
    const info = stmt.run(tracked_sku_id, sku, record_date, qty, month_sale, product_sales, JSON.stringify(delivery_regions), product_image, JSON.stringify(raw_data));
    return info.lastInsertRowid;
}
function hasInventoryHistory(tracked_sku_id) { return !!db.prepare('SELECT id FROM inventory_history WHERE tracked_sku_id = ? LIMIT 1').get(tracked_sku_id); }
function saveRegionalInventoryRecord(record) {
    const { tracked_sku_id, sku, product_sku_id, product_id, record_date, region_id, region_name, region_code, qty, price } = record;
    const stmt = db.prepare(`INSERT INTO regional_inventory_history (tracked_sku_id, sku, product_sku_id, product_id, record_date, region_id, region_name, region_code, qty, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tracked_sku_id, record_date, region_id) DO UPDATE SET qty = excluded.qty, price = excluded.price, product_sku_id = excluded.product_sku_id, product_id = excluded.product_id, created_at = CURRENT_TIMESTAMP`);
    stmt.run(tracked_sku_id, sku, product_sku_id, product_id, record_date, region_id, region_name, region_code, qty, price);
}
function getSystemConfigs() {
    const rows = db.prepare('SELECT key, value FROM system_configs').all();
    return rows.reduce((acc, row) => { acc[row.key] = row.value; return acc; }, {});
}
function getRegionalInventoryHistoryForSku(tracked_sku_id, days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    const startDate = date.toISOString().split('T')[0];
    return db.prepare(`SELECT * FROM regional_inventory_history WHERE tracked_sku_id = ? AND record_date >= ? ORDER BY record_date ASC`).all(tracked_sku_id, startDate);
}
function getRegionalInventoryHistoryBySkuId(skuId) { return db.prepare('SELECT * FROM regional_inventory_history WHERE tracked_sku_id = ? ORDER BY record_date ASC').all(skuId); }
function getLatestRegionalInventoryHistory() {
    const stmt = db.prepare(`SELECT t1.* FROM regional_inventory_history t1 INNER JOIN (SELECT tracked_sku_id, MAX(record_date) AS max_date FROM regional_inventory_history GROUP BY tracked_sku_id) t2 ON t1.tracked_sku_id = t2.tracked_sku_id AND t1.record_date = t2.max_date`);
    return stmt.all();
}
function getAllRegions() { return db.prepare('SELECT DISTINCT region_name FROM regional_inventory_history WHERE region_name IS NOT NULL').all().map(r => r.region_name); }
function createAlert(alertData) {
    const { tracked_sku_id, sku, region_id, region_name, alert_type, details, alert_level } = alertData;
    // First, check if an active alert of the same type, for the same sku and region already exists.
    const existingAlert = db.prepare(`
        SELECT id FROM product_alerts 
        WHERE tracked_sku_id = ? AND region_id = ? AND alert_type = ? AND status = 'ACTIVE'
    `).get(tracked_sku_id, region_id, alert_type);

    if (existingAlert) {
        // If it exists, update it with the new level and details
        const stmt = db.prepare(`
            UPDATE product_alerts 
            SET alert_level = ?, details = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `);
        stmt.run(alert_level, details, existingAlert.id);
    } else {
        // If it doesn't exist, insert a new one
        const stmt = db.prepare(`
            INSERT INTO product_alerts (tracked_sku_id, sku, region_id, region_name, alert_type, details, alert_level, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        stmt.run(tracked_sku_id, sku, region_id, region_name, alert_type, details, alert_level);
    }
}
function updateSystemConfigs(configs) {
    const stmt = db.prepare('INSERT OR REPLACE INTO system_configs (key, value) VALUES (?, ?)');
    for (const key in configs) {
        stmt.run(key, configs[key]);
    }
}
function getActiveAlerts(limit = 100) {
    const result = getActiveAlertsPaginated({ limit, page: 1 });
    return result.items;
}

function getActiveAlertsPaginated({ page = 1, limit = 50 }) {
    const offset = (page - 1) * limit;

    // 首先，获取总记录数
    const totalStmt = db.prepare("SELECT COUNT(*) as total FROM product_alerts WHERE status = 'ACTIVE'");
    const { total } = totalStmt.get();

    // 然后，获取分页后的数据
    const itemsStmt = db.prepare("SELECT * FROM product_alerts WHERE status = 'ACTIVE' ORDER BY created_at DESC, alert_level DESC LIMIT ? OFFSET ?");
    const items = itemsStmt.all(limit, offset);

    return {
        items,
        total,
        page,
        limit
    };
}

function getTrackedSkusBySkuNames(skus) {
    const placeholders = skus.map(() => '?').join(',');
    const stmt = db.prepare(`SELECT * FROM tracked_skus WHERE sku IN (${placeholders})`);
    return stmt.all(...skus);
}

function getUserSkus(userId, isAdmin = false) {
    let query = `SELECT ts.*, us.expires_at FROM tracked_skus ts JOIN user_sku us ON ts.id = us.tracked_sku_id WHERE us.user_id = ?`;
    if (!isAdmin) {
        query += ` AND (us.expires_at IS NULL OR us.expires_at > CURRENT_TIMESTAMP)`;
    }
    return db.prepare(query).all(userId);
}
function replaceUserSkus(userId, skus) {
    db.transaction(() => {
        db.prepare('DELETE FROM user_sku WHERE user_id = ?').run(userId);
        const stmt = db.prepare('INSERT OR IGNORE INTO user_sku (user_id, tracked_sku_id, expires_at) VALUES (?, ?, ?)');
        for (const sku of skus) {
            const expiresAt = sku.expires_at ? sku.expires_at : null;
            stmt.run(userId, sku.skuId, expiresAt);
        }
    })();
}

module.exports = {
  getAllUsers, findUserById, findUserByUsername, createUser, updateUser, deleteUser,
  saveConfig, getConfigs, getConfigById, updateConfig, deleteConfig,
  saveResult, getResults, getResultById, getScheduledTaskHistory,
  saveSchedule, getSchedules, getScheduleById, updateSchedule, deleteSchedule,
  getXizhiyueProductBySkuId, updateXizhiyueProduct, createXizhiyueProduct,
  getTrackedSkus, getTrackedSkuBySku, addTrackedSku, deleteTrackedSku, getTrackedSkuById, updateTrackedSku, getTrackedSkusBySkuNames,
  getInventoryHistory, saveInventoryRecord, hasInventoryHistory, saveRegionalInventoryRecord,
  getSystemConfigs, updateSystemConfigs, getRegionalInventoryHistoryForSku, createAlert,
  getRegionalInventoryHistoryBySkuId, getLatestRegionalInventoryHistory, getAllRegions, getActiveAlerts,
  getActiveAlertsPaginated, // 导出新函数
  getUserSkus, replaceUserSkus
};
