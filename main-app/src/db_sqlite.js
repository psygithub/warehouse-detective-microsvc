const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// 辅助函数：生成符合数据库格式的本地时间戳 (YYYY-MM-DD HH:MM:SS)
function getLocalTimestampForDb() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// 确保数据目录存在
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('已创建数据目录:', dataDir);
}

const dbPath = path.join(dataDir, 'warehouse.db');
console.log('>>>> DEBUG: 正在连接数据库:', dbPath); // 打印实际的数据库路径
const db = new Database(dbPath);

// 将所有CREATE TABLE语句移到一个变量中
const schemaSQL = `
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
  createdAt TEXT,
  task_type TEXT DEFAULT 'fetch_inventory'
);

CREATE TABLE IF NOT EXISTS xizhiyue_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_sku_id INTEGER UNIQUE NOT NULL,
    product_id INTEGER NOT NULL,
    product_sku TEXT NOT NULL,
    product_name TEXT NOT NULL,
    product_image TEXT,
    month_sales INTEGER DEFAULT 0,
    product_price TEXT,
    is_hot_sale INTEGER DEFAULT 0,
    is_new INTEGER DEFAULT 0,
    is_seckill INTEGER DEFAULT 0,
    is_wish INTEGER DEFAULT 0,
    target_region_id INTEGER NOT NULL,
    target_region_name TEXT,
    target_region_code TEXT,
    target_quantity INTEGER DEFAULT 0,
    target_price TEXT,
    target_stock_status TEXT,
    all_regions_inventory TEXT,
    product_certificate TEXT,
    product_categories TEXT,
    product_attributes TEXT,
    formatted_attributes TEXT,
    delivery_regions TEXT,
    member_price REAL,
    price_currency TEXT,
    price_currency_symbol TEXT,
    base_price REAL,
    guide_price REAL,
    real_price TEXT,
    product_addtime TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS xizhiyue_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_sku_id INTEGER NOT NULL,
    region_id INTEGER NOT NULL,
    price TEXT,
    quantity INTEGER,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tracked_skus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE NOT NULL,
    product_name TEXT,
    product_image TEXT,
    product_id INTEGER,
    product_sku_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME
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

CREATE TABLE IF NOT EXISTS product_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracked_sku_id INTEGER NOT NULL,
    sku TEXT NOT NULL,
    region_id INTEGER NOT NULL,
    region_name TEXT,
    alert_type TEXT NOT NULL,
    alert_level INTEGER DEFAULT 1,
    details TEXT,
    status TEXT DEFAULT 'ACTIVE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tracked_sku_id) REFERENCES tracked_skus (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS system_configs (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS user_sku (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tracked_sku_id INTEGER NOT NULL,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (tracked_sku_id) REFERENCES tracked_skus (id) ON DELETE CASCADE,
  UNIQUE(user_id, tracked_sku_id)
);

CREATE TABLE IF NOT EXISTS regions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_region (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  region_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (region_id) REFERENCES regions (id) ON DELETE CASCADE,
  UNIQUE(user_id, region_id)
);
`;

// 数据库自动同步逻辑
function synchronizeTableSchema(createTableSQL) {
    const tableNameMatch = createTableSQL.match(/CREATE TABLE IF NOT EXISTS `?(\w+)`?/);
    if (!tableNameMatch) return;
    const tableName = tableNameMatch[1];

    try {
        const existingColumns = db.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name);
        
        const columnsContentMatch = createTableSQL.match(/\(([\s\S]*)\)/);
        if (!columnsContentMatch) return;

        const columnsContent = columnsContentMatch[1];
        const columnDefs = columnsContent.split(',\n').map(line => line.trim()).filter(line => line);

        columnDefs.forEach(line => {
            const upperLine = line.toUpperCase();
            if (upperLine.startsWith('PRIMARY KEY') || upperLine.startsWith('FOREIGN KEY') || upperLine.startsWith('UNIQUE') || upperLine.startsWith('CONSTRAINT') || upperLine.startsWith('CHECK')) {
                return;
            }

            const parts = line.split(/\s+/);
            const columnName = parts[0].replace(/`/g, '');

            if (!existingColumns.includes(columnName)) {
                console.log(`同步数据库: 在表 '${tableName}' 中添加缺失的列 '${columnName}'...`);
                try {
                    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${line}`);
                } catch (alterError) {
                    console.error(`无法为表 '${tableName}' 添加列 '${columnName}':`, alterError.message);
                }
            }
        });
    } catch (error) {
        if (!error.message.includes('no such table')) {
            console.error(`同步表 '${tableName}' 时出错:`, error.message);
        }
    }
}

