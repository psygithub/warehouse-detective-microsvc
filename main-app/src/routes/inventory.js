const express = require('express');
const auth = require('../auth');
const database = require('../db_sqlite');
const inventoryService = require('../services/inventoryService');
const analysisService = require('../analysisService');
const xizhiyueClient = require('../services/xizhiyueClient');
const router = express.Router();

router.get('/skus', (req, res) => {
    console.log(`[API Entry] GET /api/inventory/skus`);
    try {
        const skus = database.getTrackedSkus();
        res.json(skus);
    } catch (error) {
        res.status(500).json({ error: '获取 SKU 列表失败: ' + error.message });
    }
});

router.get('/skus-paginated', (req, res) => {
    console.log(`[API Entry] GET /api/inventory/skus-paginated`);
    try {
        const { page = 1, limit = 20 } = req.query;
        const allSkus = database.getTrackedSkus();
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const paginatedSkus = allSkus.slice(startIndex, endIndex);
        res.json({
            items: paginatedSkus,
            total: allSkus.length,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        res.status(500).json({ error: '获取分页 SKU 列表失败: ' + error.message });
    }
});

router.post('/skus', async (req, res) => {
    console.log(`[API Entry] POST /api/inventory/skus`);
    const { sku } = req.body;
    if (!sku) return res.status(400).json({ error: 'SKU 不能为空' });
    try {
        const authInfo = await xizhiyueClient.getAuthInfo();
        const result = await inventoryService.addOrUpdateTrackedSku(sku, authInfo.token);
        if (result.success) {
            res.status(201).json(result.data);
        } else {
            res.status(404).json({ error: `无法找到 SKU ${sku} 的信息`, reason: result.reason });
        }
    } catch (error) {
        res.status(500).json({ error: '添加 SKU 失败: ' + error.message });
    }
});

router.post('/skus/batch', async (req, res) => {
    console.log(`[API Entry] POST /api/inventory/skus/batch`);
    const { skus } = req.body;
    if (!Array.isArray(skus) || skus.length === 0) {
        return res.status(400).json({ error: 'SKU 列表不能为空' });
    }
    try {
        const authInfo = await xizhiyueClient.getAuthInfo();
        const result = await inventoryService.addOrUpdateTrackedSkusInBatch(skus, authInfo.token);
        
        if (result.failedSkus.length > 0) {
            const failedSkusDetails = result.failedSkus.map(item => `${item.sku} (${item.reason || '未知原因'})`).join(', ');
            console.log(`[LOG] Batch add summary: ${result.newSkusCount} new SKUs added. ${result.failedSkus.length} SKUs failed: ${failedSkusDetails}`);
        } else {
            console.log(`[LOG] Batch add summary: Successfully added ${result.newSkusCount} new SKUs.`);
        }

        res.status(201).json({
            message: `成功添加 ${result.newSkusCount} 个新 SKU。`,
            failedCount: result.failedSkus.length,
            failedSkus: result.failedSkus
        });
    } catch (error) {
        res.status(500).json({ error: '批量添加 SKU 失败: ' + error.message });
    }
});

router.delete('/skus/:id', (req, res) => {
    console.log(`[API Entry] DELETE /api/inventory/skus/:id`);
    const { id } = req.params;
    try {
        const success = database.deleteTrackedSku(id);
        if (success) {
            res.json({ message: 'SKU 删除成功' });
        } else {
            res.status(404).json({ error: '未找到要删除的 SKU' });
        }
    } catch (error) {
        res.status(500).json({ error: '删除 SKU 失败: ' + error.message });
    }
});

router.get('/skus/:id/has-history', (req, res) => {
    console.log(`[API Entry] GET /api/inventory/skus/:id/has-history`);
    const { id } = req.params;
    try {
        const hasHistory = database.hasInventoryHistory(id);
        res.json({ hasHistory });
    } catch (error) {
        res.status(500).json({ error: '检查历史记录失败: ' + error.message });
    }
});

router.get('/history/:skuId', (req, res) => {
    console.log(`[API Entry] GET /api/inventory/history/:skuId`);
    const { skuId } = req.params;
    try {
        const data = inventoryService.getInventoryHistoryBySku(skuId);
        if (data) {
            res.json(data);
        } else {
            res.status(404).json({ error: '未找到该 SKU 的历史记录' });
        }
    } catch (error) {
        res.status(500).json({ error: '获取库存历史失败: ' + error.message });
    }
});

router.get('/regional-history/:skuId', (req, res) => {
    console.log(`[API Entry] GET /api/inventory/regional-history/:skuId`);
    const { skuId } = req.params;
    try {
        let history = database.getRegionalInventoryHistoryBySkuId(skuId);
        // 剔除中国地区的数据
        history = history.filter(record => record.region_name !== '中国');
        const skuDetails = database.getTrackedSkus().find(s => s.id == skuId);
        res.json({
            history,
            sku: skuDetails ? skuDetails.sku : 'N/A',
            product_image: skuDetails ? skuDetails.product_image : null,
        });
    } catch (error) {
        res.status(500).json({ error: '获取区域库存历史失败: ' + error.message });
    }
});

router.post('/fetch-now', async (req, res) => {
    console.log(`[API Entry] POST /api/inventory/fetch-now`);
    try {
        const authInfo = await xizhiyueClient.getAuthInfo();
        const results = await inventoryService.fetchAndSaveAllTrackedSkus(authInfo.token);
        for (const sku of database.getTrackedSkus()) {
            await inventoryService.addOrUpdateTrackedSku(sku.sku, authInfo.token);
        }
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: '立即查询失败: ' + error.message });
    }
});

