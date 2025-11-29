const express = require('express');
const auth = require('../auth');
const database = require('../db_sqlite');
const router = express.Router();

router.get('/', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] GET /api/regions`);
    try {
        const regions = database.getAllRegions();
        res.json(regions);
    } catch (error) {
        res.status(500).json({ error: '获取区域列表失败: ' + error.message });
    }
});

router.post('/', auth.authenticateToken.bind(auth), auth.requireAdmin.bind(auth), (req, res) => {
    console.log(`[API Entry] POST /api/regions`);
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: '区域名称不能为空' });
        const newRegion = database.createRegion(name);
        res.status(201).json(newRegion);
    } catch (error) {
        res.status(500).json({ error: '创建区域失败: ' + error.message });
    }
});

router.post('/bulk', auth.authenticateToken.bind(auth), auth.requireAdmin.bind(auth), (req, res) => {
    console.log(`[API Entry] POST /api/regions/bulk`);
    try {
        const { names } = req.body;
        if (!Array.isArray(names) || names.length === 0) {
            return res.status(400).json({ error: '区域名称列表不能为空' });
        }
        const result = database.createRegionsBulk(names);
        res.status(201).json({ message: `成功处理 ${result.count} 个区域`, ...result });
    } catch (error) {
        res.status(500).json({ error: '批量创建区域失败: ' + error.message });
    }
});

router.delete('/:id', auth.authenticateToken.bind(auth), auth.requireAdmin.bind(auth), (req, res) => {
    console.log(`[API Entry] DELETE /api/regions/:id`);
    try {
        const regionId = parseInt(req.params.id);
        const success = database.deleteRegion(regionId);
        if (!success) {
            return res.status(404).json({ error: '区域不存在' });
        }
        res.json({ message: '区域删除成功' });
    } catch (error) {
        res.status(500).json({ error: '删除区域失败: ' + error.message });
    }
});

module.exports = router;