function synchronizeAllTables(schemaSQL) {
    console.log('开始同步数据库结构...');
    // 首先，执行所有CREATE TABLE IF NOT EXISTS语句，确保所有表都存在
    db.exec(schemaSQL);

    // 然后，为每个表同步其结构
    const createStatements = schemaSQL.split(/CREATE TABLE/i);
    createStatements.forEach(stmt => {
        if (stmt.trim().length > 0) {
            const fullStatement = "CREATE TABLE" + stmt;
            synchronizeTableSchema(fullStatement);
        }
    });
    console.log('数据库结构同步完成。');
}

// 在应用启动时运行同步
synchronizeAllTables(schemaSQL);

// 创建索引
db.exec(`
CREATE INDEX IF NOT EXISTS idx_product_sku ON xizhiyue_products (product_sku);
CREATE INDEX IF NOT EXISTS idx_sku_id ON xizhiyue_products (product_sku_id);
CREATE INDEX IF NOT EXISTS idx_region ON xizhiyue_products (target_region_id);
CREATE INDEX IF NOT EXISTS idx_hot_sale ON xizhiyue_products (is_hot_sale);
CREATE INDEX IF NOT EXISTS idx_created_at ON xizhiyue_products (created_at);
`);

function ensureDefaultAdmin() {
  const admin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`INSERT INTO users (username, email, password, role, createdAt, isActive) VALUES (?, ?, ?, ?, ?, ?)`).run('admin', 'admin@warehouse.com', hash, 'admin', getLocalTimestampForDb(), 1);
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
  const info = stmt.run(userData.username, userData.email, userData.password, userData.role || 'user', getLocalTimestampForDb(), 1);
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
  const info = stmt.run(configData.name, JSON.stringify(configData.skus), JSON.stringify(configData.regions), configData.description || '', configData.userId, getLocalTimestampForDb());
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
  const timestamp = getLocalTimestampForDb();
  const info = stmt.run(resultData.userId, resultData.configId, JSON.stringify(resultData.skus), JSON.stringify(resultData.regions), JSON.stringify(resultData.results), resultData.status, resultData.isScheduled ? 1 : 0, resultData.scheduleId, timestamp, timestamp);
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
  const stmt = db.prepare(`INSERT INTO schedules (name, cron, configId, userId, isActive, createdAt, task_type) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const info = stmt.run(scheduleData.name, scheduleData.cron, scheduleData.configId, scheduleData.userId, scheduleData.isActive ? 1 : 0, getLocalTimestampForDb(), scheduleData.task_type || 'fetch_inventory');
  return getScheduleById(info.lastInsertRowid);
}
function getSchedules() { return db.prepare('SELECT * FROM schedules').all(); }
function getScheduleById(id) { return db.prepare('SELECT * FROM schedules WHERE id = ?').get(id); }
function updateSchedule(id, updateData) {
  const schedule = getScheduleById(id);
  if (!schedule) return null;
  
  const fields = ['name', 'cron', 'configId', 'isActive', 'task_type'];
  const updates = [];
  const values = [];

  fields.forEach(field => {
      if (updateData[field] !== undefined) {
          updates.push(`${field} = ?`);
          if (field === 'isActive') {
              values.push(updateData[field] ? 1 : 0);
          } else {
              values.push(updateData[field]);
          }
      }
  });

  if (updates.length === 0) return schedule;

  values.push(id);
  const stmt = db.prepare(`UPDATE schedules SET ${updates.join(', ')} WHERE id = ?`);
  stmt.run(...values);
  
  return getScheduleById(id);
}
function deleteSchedule(id) { return db.prepare('DELETE FROM schedules WHERE id = ?').run(id).changes > 0; }

function getXizhiyueProductBySkuId(skuId) { return db.prepare('SELECT * FROM xizhiyue_products WHERE product_sku_id = ?').get(skuId); }
function createXizhiyueProduct(productData) {
  const stmt = db.prepare(`INSERT INTO xizhiyue_products (product_sku_id, product_id, product_sku, product_name, product_image, month_sales, product_price, is_hot_sale, is_new, is_seckill, is_wish, target_region_id, target_region_name, target_region_code, target_quantity, target_price, target_stock_status, all_regions_inventory, product_certificate, product_categories, product_attributes, formatted_attributes, delivery_regions, member_price, price_currency, price_currency_symbol, base_price, guide_price, real_price, product_addtime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  return stmt.run(productData.product_sku_id, productData.product_id, productData.product_sku, productData.product_name, productData.product_image, productData.month_sales, productData.product_price, productData.is_hot_sale, productData.is_new, productData.is_seckill, productData.is_wish, productData.target_region_id, productData.target_region_name, productData.target_region_code, productData.target_quantity, productData.target_price, productData.target_stock_status, productData.all_regions_inventory, productData.product_certificate, productData.product_categories, productData.product_attributes, productData.formatted_attributes, productData.delivery_regions, productData.member_price, productData.price_currency, productData.price_currency_symbol, productData.base_price, productData.guide_price, productData.real_price, productData.product_addtime);
}
function updateXizhiyueProduct(skuId, productData) {
  const stmt = db.prepare(`UPDATE xizhiyue_products SET product_name = ?, product_image = ?, month_sales = ?, product_price = ?, is_hot_sale = ?, is_new = ?, is_seckill = ?, is_wish = ?, target_region_id = ?, target_region_name = ?, target_region_code = ?, target_quantity = ?, target_price = ?, target_stock_status = ?, all_regions_inventory = ?, product_certificate = ?, product_categories = ?, product_attributes = ?, formatted_attributes = ?, delivery_regions = ?, member_price = ?, price_currency = ?, price_currency_symbol = ?, base_price = ?, guide_price = ?, real_price = ?, product_addtime = ?, updated_at = ? WHERE product_sku_id = ?`);
  return stmt.run(productData.product_name, productData.product_image, productData.month_sales, productData.product_price, productData.is_hot_sale, productData.is_new, productData.is_seckill, productData.is_wish, productData.target_region_id, productData.target_region_name, productData.target_region_code, productData.target_quantity, productData.target_price, productData.target_stock_status, productData.all_regions_inventory, productData.product_certificate, productData.product_categories, productData.product_attributes, productData.formatted_attributes, productData.delivery_regions, productData.member_price, productData.price_currency, productData.price_currency_symbol, productData.base_price, productData.guide_price, productData.real_price, productData.product_addtime, getLocalTimestampForDb(), skuId);
}

function getTrackedSkus() {
    const stmt = db.prepare(`SELECT ts.id, ts.sku, ts.product_name, ts.product_image, ts.product_id, ts.product_sku_id, ts.created_at, ts.updated_at, (SELECT qty FROM inventory_history WHERE sku = ts.sku ORDER BY created_at DESC LIMIT 1) as latest_qty, (SELECT month_sale FROM inventory_history WHERE sku = ts.sku ORDER BY created_at DESC LIMIT 1) as latest_month_sale, (SELECT created_at FROM inventory_history WHERE sku = ts.sku ORDER BY created_at DESC LIMIT 1) as latest_record_time FROM tracked_skus ts ORDER BY ts.created_at DESC`);
    return stmt.all();
}
function getTrackedSkuBySku(sku) { return db.prepare('SELECT * FROM tracked_skus WHERE sku = ?').get(sku); }
function getTrackedSkuById(id) {
    const stmt = db.prepare(`
        SELECT 
            ts.id, ts.sku, ts.product_name, ts.product_image, ts.product_id, ts.product_sku_id, 
            ts.created_at, ts.updated_at, 
            (SELECT qty FROM inventory_history WHERE sku = ts.sku ORDER BY record_date DESC, created_at DESC LIMIT 1) as latest_qty,
            (SELECT month_sale FROM inventory_history WHERE sku = ts.sku ORDER BY record_date DESC, created_at DESC LIMIT 1) as latest_month_sale,
            (SELECT created_at FROM inventory_history WHERE sku = ts.sku ORDER BY record_date DESC, created_at DESC LIMIT 1) as latest_record_time 
        FROM tracked_skus ts 
        WHERE ts.id = ?
    `);
    return stmt.get(id);
}
function updateTrackedSku(id, data) {
    const fields = Object.keys(data);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = [...Object.values(data), id];
    const stmt = db.prepare(`UPDATE tracked_skus SET ${setClause} WHERE id = ?`);
    stmt.run(...values);
}
function addTrackedSku(skuData) {
    const { sku, product_name, product_id, product_sku_id, product_image } = skuData;
    const timestamp = getLocalTimestampForDb();
    const stmt = db.prepare(`INSERT INTO tracked_skus (sku, product_name, product_id, product_sku_id, product_image, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(sku) DO UPDATE SET product_name = excluded.product_name, product_id = excluded.product_id, product_sku_id = excluded.product_sku_id, product_image = excluded.product_image, updated_at = ?`);
    stmt.run(sku, product_name, product_id, product_sku_id, product_image, timestamp, timestamp);
    return getTrackedSkuBySku(sku);
}

function addTrackedSkusBulk(skusData) {
    const stmt = db.prepare(`INSERT INTO tracked_skus (sku, product_name, product_id, product_sku_id, product_image, created_at) VALUES (@sku, @product_name, @product_id, @product_sku_id, @product_image, @created_at) ON CONFLICT(sku) DO UPDATE SET product_name = excluded.product_name, product_id = excluded.product_id, product_sku_id = excluded.product_sku_id, product_image = excluded.product_image, updated_at = @updated_at`);
    const transaction = db.transaction((skus) => {
        const timestamp = getLocalTimestampForDb();
        for (const sku of skus) {
            stmt.run({ ...sku, created_at: timestamp, updated_at: timestamp });
        }
        return { count: skus.length };
    });

    try {
        return transaction(skusData);
    } catch (error) {
        console.error('[LOG] [DB Error] Bulk SKU insert transaction failed:', error);
        // 根据需要，可以决定是向上抛出异常还是返回一个错误指示
        throw error; // 或者 return { error: error.message };
    }
}

function deleteTrackedSku(id) { return db.prepare('DELETE FROM tracked_skus WHERE id = ?').run(id).changes > 0; }

function getInventoryHistory(tracked_sku_id) { return db.prepare(`SELECT * FROM inventory_history WHERE tracked_sku_id = ? ORDER BY record_date ASC`).all(tracked_sku_id); }
function saveInventoryRecord(record) {
    const { tracked_sku_id, sku, record_date, qty, month_sale, product_sales, delivery_regions, product_image, raw_data } = record;
    const timestamp = getLocalTimestampForDb();
    // 修正：在冲突时，应该更新一个 `updated_at` 字段（如果表结构有的话），而不是再次设置 `created_at`
    // 由于 inventory_history 没有 updated_at 字段，我们只更新数据字段，并保持 created_at 不变。
    // 或者，我们可以添加一个 updated_at 字段来跟踪更新时间。这里我们选择只更新数据。
    const stmt = db.prepare(`
        INSERT INTO inventory_history (tracked_sku_id, sku, record_date, qty, month_sale, product_sales, delivery_regions, product_image, raw_data, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
        ON CONFLICT(tracked_sku_id, record_date) 
        DO UPDATE SET 
            sku = excluded.sku, 
            qty = excluded.qty, 
            month_sale = excluded.month_sale, 
            product_sales = excluded.product_sales, 
            delivery_regions = excluded.delivery_regions, 
            product_image = excluded.product_image, 
            raw_data = excluded.raw_data
    `);
    // 注意：由于上面的语句中没有为 UPDATE 部分提供参数，所以这里的参数数量是正确的 (10个)
    const info = stmt.run(tracked_sku_id, sku, record_date, qty, month_sale, product_sales, JSON.stringify(delivery_regions), product_image, JSON.stringify(raw_data), timestamp);
    return info.lastInsertRowid;
}
function hasInventoryHistory(tracked_sku_id) { return !!db.prepare('SELECT id FROM inventory_history WHERE tracked_sku_id = ? LIMIT 1').get(tracked_sku_id); }
function saveRegionalInventoryRecord(record) {
    const { tracked_sku_id, sku, product_sku_id, product_id, record_date, region_id, region_name, region_code, qty, price } = record;
    const timestamp = getLocalTimestampForDb();
    const stmt = db.prepare(`INSERT INTO regional_inventory_history (tracked_sku_id, sku, product_sku_id, product_id, record_date, region_id, region_name, region_code, qty, price, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tracked_sku_id, record_date, region_id) DO UPDATE SET qty = excluded.qty, price = excluded.price, product_sku_id = excluded.product_sku_id, product_id = excluded.product_id, created_at = ?`);
    stmt.run(tracked_sku_id, sku, product_sku_id, product_id, record_date, region_id, region_name, region_code, qty, price, timestamp, timestamp);
}
function getSystemConfigs() {
    const rows = db.prepare('SELECT key, value FROM system_configs').all();
    return rows.reduce((acc, row) => { acc[row.key] = row.value; return acc; }, {});
}
function getRegionalInventoryHistoryForSku(tracked_sku_id, days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const startDate = `${year}-${month}-${day}`;
    return db.prepare(`SELECT * FROM regional_inventory_history WHERE tracked_sku_id = ? AND record_date >= ? ORDER BY record_date ASC`).all(tracked_sku_id, startDate);
}
function getRegionalInventoryHistoryBySkuId(skuId) { return db.prepare('SELECT * FROM regional_inventory_history WHERE tracked_sku_id = ? ORDER BY record_date ASC').all(skuId); }
function getLatestRegionalInventoryHistory(allowedSkuIds = null) {
    let query = `
        SELECT t1.* 
        FROM regional_inventory_history t1 
        INNER JOIN (
            SELECT tracked_sku_id, MAX(record_date) AS max_date 
            FROM regional_inventory_history 
            GROUP BY tracked_sku_id
        ) t2 ON t1.tracked_sku_id = t2.tracked_sku_id AND t1.record_date = t2.max_date
    `;

    if (Array.isArray(allowedSkuIds) && allowedSkuIds.length > 0) {
        const placeholders = allowedSkuIds.map(() => '?').join(',');
        query += ` WHERE t1.tracked_sku_id IN (${placeholders})`;
        return db.prepare(query).all(...allowedSkuIds);
    }
    
    return db.prepare(query).all();
}
function getAllRegionsFromHistory() { return db.prepare('SELECT DISTINCT region_name FROM regional_inventory_history WHERE region_name IS NOT NULL').all().map(r => r.region_name); }

// Region management
function getAllRegions() { return db.prepare('SELECT * FROM regions ORDER BY name').all(); }
function createRegion(name) {
    const stmt = db.prepare('INSERT INTO regions (name) VALUES (?)');
    const info = stmt.run(name);
    return { id: info.lastInsertRowid, name };
}

function createRegionsBulk(names) {
    const stmt = db.prepare('INSERT OR IGNORE INTO regions (name) VALUES (?)');
    const transaction = db.transaction((regionNames) => {
        for (const name of regionNames) {
            if (name) { // Ensure name is not empty
                stmt.run(name);
            }
        }
        return { count: regionNames.length };
    });
    return transaction(names);
}

function deleteRegion(id) {
    // This will only delete the region itself, not the associations in user_region
    // due to how foreign keys are set up (or not set up for cascading delete on this table).
    return db.prepare('DELETE FROM regions WHERE id = ?').run(id).changes > 0;
}

function getUserRegions(userId) {
    const stmt = db.prepare(`
        SELECT r.id, r.name 
        FROM regions r 
        JOIN user_region ur ON r.id = ur.region_id 
        WHERE ur.user_id = ?
    `);
    return stmt.all(userId);
}
function replaceUserRegions(userId, regionIds) {
    db.transaction(() => {
        db.prepare('DELETE FROM user_region WHERE user_id = ?').run(userId);
        const stmt = db.prepare('INSERT OR IGNORE INTO user_region (user_id, region_id) VALUES (?, ?)');
        for (const regionId of regionIds) {
            stmt.run(userId, regionId);
        }
    })();
}

function createAlert(alertData) {
    const { tracked_sku_id, sku, region_id, region_name, alert_type, details, alert_level } = alertData;
    // First, check if an active alert of the same type, for the same sku and region already exists.
    const existingAlert = db.prepare(`
        SELECT id FROM product_alerts 
        WHERE tracked_sku_id = ? AND region_id = ? AND alert_type = ? AND status = 'ACTIVE'
    `).get(tracked_sku_id, region_id, alert_type);

    const timestamp = getLocalTimestampForDb();
    if (existingAlert) {
        // If it exists, update it with the new level and details
        const stmt = db.prepare(`
            UPDATE product_alerts 
            SET alert_level = ?, details = ?, updated_at = ? 
            WHERE id = ?
        `);
        stmt.run(alert_level, details, timestamp, existingAlert.id);
    } else {
        // If it doesn't exist, insert a new one, explicitly setting status and updated_at
        const stmt = db.prepare(`
            INSERT INTO product_alerts (tracked_sku_id, sku, region_id, region_name, alert_type, details, alert_level, status, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
        `);
        stmt.run(tracked_sku_id, sku, region_id, region_name, alert_type, details, alert_level, timestamp, timestamp);
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
    const itemsStmt = db.prepare("SELECT * FROM product_alerts WHERE status = 'ACTIVE' ORDER BY updated_at DESC, created_at DESC, alert_level DESC LIMIT ? OFFSET ?");
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
  getTrackedSkus, getTrackedSkuBySku, addTrackedSku, deleteTrackedSku, getTrackedSkuById, updateTrackedSku, getTrackedSkusBySkuNames, addTrackedSkusBulk,
  getInventoryHistory, saveInventoryRecord, hasInventoryHistory, saveRegionalInventoryRecord,
  getSystemConfigs, updateSystemConfigs, getRegionalInventoryHistoryForSku, createAlert,
  getRegionalInventoryHistoryBySkuId, getLatestRegionalInventoryHistory, getAllRegionsFromHistory, getActiveAlerts,
  getActiveAlertsPaginated, // 导出新函数
  getUserSkus, replaceUserSkus,
  // Region management
  getAllRegions, createRegion, getUserRegions, replaceUserRegions, createRegionsBulk, deleteRegion
};