router.post('/fetch-sku/:id', async (req, res) => {
    console.log(`[API Entry] POST /api/inventory/fetch-sku/:id`);
    const { id } = req.params;
    try {
        const authInfo = await xizhiyueClient.getAuthInfo();
        const result = await inventoryService.fetchSingleSkuById(id, authInfo.token);
        if (result) {
            res.json(result);
        } else {
            res.status(404).json({ error: 'SKU not found or failed to fetch.' });
        }
    } catch (error) {
        res.status(500).json({ error: `Failed to fetch SKU: ${error.message}` });
    }
});

router.get('/schedule/history', (req, res) => {
    console.log(`[API Entry] GET /api/inventory/schedule/history`);
    try {
        const history = database.getScheduledTaskHistory();
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: '获取定时任务历史失败: ' + error.message });
    }
});

router.post('/run-analysis', async (req, res) => {
    console.log(`[API Entry] POST /api/inventory/run-analysis`);
    try {
        await analysisService.runInventoryAnalysis();
        res.json({ message: '库存分析任务已成功触发。' });
    } catch (error) {
        res.status(500).json({ error: '手动分析失败: ' + error.message });
    }
});

router.post('/run-analysis/:skuId', async (req, res) => {
    console.log(`[API Entry] POST /api/inventory/run-analysis/:skuId`);
    try {
        const { skuId } = req.params;
        const result = await analysisService.runInventoryAnalysis(skuId);
        res.json({ 
            message: `SKU (ID: ${skuId}) 分析完成。`,
            ...result 
        });
    } catch (error) {
        res.status(500).json({ error: `单个SKU分析失败: ${error.message}` });
    }
});

router.get('/system-configs', (req, res) => {
    console.log(`[API Entry] GET /api/inventory/system-configs`);
    try {
        const configs = database.getSystemConfigs();
        res.json(configs);
    } catch (error) {
        res.status(500).json({ error: '获取系统配置失败: ' + error.message });
    }
});

router.post('/system-configs', (req, res) => {
    console.log(`[API Entry] POST /api/inventory/system-configs`);
    try {
        const { configs } = req.body;
        if (!configs || typeof configs !== 'object') {
            return res.status(400).json({ error: '无效的配置数据格式' });
        }
        database.updateSystemConfigs(configs);
        res.json({ message: '系统配置已更新' });
    } catch (error) {
        res.status(500).json({ error: '更新系统配置失败: ' + error.message });
    }
});

router.get('/alerts', (req, res) => {
    console.log(`[API Entry] GET /api/inventory/alerts`);
    try {
        const { page = 1, limit = 50 } = req.query;
        const paginatedAlerts = database.getActiveAlertsPaginated({
            page: parseInt(page),
            limit: parseInt(limit)
        });
        res.json(paginatedAlerts);
    } catch (error) {
        res.status(500).json({ error: '获取预警失败: ' + error.message });
    }
});

router.get('/alerts/all', (req, res) => {
    console.log(`[API Entry] GET /api/inventory/alerts/all`);
    try {
        // 注意：这里调用的是旧的、非分页的函数
        const alerts = database.getActiveAlerts();
        res.json(alerts);
    } catch (error) {
        res.status(500).json({ error: '获取所有预警失败: ' + error.message });
    }
});

router.get('/pivot-history', (req, res) => {
    console.log(`[API Entry] GET /api/inventory/pivot-history`);
    try {
        const { page = 1, limit = 20 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        console.log(`[LOG] Pivot History request received for user: ${req.user.username} (ID: ${req.user.id}, Role: ${req.user.role}) with page: ${pageNum}, limit: ${limitNum}`);

        let sourceSkus = [];
        const userSkuExpiresMap = new Map();
        let allowedRegionNames = null;

        if (req.user.role !== 'admin') {
            console.log(`[LOG] User is not admin. Fetching user-specific SKUs and regions.`);
            const [userSkus, userRegions] = [
                database.getUserSkus(req.user.id, false),
                database.getUserRegions(req.user.id)
            ];
            
            sourceSkus = userSkus;
            allowedRegionNames = new Set(userRegions.map(r => r.name));

            console.log(`[LOG] Found ${sourceSkus.length} authorized SKUs and ${allowedRegionNames.size} regions for user ID ${req.user.id}.`);

            if (sourceSkus.length === 0 || allowedRegionNames.size === 0) {
                console.log(`[LOG] User has no authorized SKUs or regions. Returning empty data.`);
                return res.json({ columns: [], rows: [], total: 0, page: pageNum, limit: limitNum });
            }
            sourceSkus.forEach(s => userSkuExpiresMap.set(s.id, s.expires_at));
        } else {
            console.log(`[LOG] User is admin. Fetching all tracked SKUs.`);
            sourceSkus = database.getTrackedSkus();
            console.log(`[LOG] Found ${sourceSkus.length} total tracked SKUs.`);
        }

        const totalSkus = sourceSkus.length;
        const paginatedSkus = sourceSkus.slice((pageNum - 1) * limitNum, pageNum * limitNum);

        const skuIds = paginatedSkus.map(s => s.id);
        const skusForLog = paginatedSkus.map(s => s.sku);
        console.log(`[LOG] Querying history for SKUs on this page: [${skusForLog.join(', ')}]`);
        let latestHistory = database.getLatestRegionalInventoryHistory(skuIds);
        console.log(`[LOG] Found ${latestHistory.length} total history records for these SKUs.`);

        if (allowedRegionNames) {
            latestHistory = latestHistory.filter(record => allowedRegionNames.has(record.region_name));
            console.log(`[LOG] Filtered history to ${latestHistory.length} records based on user's regions.`);
        }

        const historyBySkuId = latestHistory.reduce((acc, record) => {
            if (!acc[record.tracked_sku_id]) {
                acc[record.tracked_sku_id] = [];
            }
            acc[record.tracked_sku_id].push(record);
            return acc;
        }, {});

        const displayRegions = (allowedRegionNames ? Array.from(allowedRegionNames) : database.getAllRegions().map(r => r.name))
            .sort()
            .filter(region => region !== '中国');

        console.log(`[LOG] Displaying regions: [${displayRegions.join(', ')}]`);
        const columns = ['图片', 'SKU', '商品名称', '最新日期', ...displayRegions];
        if (req.user.role !== 'admin') {
            columns.splice(3, 0, '有效日期');
        }
        console.log(`[LOG] Final columns for table: [${columns.join(', ')}]`);

        const rows = paginatedSkus.map(skuInfo => {
            const skuHistory = historyBySkuId[skuInfo.id] || [];
            const latestRecord = skuHistory[0];

            const row = {
                '图片': skuInfo.product_image,
                'SKU': skuInfo.sku,
                '商品名称': skuInfo.product_name,
                '最新日期': latestRecord ? latestRecord.record_date : '无记录',
            };

            if (req.user.role !== 'admin') {
                const expires_at = userSkuExpiresMap.get(skuInfo.id);
                row['有效日期'] = expires_at ? expires_at.split(' ')[0] : '长期';
            }

            const regionQtyMap = new Map(skuHistory.map(h => [h.region_name, h.qty]));

            displayRegions.forEach(region => {
                row[region] = regionQtyMap.get(region) ?? null;
            });

            return row;
        });

        console.log(`[LOG] Processed ${rows.length} rows of data for page ${pageNum}. Sending response.`);
        res.json({ columns, rows, total: totalSkus, page: pageNum, limit: limitNum });
    } catch (error) {
        console.error('获取数据透视历史失败:', error);
        res.status(500).json({ error: '获取数据透视历史失败: ' + error.message });
    }
});

router.get('/pivot-history/:skuId', (req, res) => {
    console.log(`[API Entry] GET /api/inventory/pivot-history/:skuId`);
    const { skuId } = req.params;
    try {
        const history = database.getRegionalInventoryHistoryBySkuId(skuId);
        if (!history || history.length === 0) {
            return res.json({ columns: [], rows: [] });
        }
        const pivotData = {};
        const regionSet = new Set();
        history.forEach(record => {
            const date = record.record_date;
            const region = record.region_name || '未知区域';
            regionSet.add(region);
            if (!pivotData[date]) {
                pivotData[date] = { '日期': date };
            }
            pivotData[date][region] = record.qty;
        });
        const columns = ['日期', ...Array.from(regionSet).sort()];
        const rows = Object.values(pivotData).map(dateRecord => {
            const row = {};
            columns.forEach(col => {
                row[col] = dateRecord[col] !== undefined ? dateRecord[col] : null;
            });
            return row;
        }).sort((a, b) => new Date(b['日期']) - new Date(a['日期']));
        res.json({ columns, rows });
    } catch (error) {
        res.status(500).json({ error: '获取数据透视历史失败: ' + error.message });
    }
});

module.exports = router;
